import { describe, it, expect, vi } from "vitest";
import { toTideState, chsTideDay, TIMELINE_STEP_MINUTES } from "./tide";
import { memoryCache } from "./cache";
import hilo from "./fixtures/victoria-wlp-hilo.json";
import curve from "./fixtures/victoria-wlp.json";
import stationList from "./fixtures/stations-sample.json";
import type { IwlsSample, IwlsStationMeta } from "./client";
import type { ChsStation } from "../chsStations";

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
});

it("chsTideDay resolves, fetches once, and caches the day", async () => {
  const fetchFn = vi.fn(async (url: string) => {
    const body = url.includes("wlp-hilo") ? hilo : curve;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const cache = memoryCache();
  const station: ChsStation = { kind: "chs", provider: "chs", id: "chs-victoria", slug: "chs-victoria",
    name: "Victoria", context: "", latitude: 48.424, longitude: -123.371, aliases: [] };

  const day = new Date("2026-07-21T00:00:00Z");
  const first = await chsTideDay(station, day, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  expect(first.extremes.length).toBeGreaterThan(0);

  const callsAfterFirst = (fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  await chsTideDay(station, day, { cache, fetchFn, stationList: stationList as IwlsStationMeta[] });
  expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(callsAfterFirst);
});
