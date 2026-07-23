import { describe, it, expect } from "vitest";
import { signedDomain } from "./CurrentChart";

describe("signedDomain", () => {
  it("spans the day's signed extremes and always includes zero", () => {
    const d = signedDomain([
      { time: new Date(), signed: 3.4 }, { time: new Date(), signed: -4.0 },
    ]);
    expect(d.max).toBeGreaterThanOrEqual(3.4);
    expect(d.min).toBeLessThanOrEqual(-4.0);
    expect(d.min).toBeLessThan(0);
    expect(d.max).toBeGreaterThan(0);
  });
  it("keeps zero inside the domain even for an all-flood day", () => {
    const d = signedDomain([{ time: new Date(), signed: 1.0 }, { time: new Date(), signed: 2.0 }]);
    expect(d.min).toBeLessThanOrEqual(0);
    expect(d.max).toBeGreaterThanOrEqual(2.0);
  });
});
