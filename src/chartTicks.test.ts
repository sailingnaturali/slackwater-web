import { describe, it, expect } from "vitest";
import { hourTicks } from "./chartTicks";

const TZ = "America/Vancouver";

describe("hourTicks", () => {
  it("emits the even local hours across an ordinary day", () => {
    // 2026-07-20 local midnight PDT == 07:00Z; last point 23:50 local.
    const t0 = Date.parse("2026-07-20T07:00:00Z");
    const t1 = Date.parse("2026-07-21T06:50:00Z");
    const ticks = hourTicks(t0, t1, TZ);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22",
    ]);
    expect(ticks[0].t).toBe(t0);
  });

  it("stays on the local clock across the fall-back DST shift", () => {
    // 2026-11-01 is 25 hours long in America/Vancouver (01:00 happens twice).
    const t0 = Date.parse("2026-11-01T07:00:00Z");
    const t1 = t0 + 25 * 3_600_000 - 600_000;
    expect(hourTicks(t0, t1, TZ).map((tick) => tick.label)).toEqual([
      "00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22",
    ]);
  });
});
