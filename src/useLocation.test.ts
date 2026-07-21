import { describe, it, expect, vi, beforeEach } from "vitest";
import { shouldKeepWatching, MOVEMENT_THRESHOLD_M, QUIET_PERIOD_MS } from "./useLocation";

describe("backoff policy", () => {
  it("keeps watching while the user is moving", () => {
    expect(shouldKeepWatching({ movedM: MOVEMENT_THRESHOLD_M + 1, stillForMs: 0 })).toBe(true);
  });

  it("keeps watching during a short pause", () => {
    // Waiting at a dock is not the end of a passage.
    expect(shouldKeepWatching({ movedM: 0, stillForMs: QUIET_PERIOD_MS - 1 })).toBe(true);
  });

  it("drops the watch once still for the quiet period", () => {
    expect(shouldKeepWatching({ movedM: 0, stillForMs: QUIET_PERIOD_MS })).toBe(false);
  });

  it("treats jitter under the threshold as still", () => {
    // GPS noise is not movement; without this the watch never sleeps.
    expect(shouldKeepWatching({ movedM: MOVEMENT_THRESHOLD_M - 1, stillForMs: QUIET_PERIOD_MS })).toBe(false);
  });
});
