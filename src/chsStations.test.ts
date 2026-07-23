import { describe, it, expect } from "vitest";
import { chsCurrentStations, chsStations, isChsCurrent } from "./chsStations";

describe("chsStations", () => {
  it("loads CHS tide reference ports from the registry, identity only", () => {
    const victoria = chsStations.find((s) => s.slug === "chs-victoria");
    expect(victoria).toBeDefined();
    expect(victoria!.kind).toBe("chs");
    expect(victoria!.latitude).toBeCloseTo(48.42, 1);
    // Identity only — no constituents, no datum. Numbers come from IWLS at runtime.
    expect(victoria as unknown as { constituents?: unknown }).not.toHaveProperty("constituents");
    expect(victoria!.timezone).toBe("America/Vancouver");
  });

  it("includes only CHS tide ports, not the current gates", () => {
    // Current gates (Active Pass etc.) are provider chs but not tide ports; they
    // must not appear as tide stations. Active Pass is a gate.
    expect(chsStations.some((s) => s.name === "Active Pass")).toBe(false);
    expect(chsStations.length).toBeGreaterThanOrEqual(10);
  });
});

describe("chsCurrentStations", () => {
  it("loads the CHS current gates from the registry, identity only", () => {
    const active = chsCurrentStations.find((s) => s.slug === "chs-active-pass");
    expect(active).toBeDefined();
    expect(active!.series).toBe("current");
    expect(active!.latitude).toBeCloseTo(48.86, 1);
    expect(active as unknown as { constituents?: unknown }).not.toHaveProperty("constituents");
  });

  it("has all 19 gates and none of the tide ports", () => {
    expect(chsCurrentStations).toHaveLength(19);
    expect(chsCurrentStations.some((s) => s.slug === "chs-victoria")).toBe(false);
  });

  it("tags the tide ports as series 'tide'", () => {
    expect(chsStations.every((s) => s.series === "tide")).toBe(true);
    expect(isChsCurrent(chsStations[0])).toBe(false);
    expect(isChsCurrent(chsCurrentStations[0])).toBe(true);
  });
});
