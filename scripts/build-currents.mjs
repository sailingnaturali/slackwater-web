/**
 * Shape the vendored NOAA current-station extract (data/noaa-currents.json,
 * from @sailingnaturali/current-stations — see its README for re-vendoring)
 * into the app's bundled current stations.
 *
 * Filters, all load-bearing:
 * 1. Harmonic stations only — a subordinate is offsets against a reference and
 *    needs the reduction math slackwater-engine has; not ported yet.
 *    ponytail: harmonic-only; port the engine's subordinate reduction when a
 *    pass we care about turns out to be subordinate-only.
 * 2. Primary bin only (bundle key without "@") — one station, one prediction.
 * 3. Zero-amplitude constituents contribute nothing but bytes.
 *
 * The vendored file is already the Salish Sea box extract; geography is
 * asserted in src/currentsBundle.test.ts rather than re-filtered here.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "data", "noaa-currents.json");
const out = join(here, "..", "src", "data", "currents.json");

const bundle = JSON.parse(readFileSync(src, "utf8"));

const stations = bundle.stations
  .filter((s) => s.type === "harmonic")
  .filter((s) => !s.id.includes("@"))
  .filter((s) => s.constituents.some((c) => c.amplitude > 0))
  .filter(
    (s) =>
      s.latitude >= 47.0 &&
      s.latitude <= 50.5 &&
      s.longitude >= -125.5 &&
      s.longitude <= -122.0
  )
  .map((s) => ({
    id: `noaa/${s.id}`,
    name: s.name,
    latitude: s.latitude,
    longitude: s.longitude,
    // ponytail: the bbox is single-zone; add a per-station field only if it widens.
    timezone: "America/Los_Angeles",
    floodDirection: s.floodDirection,
    ebbDirection: s.ebbDirection,
    meanFlow: s.offset,
    constituents: s.constituents.filter((c) => c.amplitude > 0),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (!stations.length) {
  throw new Error("No current stations survived the filters — refusing to ship an empty bundle");
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(stations));
console.log(`${stations.length} NOAA current stations, ${(JSON.stringify(stations).length / 1024).toFixed(0)} KB`);
