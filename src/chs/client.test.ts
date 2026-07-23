// src/chs/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { fetchSeries, IWLS_BASE } from "./client";

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

  // ponytail: real backoff waits (1s+2s+4s ≈ 7s) exceed Vitest's 5s default;
  // bump this test's timeout rather than faking timers or shrinking the backoff.
  it("throws after exhausting retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    await expect(
      fetchSeries("abc", "wlp", new Date(0), new Date(1), fetchFn as unknown as typeof fetch),
    ).rejects.toThrow();
  }, 10_000);
});
