# Discovery Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/map` browse view — Seascape bathymetry streamed online over our own precached land layer, pins for every station the app knows, tap → existing detail view.

**Architecture:** A committed 3.2 MB land PMTiles artifact (built once by script, served from our own origin, PWA-precached) sits under a runtime-fetched Seascape style with its OSM raster stripped. Style surgery and pin-GeoJSON derivation live in a pure, unit-testable `src/mapStyle.ts`; the renderer lives in a lazy-loaded `src/MapScreen.tsx` (MapLibre v5 + pmtiles protocol) so the tide screens' bundle stays light. App wiring mirrors the existing full-screen Search pattern.

**Tech Stack:** maplibre-gl ^5, pmtiles ^4, tippecanoe/gdal/pmtiles CLIs (all present at `/opt/homebrew/bin`), vite-plugin-pwa/Workbox, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-discovery-map-design.md`. Ground truth for the land pipeline: `../slackwater/docs/land-tiles-problem.md` (measured 2026-07-20).
- Layer order, bottom-up: **land fill → Seascape (relief, then contours) → pins**. Land must insert **before Seascape's `contour-lines`** layer — the `color-relief` raster paints nodata grey across whole tiles, so land added at the bottom is invisible (measured).
- Seascape endpoints: style `https://tiles.openwaters.io/seascape/style.json?unit=<m|ft>`; the style's OSM raster layer (id `osm-base`) must be **stripped** (OSM tile policy forbids app use).
- `?unit=` wired to the existing units preference (`Units` = `"ft" | "m"` from `src/units.ts`).
- Land artifact: bbox `-125.5,47.0,-122.0,50.5` (app-wide Salish box), zooms z0–z14, source OSM `land-polygons-split-4326`, attribution `© OpenStreetMap contributors`.
- Offline: land + pins render with no network; Seascape tiles simply absent; **no error banner** for unreachable tiles; map excluded from offline-sync accounting.
- Style-composition failure mode: missing anchor layer ids degrade to appending our layers, never throwing; a unit test pins today's expected ids (`osm-base`, `contour-lines`) so upstream drift fails CI, not users.
- The map view carries the existing "not for navigation" disclaimer; MapLibre attribution control **collapsed** (`compact: true`).
- Workbox `maximumFileSizeToCacheInBytes` must be raised (default 2 MB silently skips the 3.2 MB land file — a precache "success" with no land offline).
- maplibre-gl is heavier than the current app: `MapScreen` is a `React.lazy` dynamic import; nothing map-related loads until the map opens.
- Commit policy: Studio — commit and push each task (branch `noaa-currents` until merged, then main).
- Do not touch `src/data/*` generated bundles or the NOAA-currents feature files except where named.

---

### Task M1: Land artifact + PWA precache

**Files:**
- Create: `scripts/build-land.sh`
- Create: `public/land.pmtiles` (committed binary, ~3.2 MB)
- Modify: `vite.config.ts` (glob + size cap)
- Test: `src/landArtifact.test.ts`

**Interfaces:**
- Produces: `/land.pmtiles` served from the app origin and precached; later tasks reference it via `pmtiles://` + `new URL("/land.pmtiles", location.origin)`.

- [ ] **Step 1: Write the failing test**

`src/landArtifact.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The land layer is a committed artifact (the gdal/tippecanoe toolchain does
// not belong in CI for a file that changes ~never). This guards the two ways
// it can quietly rot: missing from the repo, or replaced by something that
// isn't a PMTiles archive.
describe("public/land.pmtiles", () => {
  it("exists and is a PMTiles v3 archive of plausible size", () => {
    const buf = readFileSync(join(__dirname, "..", "public", "land.pmtiles"));
    expect(buf.subarray(0, 7).toString("ascii")).toBe("PMTiles");
    expect(buf[7]).toBe(3); // spec version byte
    expect(buf.length).toBeGreaterThan(1_000_000);
    expect(buf.length).toBeLessThan(10_000_000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/landArtifact.test.ts`
Expected: FAIL — ENOENT `public/land.pmtiles`.

- [ ] **Step 3: Write `scripts/build-land.sh`** (network + toolchain, run by hand, rerun ~never)

