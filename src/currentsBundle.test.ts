import { describe, expect, it } from "vitest";
import stations from "./data/currents.json";

// Mirrors bundle.test.ts for tides: what ships is exactly what the licence
// and geography filters promise, checked on every build.
describe("bundled NOAA current stations", () => {
  it("is non-empty and NOAA-only", () => {
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) expect(s.id).toMatch(/^noaa\//);
  });

  it("stays inside the Salish Sea bbox", () => {
    for (const s of stations) {
      expect(s.latitude).toBeGreaterThanOrEqual(47.0);
      expect(s.latitude).toBeLessThanOrEqual(50.5);
      expect(s.longitude).toBeGreaterThanOrEqual(-125.5);
      expect(s.longitude).toBeLessThanOrEqual(-122.0);
    }
  });

  it("ships only predictable harmonic stations at their primary bin", () => {
    for (const s of stations) {
      expect(s.id).not.toContain("@");
      expect(s.constituents.length).toBeGreaterThan(0);
      for (const c of s.constituents) expect(c.amplitude).toBeGreaterThan(0);
      expect(typeof s.floodDirection).toBe("number");
      expect(typeof s.ebbDirection).toBe("number");
      expect(typeof s.meanFlow).toBe("number");
      expect(s.timezone).toBe("America/Los_Angeles");
    }
  });
});
