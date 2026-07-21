import { describe, it, expect } from "vitest";
import { resolvedStations } from "./tides";

describe("resolved stations", () => {
  it("gives every station a name, a context and a slug", () => {
    expect(resolvedStations.length).toBe(41);
    for (const s of resolvedStations) {
      expect(s.name.length).toBeGreaterThan(1);
      expect(s.context.length).toBeGreaterThan(1);
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("uses the curated context, not the raw name", () => {
    const everett = resolvedStations.find((s) => s.slug === "everett")!;
    expect(everett.name).toBe("Everett");
    expect(everett.context).toBe("Port Gardner");
  });

  it("expands abbreviations and calms shouting", () => {
    const nas = resolvedStations.find((s) => /naval air/i.test(s.name))!;
    expect(nas.name).toBe("Naval Air Station Whidbey Island");
    expect(resolvedStations.some((s) => s.name === "Cherry Point")).toBe(true);
  });

  it("has unique slugs", () => {
    const slugs = resolvedStations.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
