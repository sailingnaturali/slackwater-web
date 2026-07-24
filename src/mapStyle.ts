import type { Candidate } from "./place";
import { isChsCurrent } from "./chsStations";
import { isNoaaCurrent } from "./noaaCurrents";

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

// A pin is "current" for a CHS gate or a NOAA current station, "tide" otherwise.
const isCurrentKind = (s: Candidate) => isChsCurrent(s) || isNoaaCurrent(s);

/** Every station the app can name, as map pins. Identity only — no readings. */
export function pinFeatures(stations: Candidate[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
      properties: {
        slug: s.slug,
        name: s.name,
        kind: isCurrentKind(s) ? "current" : "tide",
      },
    })),
  };
}

// Palette: navy paper / green from the app's design tokens (styles.css).
const LAND_TONE = "#182a1f";
const WATER_TONE = "#0b1a2b";
const PIN = { tide: "#7fb3d5", current: "#8fd0a0" };

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
  const dots: StyleLayer = {
    id: "station-dots",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": 5,
      "circle-color": ["match", ["get", "kind"], "current", PIN.current, PIN.tide],
      "circle-stroke-width": 1.5,
      "circle-stroke-color": WATER_TONE,
    },
  };
  // Labels need glyphs — that's the decisive signal (the local fallback
  // declares none, so it's dots only; see localFallbackStyle). When the host
  // style does carry glyphs, prefer its own symbol layers' font stack; our
  // vendored fixture is trimmed to id/type/source only (Step 1), so no
  // sample survives there — fall back to a default glyph-server font name.
  if (!style.glyphs) return [dots];
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
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#e8e4d8", "text-halo-color": WATER_TONE, "text-halo-width": 1 },
  };
  return [dots, labels];
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

/** Offline / style-fetch-failed: land + pins, honestly bare. No glyphs → dots only, but the local fallback declares none so labels are simply absent. */
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