```bash
#!/usr/bin/env bash
# Build public/land.pmtiles: OSM coastline land polygons for the Salish Sea.
# Pipeline measured in ../slackwater/docs/land-tiles-problem.md (3.2 MB, z0-14).
# Requires: ogr2ogr (gdal), tippecanoe — both `brew install`able.
# Known limit, recorded in the spec: tidal estuaries (Everett/Olympia deltas)
# are outside natural=coastline; fix path is the seamap Planetiler profile.
set -euo pipefail
cd "$(dirname "$0")/.."

BBOX="-125.5 47.0 -122.0 50.5"   # minLon minLat maxLon maxLat — app-wide Salish box
SRC_URL="https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fL "$SRC_URL" -o "$WORK/land.zip"
unzip -q "$WORK/land.zip" -d "$WORK"

# shellcheck disable=SC2086 — bbox words are separate ogr2ogr args
ogr2ogr -f FlatGeobuf -clipsrc $BBOX "$WORK/salish-land.fgb" \
  "$WORK/land-polygons-split-4326/land_polygons.shp"

tippecanoe -Z0 -z14 -l land --coalesce-densest-as-needed --force \
  -o public/land.pmtiles "$WORK/salish-land.fgb"

ls -la public/land.pmtiles
```

Then: `chmod +x scripts/build-land.sh && ./scripts/build-land.sh`
Expected: `public/land.pmtiles` at roughly 3.2 MB (the measured figure; anything within the test's 1–10 MB band is plausible across source revisions).

- [ ] **Step 4: PWA precache**

In `vite.config.ts` `workbox` block:

```ts
workbox: {
  globPatterns: ["**/*.{js,css,html,svg,png,json,woff2,pmtiles}"],
  // land.pmtiles is 3.2 MB; the default 2 MB cap would silently skip it and
  // the map would have no land offline — the failure mode this line prevents.
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
},
```

- [ ] **Step 5: Run tests + build**

Run: `npx vitest run src/landArtifact.test.ts && npm run build`
Expected: test PASSES; build output lists `land.pmtiles` among precached entries (grep the workbox log or `dist/sw.js` for `land.pmtiles`).

- [ ] **Step 6: Commit**

```bash
git add scripts/build-land.sh public/land.pmtiles src/landArtifact.test.ts vite.config.ts
git commit -m "feat: Salish Sea land layer as committed PMTiles, precached"
git push
```

---

### Task M2: `mapStyle.ts` — pure style composition + pins

**Files:**
- Create: `src/mapStyle.ts`
- Create: `src/fixtures/seascape-style.json` (trimmed fixture, captured once)
- Test: `src/mapStyle.test.ts`

**Interfaces:**
- Consumes: `Candidate` from `./place`; `Units` from `./units`; `isChsCurrent` from `./chsStations`; `isNoaaCurrent` from `./noaaCurrents`.
- Produces (Task M3 relies on these exact names):
  - `seascapeStyleUrl(unit: Units): string` — `https://tiles.openwaters.io/seascape/style.json?unit=${unit}`
  - `pinFeatures(stations: Candidate[]): GeoJSON.FeatureCollection` — one Point per station; properties `{ slug: string; name: string; kind: "tide" | "current" }` (`current` for CHS gates and NOAA current stations, `tide` otherwise)
  - `composeStyle(seascape: StyleLike, landUrl: string, pins: GeoJSON.FeatureCollection): StyleLike` — strips `osm-base`, inserts land before `contour-lines`, appends pin layers `station-dots` (circle) and `station-labels` (symbol)
  - `localFallbackStyle(landUrl: string, pins: GeoJSON.FeatureCollection): StyleLike` — land + pins alone (offline / style fetch failed)
  - `type StyleLike = { layers: { id: string; type: string; [k: string]: unknown }[]; sources: Record<string, unknown>; glyphs?: string; [k: string]: unknown }`

- [ ] **Step 1: Capture the fixture** (network, one-time)

```bash
curl -fsS "https://tiles.openwaters.io/seascape/style.json?unit=m" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);s.layers=s.layers.map(l=>({id:l.id,type:l.type,...(l.source?{source:l.source}:{})}));console.log(JSON.stringify(s,null,1))})" \
  > src/fixtures/seascape-style.json
```

(Layers trimmed to id/type/source — the fixture pins structure, not cartography.) Verify layer ids `osm-base` and `contour-lines` are present in the output; if either is absent, STOP and report — the composition anchors in the spec have drifted upstream.

- [ ] **Step 2: Write the failing tests**

`src/mapStyle.test.ts`:

```ts
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
    expect(ids.indexOf("station-dots")).toBe(ids.length - 2);
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
    expect(out.layers.map((l) => l.id)).toEqual(["land-bg", "land", "station-dots", "station-labels"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/mapStyle.ts`**

```ts
import type { Candidate } from "./place";
import { isChsCurrent } from "./chsStations";
import { isNoaaCurrent } from "./noaaCurrents";
import type { Units } from "./units";

export type StyleLayer = { id: string; type: string; [k: string]: unknown };
export type StyleLike = {
  layers: StyleLayer[];
  sources: Record<string, unknown>;
  glyphs?: string;
  [k: string]: unknown;
};

export function seascapeStyleUrl(unit: Units): string {
  return `https://tiles.openwaters.io/seascape/style.json?unit=${unit}`;
}

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
        kind: isChsCurrent(s) || isNoaaCurrent(s) ? "current" : "tide",
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
  // Labels need glyphs; reuse whatever font stack the host style's own symbol
  // layers use. A style with no symbol layers (the local fallback) gets dots only.
  const sample = style.layers.find(
    (l) => l.type === "symbol" && (l.layout as Record<string, unknown> | undefined)?.["text-font"],
  );
  if (!style.glyphs || !sample) return [dots];
  const labels: StyleLayer = {
    id: "station-labels",
    type: "symbol",
    source: "stations",
    layout: {
      "text-field": ["get", "name"],
      "text-font": (sample.layout as { "text-font": unknown })["text-font"],
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
```

Note for the implementer: the fallback test expects `station-labels` in `localFallbackStyle` output — but the implementation above only emits labels when glyphs exist. Resolve by giving `localFallbackStyle` a `glyphs` endpoint and font only if the offline case can actually load them (it cannot — glyph PBFs are network requests). The TEST is what must change: expect `["land-bg", "land", "station-dots"]` for the fallback. This is deliberate offline honesty (spec §4); do not add a glyphs URL to the fallback to make a label layer appear.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: PASS (with the fallback expectation corrected to dots-only as noted).

- [ ] **Step 6: Commit**

```bash
git add src/mapStyle.ts src/mapStyle.test.ts src/fixtures/seascape-style.json
git commit -m "feat: Seascape style composition — land in, OSM out, station pins"
git push
```

---

### Task M3: `MapScreen.tsx` — the lazy renderer

**Files:**
- Create: `src/MapScreen.tsx`
- Modify: `package.json` (deps)
- Test: `src/MapScreen.test.tsx` (props/contract only — WebGL cannot run in jsdom; render is covered by smoke in M5)

**Interfaces:**
- Consumes: everything `mapStyle.ts` produces; `Candidate`/`candidates` from `./place`; `Units`.
- Produces: `default export function MapScreen(props: { stations: Candidate[]; units: Units; selectedId: string; onSelect: (s: Candidate) => void; onClose: () => void })` — full-screen view, same contract shape as `Search`.

- [ ] **Step 1: Install deps**

```bash
npm install maplibre-gl@^5 pmtiles@^4
```

(^5, not ^6: the Seascape style and the land composition were verified against v5; the spec requires v5+ for `color-relief`. Bumping to 6 is a separate, deliberate upgrade.)

- [ ] **Step 2: Write the contract test**

`src/MapScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";

// jsdom has no WebGL; the real render is exercised by scripts/smoke.mjs (M5).
// What CAN be pinned here: the module lazy-loads without touching maplibre at
// import time (the whole point of the dynamic import), and the escape hatch
// works without a map ever mounting.
vi.mock("maplibre-gl", () => ({
  default: { Map: vi.fn(), addProtocol: vi.fn(), AttributionControl: vi.fn(), NavigationControl: vi.fn() },
}));
vi.mock("pmtiles", () => ({ Protocol: vi.fn(() => ({ tile: vi.fn() })) }));

describe("MapScreen module", () => {
  it("exports a component as default", async () => {
    const mod = await import("./MapScreen");
    expect(typeof mod.default).toBe("function");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/MapScreen.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/MapScreen.tsx`**

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Candidate } from "./place";
import type { Units } from "./units";
import { composeStyle, localFallbackStyle, pinFeatures, seascapeStyleUrl, type StyleLike } from "./mapStyle";

// Registered once per session; the protocol resolves pmtiles:// tile requests
// via HTTP range reads against our own origin.
let protocolRegistered = false;
function ensureProtocol() {
  if (protocolRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

const SALISH_CENTER: [number, number] = [-123.4, 48.6];

export default function MapScreen({
  stations,
  units,
  selectedId,
  onSelect,
  onClose,
}: {
  stations: Candidate[];
  units: Units;
  selectedId: string;
  onSelect: (s: Candidate) => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    ensureProtocol();
    const pins = pinFeatures(stations);
    const landUrl = `pmtiles://${new URL("/land.pmtiles", window.location.origin)}`;
    const selected = stations.find((s) => s.id === selectedId);

    const map = new maplibregl.Map({
      container: container.current,
      // Fallback first: land + pins render immediately (and are all an offline
      // user gets); Seascape replaces the style when its fetch lands. No error
      // banner when it doesn't — the map renders what it can reach (spec §4).
      style: localFallbackStyle(landUrl, pins) as never,
      center: selected ? [selected.longitude, selected.latitude] : SALISH_CENTER,
      zoom: selected ? 10 : 7,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));

    let gone = false;
    fetch(seascapeStyleUrl(units))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((style: StyleLike) => {
        if (!gone) map.setStyle(composeStyle(style, landUrl, pins) as never, { diff: false });
      })
      .catch(() => {
        /* offline or upstream down: the fallback style is already up */
      });

    const pick = (e: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["station-dots"] })[0];
      const slug = hit?.properties?.slug as string | undefined;
      const station = slug && stations.find((s) => s.slug === slug);
      if (station) onSelect(station);
    };
    map.on("click", pick);
    map.on("mouseenter", "station-dots", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "station-dots", () => (map.getCanvas().style.cursor = ""));

    return () => {
      gone = true;
      map.remove();
    };
  }, [stations, units, selectedId, onSelect]);

  return (
    <div className="map-screen">
      <header className="map-head">
        <p className="eyebrow">Map</p>
        <button className="close" onClick={onClose} aria-label="Close map">
          ✕
        </button>
      </header>
      <div ref={container} className="map-canvas" />
      <p className="warn map-warn">
        Depths not reduced to chart datum — <strong>not for navigation</strong>.
      </p>
    </div>
  );
}
```

Add to `src/styles.css`, following its existing section style:

```css
/* Map view — full-screen like Search; the canvas takes everything between
   the header and the disclaimer. */
.map-screen { display: flex; flex-direction: column; height: 100dvh; }
.map-head { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; }
.map-canvas { flex: 1; min-height: 0; }
.map-warn { padding: 0.5rem 1rem; margin: 0; }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/MapScreen.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/MapScreen.tsx src/MapScreen.test.tsx src/styles.css package.json package-lock.json
git commit -m "feat: MapScreen — MapLibre + pmtiles renderer with offline fallback"
git push
```

---

### Task M4: App wiring — `/map` route, sidebar entry, lazy chunk

**Files:**
- Modify: `src/App.tsx`
- Test: extend `src/App.test.ts`

**Interfaces:**
- Consumes: `MapScreen` (lazy), the existing `choose(next)` function and `candidates`.
- Produces: sidebar "Map" button beside "Search stations"; deep link `/map` opens the map; choosing a pin runs `choose` (which already rewrites the URL); closing returns to the detail view and restores the station URL.

- [ ] **Step 1: Write the failing test**

Follow `src/App.test.ts`'s existing render pattern; mock the lazy chunk at the top of the file (jsdom cannot run maplibre):

```tsx
vi.mock("./MapScreen", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="map-screen">
      <button onClick={onClose}>close-map</button>
    </div>
  ),
}));

