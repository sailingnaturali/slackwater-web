import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import seascape from "./fixtures/seascape-style.json";
import { composeStyle, localFallbackStyle, pinFeatures, seascapeStyleUrl } from "./mapStyle";
import { candidates } from "./place";

const LAND = "pmtiles://https://example.test/land.pmtiles";
const pins = pinFeatures(candidates);

describe("seascapeStyleUrl", () => {
  it("carries the unit preference", () => {
    expect(seascapeStyleUrl("ft")).toBe("https://tiles.openwaters.io/seascape/style.json?unit=ft");
    expect(seascapeStyleUrl("m")).toBe("https://tiles.openwaters.io/seascape/style.json?unit=m");
  });
});

describe("pinFeatures", () => {
  it("one pin per candidate, typed tide or current", () => {
    expect(pins.features).toHaveLength(candidates.length);
    const kinds = new Set(pins.features.map((f) => f.properties!.kind));
    expect(kinds).toEqual(new Set(["tide", "current"]));
    for (const f of pins.features) {
      expect(f.properties!.slug).toBeTruthy();
      expect((f.geometry as GeoJSON.Point).coordinates[0]).toBeLessThan(0); // lon,lat order
    }
  });
});

describe("composeStyle", () => {
  const composed = composeStyle(seascape, LAND, pins);
  const ids = composed.layers.map((l) => l.id);

  it("strips the OSM raster the licence forbids", () => {
    // Also pins today's anchor ids: if Seascape renames osm-base or
    // contour-lines, this fails in CI instead of in users' browsers.
    expect(seascape.layers.some((l) => l.id === "osm-base")).toBe(true);
    expect(seascape.layers.some((l) => l.id === "contour-lines")).toBe(true);
    expect(ids).not.toContain("osm-base");
  });

  it("inserts land above relief, below contours; pins on top", () => {
    expect(ids.indexOf("land")).toBeGreaterThan(-1);
    expect(ids.indexOf("land")).toBeLessThan(ids.indexOf("contour-lines"));
    expect(ids.indexOf("station-dots-current")).toBe(ids.length - 3);
    expect(ids.indexOf("station-dots-tide")).toBe(ids.length - 2);
    expect(ids.indexOf("station-labels")).toBe(ids.length - 1);
    expect(composed.sources).toHaveProperty("land");
    expect(composed.sources).toHaveProperty("stations");
  });

  it("degrades to appending when anchors are missing, never throws", () => {
    const bare = { ...seascape, layers: seascape.layers.filter((l) => l.id !== "contour-lines") };
    const out = composeStyle(bare, LAND, pins);
    expect(out.layers.map((l) => l.id)).toContain("land");
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(seascape);
    composeStyle(seascape, LAND, pins);
    expect(JSON.stringify(seascape)).toBe(before);
  });
});

describe("localFallbackStyle", () => {
  it("is land + pins alone — the offline render", () => {
    const out = localFallbackStyle(LAND, pins);
    expect(out.layers.map((l) => l.id)).toEqual([
      "land-bg",
      "land",
      "station-dots-current",
      "station-dots-tide",
    ]);
  });
});

describe("map pins — colour is state, form is kind", () => {
  it("no longer colours pins by station kind", () => {
    // import.meta.url resolves against jsdom's location (not file:) under
    // this repo's default test environment — read via __dirname instead
    // (see tokens.test.ts).
    const src = readFileSync(join(__dirname, "mapStyle.ts"), "utf8");
    expect(src).not.toContain("#8fd0a0");
    expect(src).not.toContain("#7fb3d5");
    expect(src).not.toMatch(/circle-color[^\n]*\["get", "kind"\]/);
  });

  it("distinguishes kind by form: current filled, tide hollow", () => {
    const style = localFallbackStyle(LAND, pins);
    const current = style.layers.find((l) => l.id === "station-dots-current")!;
    const tide = style.layers.find((l) => l.id === "station-dots-tide")!;
    expect(current).toBeDefined();
    expect(tide).toBeDefined();
    const cp = current.paint as Record<string, unknown>;
    const tp = tide.paint as Record<string, unknown>;
    // Same colour expression on both — kind must not change it.
    expect(cp["circle-color"]).toEqual(tp["circle-color"]);
    // Form differs: the tide pin is a ring, the current pin is solid.
    expect(cp["circle-opacity"]).toBe(1);
    expect(tp["circle-opacity"]).toBe(0);
  });
});
