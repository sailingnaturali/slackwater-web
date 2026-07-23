import { describe, it, expect, beforeEach } from "vitest";
import { readSyncPaused, writeSyncPaused } from "./useOfflineSync";

describe("sync-paused persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to false", () => {
    expect(readSyncPaused()).toBe(false);
  });

  it("round-trips true/false through localStorage", () => {
    writeSyncPaused(true);
    expect(readSyncPaused()).toBe(true);
    expect(localStorage.getItem("slackwater.syncPaused")).toBe("1");
    writeSyncPaused(false);
    expect(readSyncPaused()).toBe(false);
    expect(localStorage.getItem("slackwater.syncPaused")).toBe(null);
  });
});
