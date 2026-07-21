import { describe, it, expect } from "vitest";
import { searchStations } from "./search";
import { resolvedStations } from "./tides";

const find = (q: string) => searchStations(q, resolvedStations).map((s) => s.slug);

describe("searchStations", () => {
  it("matches on name", () => {
    expect(find("friday")).toContain("friday-harbor");
  });

  it("matches on context, so you can find by the water", () => {
    expect(find("port gardner")).toContain("everett");
  });

  it("matches on an alias from the corrections layer", () => {
    // "everett marina" is an alias, not part of the name or context.
    expect(find("marina")).toContain("everett");
  });

  it("is case and whitespace insensitive", () => {
    expect(find("  CHERRY  ")).toContain("cherry-point");
  });

  it("ranks a name match above a context match", () => {
    const results = searchStations("point", resolvedStations);
    const first = results[0];
    expect(first.name.toLowerCase()).toContain("point");
  });

  it("returns nothing for nonsense rather than everything", () => {
    expect(find("zzzzqqq")).toEqual([]);
  });
});
