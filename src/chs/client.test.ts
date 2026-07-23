// src/chs/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchSeries, fetchStationMeta, IWLS_BASE } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchSeries", () => {
  it("requests the right URL and returns parsed samples", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse([{ eventDate: "2026-07-21T00:00:00Z", value: 1.99 }]),
    );
    const from = new Date("2026-07-21T00:00:00Z");
    const to = new Date("2026-07-21T01:00:00Z");
    const out = await fetchSeries("abc", "wlp", from, to, fetchFn as unknown as typeof fetch);

    expect(out).toEqual([{ eventDate: "2026-07-21T00:00:00Z", value: 1.99 }]);
    const url = (fetchFn.mock.calls[0][0] as string);
    expect(url).toBe(
      `${IWLS_BASE}/stations/abc/data?time-series-code=wlp&from=2026-07-21T00:00:00.000Z&to=2026-07-21T01:00:00.000Z`,
    );
  });

  it("retries on 429 then succeeds", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse([{ eventDate: "t", value: 2 }]));
    const out = await fetchSeries("abc", "wlp", new Date(0), new Date(1),
      fetchFn as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // ponytail: fake timers collapse the 1s+2s+4s backoff to ~0ms; real setTimeout
  // only needed if getJson's backoff math itself must be verified under real clock.
  it("throws after exhausting retries", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
      const result = fetchSeries("abc", "wlp", new Date(0), new Date(1), fetchFn as unknown as typeof fetch);
      const assertion = expect(result).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchStationMeta", () => {
  it("requests the metadata endpoint and returns flood/ebb directions", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", officialName: "Active Pass", floodDirection: 45, ebbDirection: 225 }),
        { status: 200 }),
    );
    const meta = await fetchStationMeta("abc", fetchFn as unknown as typeof fetch);
    expect(meta.floodDirection).toBe(45);
    expect(meta.ebbDirection).toBe(225);
    expect(fetchFn.mock.calls[0][0]).toContain("/stations/abc/metadata");
  });
});
