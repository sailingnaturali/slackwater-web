import { isCurrentStation, type Candidate } from "./place";
import type { Tone } from "./StationGlyph";
import { PIN_IMAGE_ID } from "./pinGlyphs";

export type StyleLayer = { id: string; type: string; [k: string]: unknown };
export type StyleLike = {
  layers: StyleLayer[];
  sources: Record<string, unknown>;
  glyphs?: string;
  [k: string]: unknown;
};

export function seascapeStyleUrl(unit: "ft" | "m"): string {
  return `https://tiles.openwaters.io/seascape/style.json?unit=${unit}`;
}

/**
 * Every station the app can name, as map pins. `kind` drives the pin's shape
 * and `state` its colour — two properties for two independent axes, so the
 * layer expressions can never accidentally cross them.
 *
 * `states` is optional and partial: a station with no resolved tone draws
 * neutral, which honestly reads as "unknown — tap it".
 */
export function pinFeatures(
  stations: Candidate[],
  states: Record<string, Tone> = {},
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
      properties: {
        slug: s.slug,
        name: s.name,
        // A pin is "current" for a CHS gate or a NOAA current station, "tide"
        // otherwise — identity, the same predicate the list card's glyph uses.
        kind: isCurrentStation(s) ? "current" : "tide",
        state: states[s.slug] ?? "unknown",
      },
    })),
  };
}

// Land is a classic paper-chart cream over navy water.
const LAND_TONE = "#f5ecd7";
const WATER_TONE = "#0b1a2b";

// Colour is the water's state, never the station's kind — kind is the pin's
// SHAPE, carried by an SDF glyph (see pinGlyphs.ts). Hex literals rather than
// CSS custom properties because maplibre paint expressions cannot read them.
const PIN_COLOUR: Record<string, string> = {
  rising: "#4a9fd8",
  flood: "#4a9fd8",
  falling: "#e8a33d",
  ebb: "#e8a33d",
  slack: "#88b868",
};
const PIN_UNKNOWN = "#7d9cb8";

function landSource(landUrl: string) {
  return {
    type: "vector",
    url: landUrl,
    attribution: "© OpenStreetMap contributors",
  };
}

const landLayer: StyleLayer = {
  id: "land",
  type: "fill",
  source: "land",
  "source-layer": "land",
  paint: { "fill-color": LAND_TONE },
};

function pinLayers(style: StyleLike): StyleLayer[] {
  const pinLayer: StyleLayer = {
    id: "station-pins",
    type: "symbol",
    source: "stations",
    layout: {
      "icon-image": ["match", ["get", "kind"], "current", PIN_IMAGE_ID.current, PIN_IMAGE_ID.tide],
      "icon-size": 1,
      // maplibre hides colliding symbols by default; a hidden pin is a
      // station the user cannot tap. Stations are sparse enough that a
      // crowded map beats a silently missing one.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: {
      "icon-color": [
        "match",
        ["get", "state"],
        "rising", PIN_COLOUR.rising,
        "flood", PIN_COLOUR.flood,
        "falling", PIN_COLOUR.falling,
        "ebb", PIN_COLOUR.ebb,
        "slack", PIN_COLOUR.slack,
        PIN_UNKNOWN,
      ],
      "icon-halo-color": WATER_TONE,
      "icon-halo-width": 1.5,
    },
  };
  // Labels need glyphs from a glyph server; the local fallback style declares
  // none, so there it is pins without labels. Icons are unaffected — only text
  // needs glyphs — so the fallback still draws the full pin language. When the
  // host style does carry glyphs, prefer its own symbol layers' font stack; our
  // vendored fixture is trimmed to id/type/source only (Step 1), so no
  // sample survives there — fall back to a default glyph-server font name.
  if (!style.glyphs) return [pinLayer];
  const sample = style.layers.find(
    (l) => l.type === "symbol" && (l.layout as Record<string, unknown> | undefined)?.["text-font"],
  );
  // ponytail: generic default font stack, not sniffed from a fixture-stripped
  // style; swap for a real per-style font once composeStyle sees full layers.
  const DEFAULT_LABEL_FONT = ["Open Sans Regular", "Arial Unicode MS Regular"];
  const labels: StyleLayer = {
    id: "station-labels",
    type: "symbol",
    source: "stations",
    layout: {
      "text-field": ["get", "name"],
      "text-font": sample ? (sample.layout as { "text-font": unknown })["text-font"] : DEFAULT_LABEL_FONT,
      // The 14px floor applies here too — map labels are text like any other,
      // and tokens.test.ts only scans styles.css, so nothing else enforces it.
      "text-size": 14,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#e8e4d8", "text-halo-color": WATER_TONE, "text-halo-width": 1 },
  };
  return [pinLayer, labels];
}

/**
 * Seascape, made ours: OSM raster out (licence), our land in above the relief
 * (color-relief paints nodata grey over anything below it — measured), pins on
 * top. Missing anchor ids degrade to appending rather than throwing; the unit
 * test pins today's ids so upstream drift fails CI, not users' browsers.
 */
export function composeStyle(
  seascape: StyleLike,
  landUrl: string,
  pins: GeoJSON.FeatureCollection,
): StyleLike {
  const layers = seascape.layers.filter((l) => l.id !== "osm-base");
  const anchor = layers.findIndex((l) => l.id === "contour-lines");
  const at = anchor === -1 ? layers.length : anchor;
  const withLand = [...layers.slice(0, at), landLayer, ...layers.slice(at)];
  const style: StyleLike = {
    ...seascape,
    sources: { ...seascape.sources, land: landSource(landUrl), stations: { type: "geojson", data: pins } },
    layers: withLand,
  };
  style.layers = [...style.layers, ...pinLayers(style)];
  return style;
}

/** Offline / style-fetch-failed: land + pins, honestly bare. No glyph server means no labels — the local fallback declares none — but pins draw their full shape-and-colour language regardless. */
export function localFallbackStyle(landUrl: string, pins: GeoJSON.FeatureCollection): StyleLike {
  const base: StyleLike = {
    version: 8,
    sources: { land: landSource(landUrl), stations: { type: "geojson", data: pins } },
    layers: [
      { id: "land-bg", type: "background", paint: { "background-color": WATER_TONE } },
      landLayer,
    ],
  };
  base.layers = [...base.layers, ...pinLayers(base)];
  return base;
}
