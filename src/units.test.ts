import { describe, it, expect } from "vitest";
import { formatHeight, formatDistance, toFeet, toNauticalMiles } from "./units";

describe("units", () => {
  it("converts metres to feet", () => {
    expect(toFeet(1)).toBeCloseTo(3.28084, 4);
    expect(toFeet(2.38)).toBeCloseTo(7.81, 2);
  });

  it("converts kilometres to nautical miles", () => {
    expect(toNauticalMiles(1.852)).toBeCloseTo(1, 4);
    expect(toNauticalMiles(29.6)).toBeCloseTo(15.98, 2);
  });

  it("formats height to one decimal in feet, two in metres", () => {
    // Feet are read at a glance; the extra digit is noise at this scale.
    expect(formatHeight(2.38, "imperial")).toBe("7.8");
    expect(formatHeight(2.38, "metric")).toBe("2.38");
  });

  it("formats distance without decimals past ten", () => {
    expect(formatDistance(3.7, "imperial")).toBe("2.0");
    expect(formatDistance(29.6, "imperial")).toBe("16");
    expect(formatDistance(29.6, "metric")).toBe("30");
  });

  it("never renders negative zero", () => {
    // A tide just below datum formats as -0.0 without this guard.
    expect(formatHeight(-0.001, "imperial")).toBe("0.0");
  });
});