it("opens the map from the sidebar and deep-links at /map", async () => {
  window.history.pushState({}, "", "/map");
  render(<App />);
  expect(await screen.findByTestId("map-screen")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL — no map screen renders at `/map`.

- [ ] **Step 3: Implement in `src/App.tsx`**

Top of file:

```tsx
import { lazy, Suspense } from "react";
const MapScreen = lazy(() => import("./MapScreen"));
```

State, next to `searchOpen` (~line 125):

```tsx
const [mapOpen, setMapOpen] = useState(() => window.location.pathname === "/map");
```

Full-screen branch, directly below the `searchOpen` block (~line 300) — same pattern, same precedence:

```tsx
if (mapOpen) {
  return (
    <Suspense fallback={<div className="map-loading muted">Loading map…</div>}>
      <MapScreen
        stations={candidates}
        units={units}
        selectedId={station.id}
        onSelect={(next) => {
          choose(next); // choose() already replaces the URL with the station's
          setMapOpen(false);
        }}
        onClose={() => {
          setMapOpen(false);
          history.replaceState(null, "", buildUrl(resolved, t));
        }}
      />
    </Suspense>
  );
}
```

Sidebar entry, directly under the search-entry button (~line 366):

```tsx
<button
  className="search-entry"
  onClick={() => {
    setMapOpen(true);
    setListOpen(false);
    history.replaceState(null, "", "/map");
  }}
>
  <span aria-hidden="true">◍</span> Map
</button>
```

Note: `choose` and `buildUrl(resolved, t)` are defined below the early returns in App.tsx — if the `mapOpen` branch cannot reach them where it sits, hoist the branch to sit just above the main `return` (after `choose` is defined), still before any sidebar markup renders. Keep the `searchOpen` branch's relative position unchanged.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/App.test.ts && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.ts
git commit -m "feat: map view wired — /map deep link, sidebar entry, lazy chunk"
git push
```

---

### Task M5: Smoke coverage + docs

**Files:**
- Modify: `scripts/smoke.mjs`
- Modify: `README.md`

- [ ] **Step 1: Extend the smoke test**

In `scripts/smoke.mjs`, extend the console-noise filter so unreachable Seascape tiles in CI are not failures (they are the offline case, which must render):

```js
const TILE_HOSTS = ["tiles.openwaters.io"];
function isMapTileNoise(text) {
  return TILE_HOSTS.some((h) => text.includes(h));
}
```

…OR-ed into the existing noise check alongside `isChsFetchNoise`. Then add a `/map` page visit to the page list the script walks: load `${URL}map`, wait for the map container (`.map-canvas canvas` or the suspense fallback to resolve), and assert no unfiltered console errors and no `pageerror`. Follow the structure the script already uses for its other page checks. `pageerror` stays unfiltered — a maplibre crash must fail the smoke.

- [ ] **Step 2: Run it**

Run: `npm run smoke`
Expected: PASS, including the new `/map` visit. If Chrome renders no WebGL headlessly, add `--enable-unsafe-swiftshader` (or `--use-gl=swiftshader`) to the launch args — the record-web-gif skill hit exactly this; note whichever flag was needed in a comment.

- [ ] **Step 3: README**

Add a short "Map" section after "Units":

```markdown
## Map

`/map` (or the sidebar's Map button) shows every station on a chart-style map:
[Seascape](https://openwaters.io/bathymetry) bathymetry streamed online
(CC BY 4.0, © Open Water Software, LLC), over a coastline layer built from OSM
land polygons that ships with the app — so land and station pins render even
with no signal; bathymetry needs a connection. Depths are not reduced to chart
datum and carry the same **not for navigation** caveat as everything else here.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.mjs README.md
git commit -m "feat: smoke-test the map view; document it"
git push
```

---

## Self-Review Notes

- Spec §1 → M3/M4 (lazy chunk, `/map`, sidebar entry). §2 → M2 (order, strip, pins, unit param) + M3 (collapsed attribution, disclaimer). §3 → M1 (script, committed artifact, precache + size cap). §4 → M3 fallback-first style + M5 noise filter. §5 → M2 degrade test + fixture-pinned anchor ids. §6 → M2 unit tests, M5 smoke, manual eyeball is Bryan's. §7 deferrals untouched.
- Type/name consistency: `composeStyle`/`localFallbackStyle`/`pinFeatures`/`seascapeStyleUrl`/`StyleLike` used identically in M2/M3; `MapScreen` default export consumed by M4's lazy import; pin layer ids `station-dots`/`station-labels` shared by M2 tests and M3 click handler.
- Known judgment call surfaced in M2 Step 4's note: fallback style has no labels (no glyphs offline) — the test in Step 2 is corrected there rather than papering over it. M4's note handles the branch-placement constraint honestly.
- Dependency: M2's `isNoaaCurrent` import requires the NOAA-currents plan's Task 3 to be merged first — execute this plan after that one, as sequenced.
