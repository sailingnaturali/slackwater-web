import { describe, it, expect, beforeEach } from "vitest";
import { readUnits, writeUnits } from "./usePreferences";
import { readSpeedUnit, writeSpeedUnit } from "./usePreferences";

describe("unit preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to imperial", () => {
    expect(readUnits()).toBe("imperial");
  });

  it("round-trips a choice", () => {
    writeUnits("metric");
    expect(readUnits()).toBe("metric");
  });

  it("ignores a corrupted stored value", () => {
    localStorage.setItem("slackwater.units", "furlongs");
    expect(readUnits()).toBe("imperial");
  });
});

describe("speed unit preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to knots and round-trips a stored choice", () => {
    localStorage.removeItem("slackwater.speedUnit");
    expect(readSpeedUnit()).toBe("kn");
    writeSpeedUnit("ms");
    expect(readSpeedUnit()).toBe("ms");
  });
  it("falls back to knots on a garbage value", () => {
    localStorage.setItem("slackwater.speedUnit", "furlongs");
    expect(readSpeedUnit()).toBe("kn");
  });
});
