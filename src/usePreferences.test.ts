import { describe, it, expect, beforeEach } from "vitest";
import { readUnits, writeUnits } from "./usePreferences";

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
