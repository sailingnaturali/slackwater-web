import { describe, it, expect, vi } from "vitest";
import { toTideState, chsTideDay, withNow, TIMELINE_STEP_MINUTES } from "./tide";
import { memoryCache, dayKey } from "./cache";
import { localDay } from "../tides";
import hilo from "./fixtures/victoria-wlp-hilo.json";
import curve from "./fixtures/victoria-wlp.json";
import stationList from "./fixtures/stations-sample.json";
import { fetchSeries, type IwlsSample, type IwlsStationMeta } from "./client";
import type { ChsStation } from "../chsStations";

const VICTORIA_ID = "5cebf1df3d0f4a073c4bbd1e";

function victoriaStation(): ChsStation {
  return {
    kind: "chs",
    series: "tide",
    provider: "chs",
    id: "chs-victoria",
    slug: "chs-victoria",
    name: "Victoria",
    context: "",
    latitude: 48.424,
    longitude: -123.371,
    aliases: [],
    timezone: "America/Vancouver",
  };
}

/**
 * A fake fetch that respects `from`/`to` like the real IWLS API does — filters
 * the fixture down to the requested instant range instead of returning the
 * whole thing regardless of what was asked for. That's what lets the boundary
 * test below expose a partial-day fetch; a mock that ignores the window can't.
 */
function fetchFixtures(): typeof fetch {
  return vi.fn(async (url: string) => {
    const body = (url.includes("wlp-hilo") ? hilo : curve) as IwlsSample[];
    const params = new URL(url).searchParams;
    const from = new Date(params.get("from")!).getTime();
    const to = new Date(params.get("to")!).getTime();
    const windowed = body.filter((s) => {
      const t = new Date(s.eventDate).getTime();
      return t >= from && t <= to;
    });
    return new Response(JSON.stringify(windowed), { status: 200 });
  }) as unknown as typeof fetch;
}

/** Like `fetchFixtures`, but also answers `GET /stations` with the fixture list,
 *  so resolution actually runs through `fetchStationList` when no list is injected. */
