import { describe, it, expect, beforeEach } from "vitest";
import { nearestPlace, stationsNear, matchForPosition, locateStation } from "./place";
import { setPlaceStation } from "./savedStations";

const victoria = { latitude: 48.4284, longitude: -123.3656 };
const seattle = { latitude: 47.6062, longitude: -122.3321 };

beforeEach(() => localStorage.clear());

describe("nearestPlace", () => {
  it("names where you are", () => {
    expect(nearestPlace(victoria)!.name).toBe("Victoria");
    expect(nearestPlace(seattle)!.name).toBe("Seattle");
  });

  it("is stable across small movements", () => {
    // Drifting around a harbour must not change the place, or a
    // place-keyed preference would stop applying.
    const a = nearestPlace(victoria)!.name;
    const b = nearestPlace({ latitude: 48.4301, longitude: -123.3702 })!.name;
    expect(a).toBe(b);
  });
});

describe("matchForPosition", () => {
  it("picks the best station for the place by default", () => {
    const match = matchForPosition(victoria)!;
    expect(match.place.name).toBe("Victoria");
    expect(match.station.slug).toBeTruthy();
    expect(match.overridden).toBe(false);
  });

  it("honours a saved choice for that place", () => {
    const alternatives = stationsNear(nearestPlace(victoria)!, 3);
    const chosen = alternatives[1] ?? alternatives[0];
    setPlaceStation("Victoria", chosen.slug);
    const match = matchForPosition(victoria)!;
    expect(match.station.slug).toBe(chosen.slug);
    expect(match.overridden).toBe(true);
  });

  it("does not apply one place's choice to another", () => {
    // The whole point of grounding on a name: a Victoria choice is a
    // Victoria choice, not a global one.
    const alternatives = stationsNear(nearestPlace(victoria)!, 3);
    setPlaceStation("Victoria", (alternatives[1] ?? alternatives[0]).slug);
    expect(matchForPosition(seattle)!.overridden).toBe(false);
  });

  it("survives a move away and back", () => {
    const alternatives = stationsNear(nearestPlace(victoria)!, 3);
    const chosen = (alternatives[1] ?? alternatives[0]).slug;
    setPlaceStation("Victoria", chosen);
    matchForPosition(seattle);
    expect(matchForPosition(victoria)!.station.slug).toBe(chosen);
  });
});

describe("locateStation", () => {
  it("resolves the same station matchForPosition does", () => {
    // The gate and the live watch both go through here, so they never
    // disagree for one fix and demote a pick into Recent. If this ever
    // routed through matchStation again (bundled-only), the slugs diverge.
    expect(locateStation(victoria)!.station.slug).toBe(matchForPosition(victoria)!.station.slug);
    expect(locateStation(victoria)!.quality).toBeTruthy();
  });
});

describe("stationsNear", () => {
  it("offers alternatives nearest first", () => {
    const near = stationsNear(nearestPlace(victoria)!, 3);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThanOrEqual(3);
  });
});
