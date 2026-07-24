import { describe, expect, it } from "vitest";
import golden from "./fixtures/pug1741-golden.json";
import { noaaCurrentState, type NoaaCurrentStation } from "./noaaCurrents";

// The engine's currents validation, replayed in TS: feed NOAA's constituents,
// predict NOAA's own published window, compare event times and speeds.
// Engine measured 9.7 min / 0.055 kn on this station; gates are 15 min / 0.1 kn.
const KIND = { slack: "slack", flood: "max-flood", ebb: "max-ebb" } as const;

const station: NoaaCurrentStation = {
  kind: "noaa-current",
  id: `noaa/${golden.station}`,
  name: golden.station,
  latitude: 48.6,
  longitude: -122.7,
  timezone: "America/Los_Angeles",
  floodDirection: golden.floodDirection,
  ebbDirection: golden.ebbDirection,
  meanFlow: golden.offset,
  constituents: golden.constituents,
};

describe("PUG1741 vs NOAA's published predictions", () => {
  const mid = new Date((new Date(golden.start).getTime() + new Date(golden.end).getTime()) / 2);
  // Golden fixture spans 48 hours; use 50-hour window to cover from mid
  const state = noaaCurrentState(station, mid, 50);

  it("matches every NOAA event within 15 min and 0.1 kn", () => {
    const usable = golden.events.filter((e) => e.kind !== "unknown");
    expect(usable.length).toBeGreaterThan(0);
    for (const noaaEvent of usable) {
      const t = new Date(noaaEvent.time).getTime();
      const ours = state.events
        .filter((e) => e.kind === KIND[noaaEvent.kind as keyof typeof KIND])
        .reduce((best, e) =>
          Math.abs(e.time.getTime() - t) < Math.abs(best.time.getTime() - t) ? e : best,
        );
      expect(Math.abs(ours.time.getTime() - t) / 60000).toBeLessThanOrEqual(15);
      if (noaaEvent.kind !== "slack") {
        expect(Math.abs((ours.speed ?? 0) - Math.abs(noaaEvent.velocityMajor))).toBeLessThanOrEqual(0.1);
      }
    }
  });
});
