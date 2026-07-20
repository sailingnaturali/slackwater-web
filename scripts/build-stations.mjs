/**
 * Extract the bundled station set from @neaps/tide-database at build time.
 *
 * Two filters decide what ships, and both are load-bearing:
 *
 * 1. LICENCE. Only `public domain` stations are bundled. The database also
 *    carries cc-by-4.0 stations (TICON/UHSLC-derived), which is every Canadian
 *    station in this region — those are computed against the current epoch
 *    rather than an agency's adopted chart datum, and drift from it by ~0.2-0.4 m
 *    on this coast. Canadian water is served online from CHS instead, at lower
 *    stated confidence. Shipping TICON for BC would be quietly wrong in exactly
 *    the waters this app is for.
 *
 * 2. GEOGRAPHY. Salish Sea bounding box. The whole database is 23 MB; an
 *    offline-first app cannot ship that, and coverage expands region by region.
 *
 * Run via `npm run build:stations` (build and dev both depend on it).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bbox } from "@neaps/tide-database";

/** [minLon, minLat, maxLon, maxLat] — Juan de Fuca through the Strait of Georgia. */
const SALISH_SEA = [-125.5, 47.0, -122.0, 50.5];

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "data", "stations.json");

const stations = bbox(SALISH_SEA)
  .filter((station) => station.license.type === "public domain")
  // A subordinate station is offsets from a reference; without its reference in
  // the bundle it cannot be predicted, so it would be a dead pin on the map.
  .filter((station) => station.type === "reference")
  .filter((station) => station.harmonic_constituents?.some((c) => c.amplitude > 0))
  .map((station) => ({
    id: station.id,
    name: station.name,
    latitude: station.latitude,
    longitude: station.longitude,
    timezone: station.timezone,
    chartDatum: station.chart_datum,
    // Heights come out relative to MSL; the datum shifts them to chart datum.
    datumOffset: station.datums?.MSL != null && station.datums?.[station.chart_datum] != null
      ? station.datums.MSL - station.datums[station.chart_datum]
      : 0,
    source: station.source.name,
    sourceUrl: station.source.url,
    // Zero-amplitude constituents contribute nothing but bytes.
    constituents: station.harmonic_constituents
      .filter((c) => c.amplitude > 0)
      .map((c) => ({ name: c.name, amplitude: c.amplitude, phase: c.phase })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (!stations.length) {
  throw new Error("No stations survived the filters — refusing to ship an empty bundle");
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(stations));

const bytes = JSON.stringify(stations).length;
console.log(
  `${stations.length} public-domain reference stations, ${(bytes / 1024).toFixed(0)} KB`,
);