function fetchAll(): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.endsWith("/stations")) return new Response(JSON.stringify(stationList), { status: 200 });
    const body = (url.includes("wlp-hilo") ? hilo : curve) as IwlsSample[];
    const params = new URL(url).searchParams;
    const from = new Date(params.get("from")!).getTime();
    const to = new Date(params.get("to")!).getTime();
    const windowed = body.filter((s) => {
      const t = new Date(s.eventDate).getTime();
      return t >= from && t <= to;
    });
    return new Response(JSON.stringify(windowed), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("withNow", () => {
  const early = new Date("2026-07-21T06:00:00Z");
  const state = toTideState(hilo as IwlsSample[], curve as IwlsSample[], early);

  it("advances `next` to the following extreme past a later `now`, with no negative countdown", () => {
    expect(state.next).not.toBeNull();
    // A tick just past the current next — where a frozen state would report a
    // negative "in -Xm" countdown against this same next.
    const past = new Date(state.next!.time.getTime() + 60_000);
    const rolled = withNow(state, past);

    expect(rolled.next).not.toBeNull();
    expect(rolled.next!.time.getTime()).toBeGreaterThan(past.getTime());
    expect(rolled.next!.time.getTime()).toBeGreaterThan(state.next!.time.getTime());
    // rising tracks the *new* next — proves level/rising/next moved together.
    expect(rolled.rising).toBe(rolled.next!.high);
    // Day-based fields are reused untouched (same reference), never refetched.
    expect(rolled.extremes).toBe(state.extremes);
    expect(rolled.timeline).toBe(state.timeline);
  });
});

describe("toTideState", () => {
  const now = new Date("2026-07-21T06:00:00Z");
  const state = toTideState(hilo as IwlsSample[], curve as IwlsSample[], now);

  it("produces the TideState shape TideChart consumes", () => {
    expect(state).toHaveProperty("level");
    expect(state).toHaveProperty("rising");
    expect(state).toHaveProperty("extremes");
    expect(state).toHaveProperty("timeline");
    expect(state.extremes.every((e) => e.time instanceof Date)).toBe(true);
  });

  it("alternates high/low extremes", () => {
    for (let i = 1; i < state.extremes.length; i++) {
      expect(state.extremes[i].high).toBe(!state.extremes[i - 1].high);
    }
  });

  it("downsamples the 1-minute curve without moving an extreme", () => {
    // ~1440 one-minute points → ~144 at 10-min spacing.
    expect(state.timeline.length).toBeLessThan((curve as IwlsSample[]).length / 5);
    // The peak height in the day survives downsampling within a couple cm.
    const rawMax = Math.max(...(curve as IwlsSample[]).map((s) => s.value));
    const keptMax = Math.max(...state.timeline.map((p) => p.level));
    expect(Math.abs(rawMax - keptMax)).toBeLessThan(0.05);
  });

  it("points next at the first extreme after now, and sets rising from it", () => {
    expect(state.next).not.toBeNull();
    expect(state.next!.time.getTime()).toBeGreaterThan(now.getTime());
    expect(state.rising).toBe(state.next!.high);
  });

  it("classifies a lone extreme sanely instead of always low (minor fix)", () => {
    // Bug: with only one extreme, `ref` fell back to the point's own value, so
    // `level > ref` was always false — a lone extreme could never be "high".
    const lone: IwlsSample[] = [{ eventDate: "2026-07-21T03:38:00Z", value: 2.576 }];
    const loneState = toTideState(lone, curve as IwlsSample[], now);
    expect(loneState.extremes).toHaveLength(1);
    expect(loneState.extremes[0].high).toBe(true);
  });
});

it("chsTideDay resolves, fetches once, and caches the day", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  const now = new Date("2026-07-21T00:00:00Z");
  const first = await chsTideDay(station, now, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  expect(first.extremes.length).toBeGreaterThan(0);

  const callsAfterFirst = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  // One request per series (hilo + wlp) for the whole padded window — not one
  // per local day it spans. A regression back to per-day fetching, or one that
  // skips the very first request, would both change this count.
  expect(callsAfterFirst).toBe(2);

  await chsTideDay(station, now, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirst);
});

it("caches the resolved station id — a second load never re-fetches the station list (bug 3)", async () => {
  const fetchFn = fetchAll();
  const cache = memoryCache();
  const station = victoriaStation();
  const now = new Date("2026-07-21T00:00:00Z");

  const calls = fetchFn as unknown as { mock: { calls: unknown[][] } };
  const stationListCalls = () =>
    calls.mock.calls.filter((c) => String(c[0]).endsWith("/stations")).length;

  // No injected stationList, so resolution genuinely runs fetchStationList once.
  await chsTideDay(station, now, { cache, fetchFn });
  expect(stationListCalls()).toBe(1);

  // Second load of the same station: the resolved id is cached, so the whole
  // registry is not fetched again (and an offline reload would resolve too).
  await chsTideDay(station, now, { cache, fetchFn });
  expect(stationListCalls()).toBe(1);
});

it("bucketing is by station-local day, not UTC (bug 1)", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  // 22:00 PDT July 20 — still local July 20, but already 05:00 UTC July 21.
  // The old `isoDay` (UTC slice) would bucket this whole evening under "2026-07-21".
  const now = new Date("2026-07-21T05:00:00Z");
  expect(localDay(now, station.timezone)).toBe("2026-07-20");

  await chsTideDay(station, now, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });

  const july20 = (await cache.get(dayKey(VICTORIA_ID, "wlp", "2026-07-20"))) as IwlsSample[] | null;
  expect(july20).not.toBeNull();
  // A sample stamped in UTC July 21 but still evening-of PDT July 20 must land in
  // the "2026-07-20" bucket.
  expect(july20!.some((s) => s.eventDate === "2026-07-21T04:00:00Z")).toBe(true);

  const july21 = (await cache.get(dayKey(VICTORIA_ID, "wlp", "2026-07-21"))) as IwlsSample[] | null;
  expect(july21).not.toBeNull();
  // Nothing in the "2026-07-21" bucket may actually be local July 20 — every
  // sample in it must fall at/after the local-day boundary (07:00 UTC in PDT).
  expect(july21!.every((s) => new Date(s.eventDate) >= new Date("2026-07-21T07:00:00Z"))).toBe(true);
});

it("next reaches into the following local day near the end of a day (bug 2)", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  // 23:50 PDT July 16 — after that local day's last recorded extreme (23:34 PDT,
  // a low). A one-day window has nothing left to find and hardcodes rising=false;
  // the real next high (04:18 PDT July 17) is one local day away.
  const now = new Date("2026-07-17T06:50:00Z");
  expect(localDay(now, station.timezone)).toBe("2026-07-16");

  const state = await chsTideDay(station, now, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });

  expect(state.next).not.toBeNull();
  expect(localDay(state.next!.time, station.timezone)).toBe("2026-07-17");
  expect(state.next!.time.toISOString()).toBe("2026-07-17T11:18:00.000Z");
  expect(state.next!.high).toBe(true);
  expect(state.rising).toBe(true);
});

it("a single day's slice is never enough to find `next` (bug 2, regression)", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  // Mid-afternoon PDT July 19 (23:00 UTC) — the last recorded extreme of *that
  // UTC calendar day* (20:06 UTC) has already passed, so any implementation
  // that only ever hands toTideState a single day's hilo — whether bucketed by
  // UTC or by local day — finds nothing after `now` and reports rising=false.
  // The real next high (2026-07-20T03:14:00Z) is only visible once the window
  // is padded past a single day, per predict()'s own now-18h/now+30h shape.
  const now = new Date("2026-07-19T23:00:00Z");

  const state = await chsTideDay(station, now, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });

  expect(state.next).not.toBeNull();
  expect(state.next!.time.toISOString()).toBe("2026-07-20T03:14:00.000Z");
  expect(state.next!.high).toBe(true);
  expect(state.rising).toBe(true);
});

