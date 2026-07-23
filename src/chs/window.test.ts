import { describe, it, expect, vi } from "vitest";
import { localDaysInWindow, resolveCachedId } from "./window";
import { memoryCache } from "./cache";
import list from "./fixtures/stations-sample.json";
import type { IwlsStationMeta } from "./client";

describe("localDaysInWindow", () => {
  it("lists each station-local day the window touches, once, in order", () => {
    const start = new Date("2026-07-21T20:00:00Z"); // 13:00 local PDT
    const end = new Date("2026-07-23T04:00:00Z");    // 21:00 local next-next day
    const days = localDaysInWindow(start, end, "America/Vancouver");
    expect(days).toEqual(["2026-07-21", "2026-07-22"]);
  });
});

describe("resolveCachedId", () => {
  it("resolves once, then serves the cached id without refetching", async () => {
    const fetchFn = vi.fn(); // must never be called: stationList is injected
    const cache = memoryCache();
    const station = { id: "chs-victoria", latitude: 48.424, longitude: -123.371, name: "Victoria" };
    const first = await resolveCachedId(station, "wlp", { cache, fetchFn: fetchFn as never, stationList: list as IwlsStationMeta[] });
    const second = await resolveCachedId(station, "wlp", { cache, fetchFn: fetchFn as never, stationList: list as IwlsStationMeta[] });
    expect(first).toBe(second);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
