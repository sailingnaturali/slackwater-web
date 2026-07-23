import { describe, it, expect, vi } from "vitest";
import { toTideState, chsTideDay, TIMELINE_STEP_MINUTES } from "./tide";
import { memoryCache, dayKey } from "./cache";
import { localDay } from "../tides";
import hilo from "./fixtures/victoria-wlp-hilo.json";
import curve from "./fixtures/victoria-wlp.json";
import stationList from "./fixtures/stations-sample.json";
import type { IwlsSample, IwlsStationMeta } from "./client";
import type { ChsStation } from "../chsStations";

const VICTORIA_ID = "5cebf1df3d0f4a073c4bbd1e";

function victoriaStation(): ChsStation {
  return {
    kind: "chs",
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

function fetchFixtures(): typeof fetch {
  return vi.fn(async (url: string) => {
    const body = url.includes("wlp-hilo") ? hilo : curve;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

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
