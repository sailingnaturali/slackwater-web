import { describe, it, expect, vi } from "vitest";
import { loadChsTide } from "./useChsTide";
import { memoryCache } from "./chs/cache";
import hilo from "./chs/fixtures/victoria-wlp-hilo.json";
import curve from "./chs/fixtures/victoria-wlp.json";
import stationList from "./chs/fixtures/stations-sample.json";
import type { ChsStation } from "./chsStations";

function victoriaStation(): ChsStation {
  return {
    kind: "chs", series: "tide", provider: "chs", id: "chs-victoria", slug: "chs-victoria",
    name: "Victoria", context: "", latitude: 48.424, longitude: -123.371,
    aliases: [], timezone: "America/Vancouver",
  };
}

describe("loadChsTide", () => {
  it("returns ready with state when the fetch succeeds", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.includes("hilo") ? hilo : curve), { status: 200 })) as unknown as typeof fetch;
    const out = await loadChsTide(victoriaStation(), new Date("2026-07-21T00:00:00Z"),
      memoryCache(), fetchFn, stationList as never);
    expect(out.status).toBe("ready");
    expect(out.state).not.toBeNull();
  });

  it("returns offline when the station carries the series but the window is empty", async () => {
    // A valid 200 with an empty series adapts to a flat-at-zero degenerate state;
    // surface it as honestly degraded, not a real reading.
    const fetchFn = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const out = await loadChsTide(victoriaStation(), new Date("2026-07-21T00:00:00Z"),
      memoryCache(), fetchFn, stationList as never);
    expect(out.status).toBe("offline");
    expect(out.state).toBeNull();
  });

  it("returns offline when the fetch fails and nothing is cached", async () => {
    // fake timers collapse client.ts's 1s+2s+4s retry backoff (see chs/client.test.ts)
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
      const result = loadChsTide(victoriaStation(), new Date("2026-07-21T00:00:00Z"),
        memoryCache(), fetchFn, stationList as never);
      await vi.runAllTimersAsync();
      const out = await result;
      expect(out.status).toBe("offline");
      expect(out.state).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
