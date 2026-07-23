# Discovery map view

*Validated design. 2026-07-23. Owner: Bryan. Second in sequence, after
`2026-07-23-noaa-currents-bundle-design.md`.*

A stations-on-a-map browse view: Seascape bathymetry streamed online, pins for every
station the app knows, tap → existing detail. Deliberately **not** the map-as-hero from
the iOS spec (`slackwater/docs/superpowers/specs/2026-07-19-map-hero-universal-scrub-design.md`)
— no scrub binding, no particles, no overlaid readout. Those stay in the iOS design;
this view de-risks the shared substrate (land layer, Seascape composition) cheaply.

Ground truth for the land layer is `slackwater/docs/land-tiles-problem.md`: Salish Sea
land polygons tile to **3.2 MB of PMTiles** at full detail, proven rendering under the
live Seascape style; Brandon confirmed Seascape intentionally ships no land.

## 1. Stack

- `maplibre-gl` ^5 (Seascape's `color-relief` layers require v5) and `pmtiles`
  (protocol adapter). Both **lazy-loaded**: the map screen is a dynamic import so the
  tide screens' bundle stays light — MapLibre is heavier than the entire current app.
- New route `/map`, entered from a Map affordance on the search/list screen. Back
  returns to the list.

## 2. Layers, bottom-up

1. **Land** — our own PMTiles artifact (see §3), a flat land-tone fill. Inserted
   **before Seascape's `contour-lines`** layer: the `color-relief` raster paints
   nodata grey across whole tiles, so land added at the bottom is invisible
   (measured, land-tiles-problem.md).
2. **Seascape** — style fetched at runtime from
   `https://tiles.openwaters.io/seascape/style.json?unit=<m|ft>`, unit wired to the
   existing units preference. The style's `osm-base` raster layer is **stripped**
   (OSM tile policy forbids app use; our land replaces it).
3. **Pins** — a GeoJSON source built from everything the app knows: bundled NOAA tide
   stations, bundled NOAA current stations, CHS ports and gates from the registry.
   Symbol layer with the station name; tap navigates to the station's existing detail
   route. Current stations and tide stations get distinct pin treatments (the same
   tide/current distinction the list cards already draw).

Style composition (fetch → strip `osm-base` → insert land → append pins) is a pure
function in `src/mapStyle.ts`, unit-testable without a renderer.

Attribution: MapLibre's **collapsed** attribution control (Seascape's expanded string
runs 30+ sources) plus our land layer's OSM attribution. The existing "not for
navigation" disclaimer accompanies the map view — Seascape depths are not
datum-reduced, and this app is about water level, so the caveat is not boilerplate.

## 3. The land artifact

- Built with the pipeline already measured in land-tiles-problem.md:
  `ogr2ogr -clipsrc <bbox>` on OSM `land-polygons-split-4326` → `tippecanoe` z0–14 →
  `land.pmtiles` (~3.2 MB).
- **Committed to the repo** under `public/` and served from the app's own Pages
  origin. It is a generated artifact, but the toolchain (gdal/tippecanoe) doesn't
  belong in CI for a file that changes ~never; the build script lands in `scripts/`
  with the source URL and bbox recorded, rerun by hand when it matters.
- **Added to the PWA precache.** 3.2 MB is bundle-sized; land and pins render with no
  signal, day one, no region-picker.

## 4. Offline honesty

With no network: land + pins draw (both precached), Seascape tiles are simply absent —
degraded but truthful, the same posture as the CHS offline state. No offline-mode
switch, no error banner for missing bathymetry tiles; the map renders what it can
reach (Open Waters' own model). The map is excluded from the offline-sync download
accounting.

## 5. Error handling

- Seascape `style.json` unreachable → fall back to a minimal local style of land +
  pins alone (same layers the offline case renders); retry on next mount.
- Style fetch shape changes upstream (layer id `osm-base` or `contour-lines` gone) →
  composition function degrades to appending our layers rather than throwing; a unit
  test pins today's expected ids so upstream drift fails loudly in CI, not in users'
  browsers.

## 6. Testing

- Unit: `mapStyle.ts` composition (strip, insertion order, unit param, fallback on
  missing anchor layers), pin-collection derivation from the three station sources.
- Smoke: extend `scripts/smoke.mjs` to load `/map` and assert the map container mounts
  without console errors (tiles may fail in the sandbox; that path is the offline case
  and must not error).
- Manual before ship: Deception Pass and an estuary station (Everett) eyeballed
  against the known composition artifacts.

## 7. Deferred, deliberately

- **Place labels** — pins carry station names; islands/towns unlabeled. A curated
  point set later, not an OSM basemap.
- **Estuary gap** — Everett/Olympia deltas render as nodata grey until the
  `seamap`-profile land+water build replaces land-polygons-alone (fix path recorded in
  land-tiles-problem.md). Cosmetic for a discovery map.
- **Map-as-hero, scrub, particles** — iOS spec territory; nothing here forecloses it
  (the map view is a leaf route, not a rewrite of detail).
- **Offline bathymetry regions** — waits on Seascape's fixed PMTiles endpoints
  (`pmtiles extract` over range requests); the land layer already works offline.
