import { describe, it, expect } from "vitest";
import { matchForPosition, stationsNear, candidates } from "./place";
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

  it("does not hijack a US position — Seattle resolves to a NOAA station", () => {
    // The converse invariant: adding CHS ports to the pool must not steal US
    // resolutions. A Seattle-area position must land on a bundled NOAA station,
    // never a `chs-` slug.
    const SEATTLE = { latitude: 47.6, longitude: -122.33 };
    const slug = matchForPosition(SEATTLE)?.station.slug;
    expect(slug).toBeDefined();
    expect(slug!.startsWith("chs-")).toBe(false);
  });
});

describe("current gates join the candidate pool", () => {
  it("Active Pass is searchable/nearby as a gate", () => {
    const active = candidates.find((s) => s.slug === "chs-active-pass");
    expect(active).toBeDefined();
    expect((active as { series?: string }).series).toBe("current");
  });
  it("all 19 gates are in the pool", () => {
    const gates = candidates.filter((s) => (s as { series?: string }).series === "current");
    expect(gates).toHaveLength(19);
  });
});
