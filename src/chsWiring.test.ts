import { describe, it, expect } from "vitest";
import { matchForPosition, stationsNear } from "./place";
import { chsStations } from "./chsStations";

// The acceptance invariant (spec §7): a position near Victoria must resolve to
// the CHS Victoria port, not a NOAA station across Haro Strait (Kanaka Bay).
// The live hero station comes from `matchForPosition` (via useLocation), so
// that is the function the criterion actually rides on.
const VICTORIA = { latitude: 48.42, longitude: -123.37 };

describe("CHS ports join the nearest-station pool", () => {
  it("chs-victoria exists to be offered", () => {
    expect(chsStations.some((s) => s.slug === "chs-victoria")).toBe(true);
  });

  it("resolves a Victoria position to chs-victoria", () => {
    expect(matchForPosition(VICTORIA)?.station.slug).toBe("chs-victoria");
  });

  it("offers chs-victoria as the nearest candidate for the place", () => {
    const place = matchForPosition(VICTORIA)!.place;
    expect(stationsNear(place, 1)[0].slug).toBe("chs-victoria");
  });
});
