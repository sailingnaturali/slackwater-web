import { describe, it, expect, vi } from "vitest";
import { loadChsCurrent } from "./useChsCurrent";
import { memoryCache } from "./chs/cache";
import events from "./chs/fixtures/active-pass-events.json";
import speeds from "./chs/fixtures/active-pass-wcsp1.json";
import dirs from "./chs/fixtures/active-pass-wcdp1.json";
import meta from "./chs/fixtures/active-pass-metadata.json";
import type { IwlsStationMeta } from "./chs/client";
import type { ChsStation } from "./chsStations";

const stationList: IwlsStationMeta[] = [
  { id: "63aef09f84e5432cd3b6c509", officialName: "Active Pass",
    latitude: 48.8604, longitude: -123.3128, timeSeries: [{ code: "wcsp1" }, { code: "wcdp1" }] },
];
const station: ChsStation = { kind: "chs", series: "current", provider: "chs", id: "chs-active-pass",
  slug: "chs-active-pass", name: "Active Pass", context: "", latitude: 48.8604,
  longitude: -123.3128, aliases: [], timezone: "America/Vancouver" };

describe("loadChsCurrent", () => {
  it("returns ready with a CurrentState when the fetch succeeds", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const body = url.includes("metadata") ? meta : url.includes("wcp1-events") ? events
        : url.includes("wcdp1") ? dirs : speeds;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await loadChsCurrent(station, new Date("2026-07-23T05:00:00Z"),
      memoryCache(), fetchFn, stationList);
    expect(out.status).toBe("ready");
    expect(out.state?.events.length).toBeGreaterThan(0);
  });

  it("returns offline when the fetch fails and nothing is cached", async () => {
    // fake timers collapse client.ts's 1s+2s+4s retry backoff (see chs/client.test.ts)
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
      const result = loadChsCurrent(station, new Date("2026-07-23T05:00:00Z"),
        memoryCache(), fetchFn, stationList);
      await vi.runAllTimersAsync();
      const out = await result;
      expect(out.status).toBe("offline");
      expect(out.state).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
