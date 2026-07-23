import { describe, it, expect } from "vitest";
import { memoryCache, dayKey } from "./cache";

describe("dayKey", () => {
  it("composes id, series and day", () => {
    expect(dayKey("abc", "wlp", "2026-07-21")).toBe("abc|wlp|2026-07-21");
  });
});

describe("memoryCache", () => {
  it("round-trips a value", async () => {
    const c = memoryCache();
    await c.set(dayKey("abc", "wlp", "2026-07-21"), [{ v: 1 }]);
    expect(await c.get(dayKey("abc", "wlp", "2026-07-21"))).toEqual([{ v: 1 }]);
    expect(await c.get(dayKey("abc", "wlp", "2026-07-22"))).toBeNull();
  });

  it("evicts entries whose day is before the cutoff", async () => {
    const c = memoryCache();
    await c.set(dayKey("abc", "wlp", "2026-07-10"), "old");
    await c.set(dayKey("abc", "wlp", "2026-07-21"), "keep");
    await c.evictBefore("2026-07-15");
    expect(await c.get(dayKey("abc", "wlp", "2026-07-10"))).toBeNull();
    expect(await c.get(dayKey("abc", "wlp", "2026-07-21"))).toBe("keep");
  });

  it("keeps the cutoff day itself — eviction is strictly before, not on", async () => {
    const c = memoryCache();
    await c.set(dayKey("abc", "wlp", "2026-07-15"), "cutoff-day");
    await c.evictBefore("2026-07-15");
    expect(await c.get(dayKey("abc", "wlp", "2026-07-15"))).toBe("cutoff-day");
  });
});
