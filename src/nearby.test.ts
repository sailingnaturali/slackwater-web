import { describe, it, expect } from "vitest";
import { nearestStations } from "./nearby";
import { resolvedStations } from "./tides";

const fridayHarbor = { latitude: 48.546, longitude: -123.013 };

describe("nearestStations", () => {
  it("returns at most the limit, nearest first", () => {
    const near = nearestStations(fridayHarbor, resolvedStations, 4);
    expect(near.length).toBe(4);
    for (let i = 1; i < near.length; i++) {
      expect(near[i].km).toBeGreaterThanOrEqual(near[i - 1].km);
    }
  });

  it("puts the station you are standing on first", () => {
    const [first] = nearestStations(fridayHarbor, resolvedStations, 4);
    expect(first.station.slug).toBe("friday-harbor");
    expect(first.km).toBeLessThan(1);
  });

  it("copes with fewer stations than the limit", () => {
    const near = nearestStations(fridayHarbor, resolvedStations.slice(0, 2), 4);
    expect(near.length).toBe(2);
  });
});