it("spans the whole local day however late `now` is (chart domain, mirrors predict)", async () => {
  // TideChart's horizontal domain is the day's own timeline points, and this
  // adapter clips them to [now-window, ...]. With now-18h, a late-evening now
  // crosses into the day and drops the morning, so the plotted curve rescales
  // as the readout line is scrubbed late — the same artifact predict() had.
  const station = victoriaStation();
  const tz = station.timezone;
  const daySpanHours = async (now: Date) => {
    const state = await chsTideDay(station, now, {
      cache: memoryCache(),
      fetchFn: fetchFixtures(),
      stationList: stationList as IwlsStationMeta[],
    });
    const pts = state.timeline.filter((p) => localDay(p.time, tz) === localDay(now, tz));
    return (pts[pts.length - 1].time.getTime() - pts[0].time.getTime()) / 3_600_000;
  };
  // Same local day (PDT July 19, a full day in the fixture), morning vs night.
  const morning = new Date("2026-07-19T09:00:00Z"); // 02:00 local
  const night = new Date("2026-07-20T06:00:00Z"); // 23:00 local, same day
  expect(localDay(morning, tz)).toBe(localDay(night, tz));
  expect(await daySpanHours(morning)).toBeGreaterThan(23);
  expect(await daySpanHours(night)).toBeGreaterThan(23);
});

it("caches every whole interior day of the fetched week, so an adjacent day within it doesn't refetch (issue #7)", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  // First load fetches a full padded week (from ≈ now-54h, spanning 7 days) —
  // one request per series. That single week already contains several days
  // beyond now1's own ±30h needed days.
  const now1 = new Date("2026-07-18T12:00:00Z");
  await chsTideDay(station, now1, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  const afterFirst = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  expect(afterFirst).toBe(2); // hilo + wlp, one wide request each

  // now2 is two days ahead — its needed days are whole interior days of that
  // same already-fetched week. It must be an all-cache HIT, not a re-fetch of
  // the identical week. (Before #7 only now1's ±30h days were persisted, so the
  // wide fetch's extra interior days were discarded and this refetched.)
  const now2 = new Date("2026-07-20T12:00:00Z");
  await chsTideDay(station, now2, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(afterFirst);
});

it("never caches a fetch-boundary day that the fetch only partially covers (bug 3)", async () => {
  const fetchFn = fetchFixtures();
  const cache = memoryCache();
  const station = victoriaStation();

  // now1's padded fetch window is [2026-07-14T12:00Z, 2026-07-21T12:00Z] — a full
  // 7-day span whose *last* touched local day, "2026-07-21", only gets samples up
  // to noon (its fetch cutoff), not the whole day. "2026-07-21" isn't one of
  // now1's own needed days (those are 07-15..07-17), so it's purely an incidental
  // extra bucket from the wide padded fetch — exactly the class of day the bug
  // caches as if complete.
  const now1 = new Date("2026-07-16T06:00:00Z");
  await chsTideDay(station, now1, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });

  // now2's own needed days are exactly ["2026-07-19", "2026-07-20", "2026-07-21"] —
  // it genuinely needs "2026-07-21" to be complete. Under the bug, all three are
  // already cache HITs (from1 having stuffed "2026-07-21" in as a side effect), so
  // this call never refetches and silently serves the partial day.
  const now2 = new Date("2026-07-20T12:00:00Z");
  await chsTideDay(station, now2, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });

  const cachedBoundaryDay = (await cache.get(dayKey(VICTORIA_ID, "wlp", "2026-07-21"))) as IwlsSample[] | null;
  expect(cachedBoundaryDay).not.toBeNull();

  // What a direct, single-day fetch for "2026-07-21" alone would return — the
  // ground truth for "this day is complete".
  const dayStart = new Date("2026-07-21T07:00:00Z"); // local midnight, America/Vancouver (PDT)
  const dayEnd = new Date(new Date("2026-07-22T07:00:00Z").getTime() - 1); // exclusive: next day's midnight belongs to that day
  const direct = await fetchSeries(VICTORIA_ID, "wlp", dayStart, dayEnd, fetchFixtures());

  // A cached "complete" day must never hold fewer samples than a direct fetch of
  // that day alone — if it does, some incomplete boundary slice got cached as if
  // it were the whole day.
  expect(cachedBoundaryDay!.length).toBeGreaterThanOrEqual(direct.length);
});
