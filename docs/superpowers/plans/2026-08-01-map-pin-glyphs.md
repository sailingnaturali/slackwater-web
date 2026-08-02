# Map Pin Glyphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two circle pin layers with one SDF symbol layer whose shape is station kind and whose colour is live water state, resolved for every station the app can resolve.

**Architecture:** `mapStyle.ts` stays a pure style-object builder; everything imperative stays in `MapScreen.tsx`. Two new pure modules sit between them — one producing the glyph bitmaps, one resolving station state. The style layer is data-driven on two feature properties (`kind`, `state`), so the colour-is-state/form-is-kind rule remains expressible as a unit test.

**Tech Stack:** TypeScript, maplibre-gl 5.24.0 (`addImage` with `{sdf: true}`, `icon-color`, `icon-halo-*`), vitest 4 (jsdom), React 19.

**Spec:** `docs/superpowers/specs/2026-08-01-map-pin-glyphs-design.md`

## Global Constraints

- **Colour encodes state; form encodes kind.** No layer may derive colour from `kind` or shape from `state`.
- State colours, exact hex (maplibre paint cannot read CSS custom properties): flood/rising `#4a9fd8`, ebb/falling `#e8a33d`, slack `#88b868`, unknown `#7d9cb8`. Halo `#0b1a2b`.
- Reuse the existing `Tone` type from `src/StationGlyph.tsx`: `"rising" | "falling" | "flood" | "ebb" | "slack" | "unknown"`. Do not define a second state vocabulary.
- `pinFeatures`' existing `kind` property and the assertion at `mapStyle.test.ts:18-27` must keep working.
- **`npm test` does not typecheck.** Before every commit run `npx tsc --noEmit` (must be silent), `npm test`, and `npm run build`. See `CLAUDE.md`.
- `src/bundle.test.ts` scans `dist/` — run `npm run build` once in a fresh worktree or it reports 2 false failures.
- Work in `/Users/clarkbw/src/sailingnaturali/slackwater-web/.claude/worktrees/pin-glyphs-ios-port` on branch `worktree-pin-glyphs-ios-port`. Do not push. Do not stage `probe2.mjs` / `probe3.mjs`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/pinGlyphs.ts` | **New.** Glyph polylines + analytic signed-distance-field generation | 1 |
| `src/pinGlyphs.test.ts` | **New.** Field encoding and shape distinction | 1 |
| `src/pinState.ts` | **New.** Station → `Tone`, sync for NOAA, async for CHS | 2 |
| `src/pinState.test.ts` | **New.** Resolution and honest-unknown behaviour | 2 |
| `src/mapStyle.ts` | `pinFeatures` gains states; two circle layers become one symbol layer | 3 |
| `src/mapStyle.test.ts` | The two-axis invariant, map side | 3 |
| `src/MapScreen.tsx` | Image registration, resolve pass, layer ids for click/hover | 4 |

---

### Task 1: Glyph polylines and the distance field

**Why analytic rather than rasterised:** `addImage(…, {sdf: true})` reads the alpha channel as a *distance field*, not as coverage. A canvas-rasterised path gives a 1px alpha ramp, which makes `icon-halo-width: 1.5` mushy and scaling blurry. Our glyphs are strokes of known geometry, so the exact distance from a pixel to the stroke's centreline is a few lines of maths — no canvas, no rasterisation, no `@mapbox/tiny-sdf` (which only handles font glyphs).

**Files:**
- Create: `src/pinGlyphs.ts`
- Create: `src/pinGlyphs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type PinKind = "current" | "tide"`
  - `export const PIN_IMAGE_ID: Record<PinKind, string>` — `{ current: "pin-current", tide: "pin-tide" }`
  - `export const PIN_PIXEL_RATIO = 2`
  - `export function pinGlyphImage(kind: PinKind): { width: number; height: number; data: Uint8Array }` — RGBA, alpha is the SDF. Task 4 passes this straight to `map.addImage`.

- [ ] **Step 1: Write the failing test**

Create `src/pinGlyphs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pinGlyphImage, PIN_IMAGE_ID, PIN_PIXEL_RATIO } from "./pinGlyphs";

const alphaAt = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3];

describe("pinGlyphImage", () => {
  it("produces a square RGBA buffer of the declared size", () => {
    const img = pinGlyphImage("current");
    expect(img.width).toBe(img.height);
    expect(img.data.length).toBe(img.width * img.height * 4);
  });

  it("encodes a signed distance field, not a coverage mask", () => {
    // A coverage mask is almost entirely 0 or 255. A distance field has a
    // broad ramp of intermediate values around the stroke.
    const { data } = pinGlyphImage("current");
    const alphas = [];
    for (let i = 3; i < data.length; i += 4) alphas.push(data[i]);
    const midtones = alphas.filter((a) => a > 40 && a < 215).length;
    expect(midtones).toBeGreaterThan(alphas.length * 0.15);
  });

  it("puts the shape edge at maplibre's 0.75 threshold, and saturates inside", () => {
    const img = pinGlyphImage("tide");
    const mid = Math.floor(img.width / 2);
    // maplibre's SDF shader thresholds the icon fill at buff = 192/256 = 0.75
    // (verified in maplibre-gl 5.24.0: `buff=(256.0-64.0)/256.0`), so the shape
    // edge must encode at ~191 and the interior must exceed it — reaching 255,
    // or the stroke renders thin-to-invisible however correct the geometry is.
    expect(alphaAt(img, 0, 0)).toBe(0); // corner: far outside every stroke
    const column = [];
    for (let y = 0; y < img.height; y++) column.push(alphaAt(img, mid, y));
    expect(Math.max(...column)).toBe(255);
    expect(column.some((a) => a > 180 && a < 205)).toBe(true); // the edge band
  });

  it("draws different shapes for the two kinds", () => {
    const a = pinGlyphImage("current");
    const b = pinGlyphImage("tide");
    expect(Buffer.from(a.data)).not.toEqual(Buffer.from(b.data));
  });

  it("names one image id per kind", () => {
    expect(PIN_IMAGE_ID.current).toBe("pin-current");
    expect(PIN_IMAGE_ID.tide).toBe("pin-tide");
    expect(PIN_PIXEL_RATIO).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pinGlyphs.test.ts`
Expected: FAIL — cannot resolve `./pinGlyphs`.

- [ ] **Step 3: Write the implementation**

Create `src/pinGlyphs.ts`:

```ts
/**
 * The map pins, as signed distance fields.
 *
 * Shape is station KIND — a wave for a current station, a dome over a datum
 * line for a tide station. That is the same language the list uses
 * (StationGlyph), redrawn for pin size: one wave instead of two, heavier
 * strokes, because the list glyph's 50%-opacity second stroke reads as a
 * smudge over bathymetry contours at 22px.
 *
 * Colour is not baked in. These are SDF images, so maplibre tints them with
 * `icon-color` (live state) and rings them with `icon-halo-color` — both of
 * which work on SDF icons only, which is why this file exists at all.
 *
 * The field is computed analytically: exact distance from each pixel to the
 * stroke centreline, minus half the stroke width. A canvas-rasterised path
 * would give a 1px alpha ramp — enough to tint, not enough to halo.
 */

export type PinKind = "current" | "tide";

export const PIN_IMAGE_ID: Record<PinKind, string> = {
  current: "pin-current",
  tide: "pin-tide",
};

/** Drawn at 2x so the 22px pin stays crisp on retina. */
export const PIN_PIXEL_RATIO = 2;

const SIZE = 22 * PIN_PIXEL_RATIO; // field is SIZE x SIZE
/**
 * maplibre's SDF constants, not ours to choose. Its shader thresholds the icon
 * fill at `buff = (256 - 64) / 256 = 0.75` over a field authored with
 * `SDF_PX = 8` texture pixels — so the shape edge encodes at 0.75 (~191), not
 * at the 0.5 an intuitive signed-distance encoding would use. Encode the edge
 * at 0.5 and the whole glyph sits below the shader's threshold and renders
 * invisible, however correct the geometry is. Matches `@mapbox/tiny-sdf`'s
 * `cutoff = 0.25`.
 */
const SDF_PX = 8;
const SDF_CUTOFF = 0.25;

type Pt = { x: number; y: number };
type Stroke = { points: Pt[]; width: number };

/** Sample a parametric curve into a polyline. */
function sample(n: number, f: (t: number) => Pt): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => f(i / n));
}

/**
 * One full sine period across the box — the current glyph. Same idea as the
 * app icon's signed-current curve, at pin scale.
 */
function currentStrokes(): Stroke[] {
  const S = SIZE;
  return [
    {
      width: 0.14 * S,
      points: sample(48, (t) => ({
        x: 0.1 * S + 0.8 * S * t,
        y: 0.5 * S - 0.26 * S * Math.sin(2 * Math.PI * t),
      })),
    },
  ];
}

/** A dome over a datum line — the tide glyph. The line is chart datum. */
function tideStrokes(): Stroke[] {
  const S = SIZE;
  return [
    {
      width: 0.14 * S,
      points: sample(48, (t) => ({
        x: 0.1 * S + 0.8 * S * t,
        y: 0.66 * S - 0.34 * S * Math.sin(Math.PI * t),
      })),
    },
    {
      width: 0.1 * S,
      points: [
        { x: 0.14 * S, y: 0.82 * S },
        { x: 0.86 * S, y: 0.82 * S },
      ],
    },
  ];
}

/** Shortest distance from p to segment ab. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment: fall back to point distance.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Signed distance to the union of strokes: negative inside, positive outside. */
function signedDistance(p: Pt, strokes: Stroke[]): number {
  let best = Infinity;
  for (const s of strokes) {
    const half = s.width / 2;
    for (let i = 0; i < s.points.length - 1; i++) {
      const d = distToSegment(p, s.points[i], s.points[i + 1]) - half;
      if (d < best) best = d;
    }
  }
  return best;
}

export function pinGlyphImage(kind: PinKind): { width: number; height: number; data: Uint8Array } {
  const strokes = kind === "current" ? currentStrokes() : tideStrokes();
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = signedDistance({ x: x + 0.5, y: y + 0.5 }, strokes);
      // 255 * (1 - cutoff - d/SDF_PX): edge (d=0) lands at ~191, the interior
      // saturates to 255, and the field reaches 0 at 6px outside the stroke.
      const a = Math.round(255 * Math.max(0, Math.min(1, 1 - SDF_CUTOFF - d / SDF_PX)));
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  return { width: SIZE, height: SIZE, data };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/pinGlyphs.test.ts`
Expected: PASS, five assertions.

- [ ] **Step 5: Typecheck, full suite, build**

Run: `npx tsc --noEmit` (silent), `npm test`, `npm run build`.
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/pinGlyphs.ts src/pinGlyphs.test.ts
git commit -m "feat(map): pin glyphs as analytic signed distance fields

Shape is station kind, drawn for pin size rather than reusing the
list glyph — the list's 50%-opacity second wave smudges at 22px over
contours. The field is computed from stroke geometry rather than
rasterised, because addImage's sdf mode reads alpha as distance and a
1px coverage ramp is enough to tint but not to halo."
```

---

### Task 2: Resolving station state

**Files:**
- Create: `src/pinState.ts`
- Create: `src/pinState.test.ts`

**Interfaces:**
- Consumes: `Tone` from `src/StationGlyph.tsx`; `Candidate`/`isCurrentStation` from `src/place.ts`; `predict` from `src/tides.ts`; `isNoaaCurrent`/`noaaCurrentState` from `src/noaaCurrents.ts`; `isChs`/`isChsCurrent` from `src/chsStations.ts`; `chsTideDay`/`chsCurrentDay` and `ChsCache`/`indexedDbCache` from `src/chs/*`.
- Produces:
  - `export function syncTone(station: Candidate, now: Date): Tone` — `"unknown"` for anything not resolvable on-device.
  - `export async function resolvePinStates(stations: Candidate[], now: Date, deps?: { cache?: ChsCache; fetchFn?: typeof fetch }): Promise<Record<string, Tone>>` — slug → tone, for every station it can resolve. Task 3 feeds this to `pinFeatures`; Task 4 calls it with no deps.

`fetchFn` exists so tests can stay offline and deterministic: without it, the CHS adapter attempts a real network call under jsdom. It is passed straight through to `chsTideDay` / `chsCurrentDay`, which already accept it.

- [ ] **Step 1: Write the failing test**

Create `src/pinState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { syncTone, resolvePinStates } from "./pinState";
import { memoryCache } from "./chs/cache";
import { resolvedStations } from "./tides";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";
import { candidates } from "./place";
import { isChs } from "./chsStations";

const NOW = new Date("2026-08-01T12:00:00Z");

/** Offline by construction: no test may touch the network. */
const offline: typeof fetch = () => Promise.reject(new Error("offline"));

describe("syncTone", () => {
  it("resolves a bundled NOAA tide station to rising or falling", () => {
    const tone = syncTone(resolvedStations[0], NOW);
    expect(["rising", "falling"]).toContain(tone);
  });

  it("resolves a bundled NOAA current station to flood, ebb or slack", () => {
    const tone = syncTone(resolvedNoaaCurrentStations[0], NOW);
    expect(["flood", "ebb", "slack"]).toContain(tone);
  });

  it("returns unknown for a CHS station — its reading is not on-device", () => {
    const chs = candidates.find(isChs)!;
    expect(syncTone(chs, NOW)).toBe("unknown");
  });
});

describe("resolvePinStates", () => {
  it("resolves every bundled station and omits none silently", async () => {
    const bundled = [resolvedStations[0], resolvedNoaaCurrentStations[0]];
    const states = await resolvePinStates(bundled, NOW, { cache: memoryCache(), fetchFn: offline });
    expect(Object.keys(states).sort()).toEqual(bundled.map((s) => s.slug).sort());
    for (const tone of Object.values(states)) expect(tone).not.toBe("unknown");
  });

  it("reports unknown rather than guessing when the CHS cache misses", async () => {
    const chs = candidates.find(isChs)!;
    // Empty cache, no network: the adapter cannot serve a reading.
    const states = await resolvePinStates([chs], NOW, { cache: memoryCache(), fetchFn: offline });
    expect(states[chs.slug]).toBe("unknown");
  });

  it("never rejects — one station's failure must not blank the whole map", async () => {
    const chs = candidates.find(isChs)!;
    const mixed = [resolvedStations[0], chs];
    const states = await resolvePinStates(mixed, NOW, { cache: memoryCache(), fetchFn: offline });
    expect(Object.keys(states)).toHaveLength(2);
    // The bundled station still resolved despite its neighbour failing.
    expect(states[resolvedStations[0].slug]).not.toBe("unknown");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pinState.test.ts`
Expected: FAIL — cannot resolve `./pinState`.

- [ ] **Step 3: Write the implementation**

Create `src/pinState.ts`:

```ts
import type { Tone } from "./StationGlyph";
import { type Candidate } from "./place";
import { predict } from "./tides";
import { isNoaaCurrent, noaaCurrentState } from "./noaaCurrents";
import { isChs, isChsCurrent, type ChsStation } from "./chsStations";
import { chsTideDay } from "./chs/tide";
import { chsCurrentDay } from "./chs/current";
import { type ChsCache, indexedDbCache } from "./chs/cache";

/**
 * A station's live state as a Tone, for the map pins.
 *
 * Two speeds, deliberately. Bundled NOAA stations predict from their own
 * constituents on-device, so they resolve synchronously. CHS stations fetch
 * theirs — but the offline sync prefetches whole days into IndexedDB, so for a
 * synced station the reading IS available, just asynchronously. That is why
 * this module exists rather than the map simply drawing everything neutral:
 * "not knowable synchronously" is not the same as "not knowable".
 *
 * Anything genuinely unresolved reports `"unknown"`, which the map draws
 * neutral. Never guess — a wrong slack is worse than an honest grey.
 */

/** Resolvable without I/O: bundled NOAA tide and current stations. */
export function syncTone(station: Candidate, now: Date): Tone {
  if (isChs(station)) return "unknown";
  if (isNoaaCurrent(station)) return noaaCurrentState(station, now).phase;
  return predict(station, now).rising ? "rising" : "falling";
}

type ChsDeps = { cache: ChsCache; fetchFn?: typeof fetch };

async function chsTone(station: ChsStation, now: Date, deps: ChsDeps): Promise<Tone> {
  try {
    if (isChsCurrent(station)) return (await chsCurrentDay(station, now, deps)).phase;
    return (await chsTideDay(station, now, deps)).rising ? "rising" : "falling";
  } catch {
    // Offline with nothing cached for this station. The honest answer.
    return "unknown";
  }
}

export async function resolvePinStates(
  stations: Candidate[],
  now: Date,
  deps: { cache?: ChsCache; fetchFn?: typeof fetch } = {},
): Promise<Record<string, Tone>> {
  const chsDeps: ChsDeps = { cache: deps.cache ?? indexedDbCache(), fetchFn: deps.fetchFn };
  const states: Record<string, Tone> = {};
  const pending: Promise<void>[] = [];
  for (const s of stations) {
    if (isChs(s)) {
      pending.push(
        chsTone(s, now, chsDeps).then((tone) => {
          states[s.slug] = tone;
        }),
      );
    } else {
      states[s.slug] = syncTone(s, now);
    }
  }
  // allSettled, not all: one station's failure must not blank the whole map.
  await Promise.allSettled(pending);
  return states;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/pinState.test.ts`
Expected: PASS, seven assertions.

Every CHS test passes `fetchFn: offline`, so no test touches the network. If one still hangs, something is reaching the network by another route — report it rather than adding a timeout.

- [ ] **Step 5: Typecheck, full suite, build**

Run: `npx tsc --noEmit` (silent), `npm test`, `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/pinState.ts src/pinState.test.ts
git commit -m "feat(map): resolve pin state, sync for NOAA and cached for CHS

The earlier claim that most Salish Sea pins have no knowable state
offline was wrong: it reasoned from the synchronous path only, but the
offline sync prefetches CHS days into IndexedDB. Resolves what it can
at both speeds and reports unknown rather than guessing."
```

---

### Task 3: One symbol layer, data-driven on both axes

**Files:**
- Modify: `src/mapStyle.ts` — `pinFeatures` (line ~21), the `PIN_UNKNOWN` block (~36-46), `pinLayers` (~65-121)
- Modify: `src/mapStyle.test.ts`

**Interfaces:**
- Consumes: `PIN_IMAGE_ID`, `PinKind` from Task 1; `Tone` from `src/StationGlyph.tsx`.
- Produces: `pinFeatures(stations: Candidate[], states?: Record<string, Tone>)` — unchanged first parameter, new optional second; each feature gains a `state` property defaulting to `"unknown"`. The pin layer id becomes **`station-pins`** (singular); `station-dots-current` and `station-dots-tide` no longer exist. Task 4 depends on this id.

- [ ] **Step 1: Write the failing test**

Append to `src/mapStyle.test.ts` (`readFileSync` is already imported from the previous change; `LAND`, `pins`, `localFallbackStyle`, `composeStyle` are already in scope):

```ts
describe("pin layer — one symbol layer, two independent axes", () => {
  it("writes a state property, defaulting to unknown", () => {
    const withStates = pinFeatures(candidates, { [candidates[0].slug]: "flood" });
    expect(withStates.features[0].properties!.state).toBe("flood");
    const bare = pinFeatures(candidates);
    expect(bare.features.every((f) => f.properties!.state === "unknown")).toBe(true);
  });

  it("draws pins with a single symbol layer, not circles", () => {
    const style = localFallbackStyle(LAND, pins);
    const pinLayer = style.layers.find((l) => l.id === "station-pins")!;
    expect(pinLayer.type).toBe("symbol");
    expect(style.layers.some((l) => l.id.startsWith("station-dots"))).toBe(false);
  });

  it("keys shape off kind only, and colour off state only", () => {
    const style = localFallbackStyle(LAND, pins);
    const pinLayer = style.layers.find((l) => l.id === "station-pins")!;
    const layout = JSON.stringify((pinLayer.layout as Record<string, unknown>)["icon-image"]);
    const colour = JSON.stringify((pinLayer.paint as Record<string, unknown>)["icon-color"]);
    // Shape reads kind and never state.
    expect(layout).toContain('"kind"');
    expect(layout).not.toContain('"state"');
    // Colour reads state and never kind. This is the invariant.
    expect(colour).toContain('"state"');
    expect(colour).not.toContain('"kind"');
  });

  it("halos every pin so it holds against water and land alike", () => {
    const style = localFallbackStyle(LAND, pins);
    const paint = style.layers.find((l) => l.id === "station-pins")!.paint as Record<string, unknown>;
    expect(paint["icon-halo-color"]).toBe("#0b1a2b");
    expect(paint["icon-halo-width"]).toBeGreaterThan(0);
  });

  it("still refuses to colour by station kind", () => {
    const src = readFileSync(new URL("./mapStyle.ts", import.meta.url), "utf8");
    expect(src).not.toContain("#8fd0a0");
    expect(src).not.toContain("#7fb3d5");
  });
});
```

Add `pinFeatures` and `candidates` to the file's imports if they are not already there (`pinFeatures` is imported at line 3; `candidates` at line 4).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: FAIL — `station-pins` is not a layer.

- [ ] **Step 3: Add the state property to pinFeatures**

In `src/mapStyle.ts`, replace `pinFeatures` (starting line ~21):

```ts
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
        kind: isCurrentStation(s) ? "current" : "tide",
        state: states[s.slug] ?? "unknown",
      },
    })),
  };
}
```

Add to the imports at the top of the file:

```ts
import type { Tone } from "./StationGlyph";
import { PIN_IMAGE_ID } from "./pinGlyphs";
```

- [ ] **Step 4: Replace the two circle layers with one symbol layer**

Replace the `PIN_UNKNOWN` constant block and its comment (lines ~36-46) with:

```ts
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
```

Then replace the `dotBase`/`currentDots`/`tideDots` block inside `pinLayers` (lines ~66-92) with:

```ts
  const pinLayer: StyleLayer = {
    id: "station-pins",
    type: "symbol",
    source: "stations",
    layout: {
      "icon-image": ["match", ["get", "kind"], "current", PIN_IMAGE_ID.current, PIN_IMAGE_ID.tide],
      "icon-size": 1,
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
```

`icon-allow-overlap` and `icon-ignore-placement` are deliberate: maplibre hides colliding symbols by default, and a hidden pin is a station the user cannot tap. Stations are sparse enough that overlap is rare and a hidden pin is worse than a crowded one.

Then update the two `return` statements at the end of `pinLayers`: `if (!style.glyphs) return [currentDots, tideDots];` becomes `if (!style.glyphs) return [pinLayer];`, and `return [currentDots, tideDots, labels];` becomes `return [pinLayer, labels];`.

Update the comment above the `!style.glyphs` check, which currently claims the fallback is "dots only". It is no longer true — icons need no glyph server, only text does:

```ts
  // Labels need glyphs from a glyph server; the local fallback style declares
  // none, so there it is pins without labels. Icons are unaffected — only text
  // needs glyphs — so the fallback still draws the full pin language.
```

- [ ] **Step 5: Run the map tests**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: PASS, including the pre-existing `pinFeatures` `kind` assertion and the composeStyle ordering tests. If an ordering test pins the old layer ids, update the expected ids to `["land-bg", "land", "station-pins"]` — the layer count legitimately dropped from two to one.

- [ ] **Step 6: Typecheck, full suite, build**

Run: `npx tsc --noEmit` (silent), `npm test`, `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add src/mapStyle.ts src/mapStyle.test.ts
git commit -m "feat(map): one symbol layer, shape from kind and colour from state

Two circle layers collapse into one SDF symbol layer. icon-image keys
off kind and icon-color off state, so the two-axis rule is a property
of the style object and can be asserted directly. The local fallback
style gains pins too — icons need no glyph server, only text does."
```

---

### Task 4: Register the images, resolve state, keep interaction alive

**Files:**
- Modify: `src/MapScreen.tsx` — imports, the mount effect (~line 43), `stationAt` (line 92), `pinLayerIds` (line 125)

**Interfaces:**
- Consumes: `pinGlyphImage`, `PIN_IMAGE_ID`, `PIN_PIXEL_RATIO` (Task 1); `resolvePinStates` (Task 2); `pinFeatures` with its states parameter and the `station-pins` layer id (Task 3).
- Produces: no code interface.

- [ ] **Step 1: Register the glyph images on every style load**

`setStyle(…, { diff: false })` (line ~72) **discards registered images**, and this map sets its style twice — the local fallback at construction, then Seascape when its fetch lands. So registration must be idempotent and run on every style load, not once at mount.

Add to the imports at the top of `src/MapScreen.tsx`:

```tsx
import { pinGlyphImage, PIN_IMAGE_ID, PIN_PIXEL_RATIO } from "./pinGlyphs";
import { resolvePinStates } from "./pinState";
```

Then, immediately after `map.addControl(...)` (line ~63), add:

```tsx
    // setStyle({diff:false}) below drops every registered image, and this map
    // styles twice (fallback, then Seascape). So re-register on each style
    // load; hasImage keeps it idempotent.
    const ensurePinImages = () => {
      for (const kind of ["current", "tide"] as const) {
        const id = PIN_IMAGE_ID[kind];
        if (map.hasImage(id)) continue;
        map.addImage(id, pinGlyphImage(kind), { sdf: true, pixelRatio: PIN_PIXEL_RATIO });
      }
    };
    ensurePinImages();
    map.on("styledata", ensurePinImages);
```

- [ ] **Step 2: Resolve state once and push it**

`pins` is currently a `const` computed at mount (line ~46). Make it reassignable so a later `setStyle` carries the enriched features, and push the resolved states into the live source.

Change line ~46 from `const pins = pinFeatures(stations);` to:

```tsx
    // Reassigned once the state pass resolves, so a later setStyle carries the
    // enriched features rather than reverting every pin to neutral.
    let pins = pinFeatures(stations);
```

Then, after the `map.on("styledata", ensurePinImages);` line from Step 1, add:

```tsx
    // Pins draw neutral, then fill in together when the pass completes. One
    // setData rather than per-pin feature state: no feature ids needed, one
    // repaint instead of N, and no popcorn effect. Runs once per map open —
    // state moves over minutes and this is a station picker, not an instrument.
    resolvePinStates(stations, new Date())
      .then((states) => {
        if (gone) return;
        pins = pinFeatures(stations, states);
        const src = map.getSource("stations") as maplibregl.GeoJSONSource | undefined;
        src?.setData(pins);
      })
      .catch(() => {
        /* every pin stays neutral, which is the honest unknown */
      });
```

This must come **after** `let gone = false;` (line ~65) so the guard is in scope. If it does not, move the `resolvePinStates` block below that declaration rather than moving `gone`.

- [ ] **Step 3: Point interaction at the new layer id**

Three sites hardcode the old ids. Missing one silently kills click or hover for a pin kind, with no test catching it — the smoke run never clicks a pin.

`src/MapScreen.tsx:92`, inside `stationAt`:

```tsx
      const hit = map.queryRenderedFeatures(point, { layers: ["station-pins"] })[0];
```

`src/MapScreen.tsx:125`:

```tsx
      const pinLayerIds = ["station-pins"];
```

Leave the `map.on("mouseenter", pinLayerIds, …)` and `map.on("mouseleave", pinLayerIds, …)` calls as they are — they read the constant.

- [ ] **Step 4: Typecheck, full suite, build**

Run: `npx tsc --noEmit` (silent), `npm test`, `npm run build`.
Expected: all pass. `maplibregl.GeoJSONSource` is exported by maplibre-gl 5.24.0; if the cast does not typecheck, report it rather than casting to `any`.

- [ ] **Step 5: Verify in a real browser — this is the step that catches the real bug**

Automated tests cannot see whether pins render or whether clicking one works. Run the dev server and check by hand:

```bash
npm run dev   # then open http://localhost:5173/map
```

Confirm all five:
1. Pins render as **wave** shapes for current stations and **dome-over-line** shapes for tide stations.
2. After a moment they take on colour — blue flooding/rising, amber ebbing/falling, green slack — and any unresolved station stays neutral grey.
3. Every pin has a visible dark edge against both the pale water and the cream land.
4. **Clicking a current pin** opens that station; **clicking a tide pin** opens that station.
5. **Hovering** either kind shows the popup and a pointer cursor.

Report what you actually observed for each. If pins do not appear at all, the most likely cause is images registered after the layer referenced them — check for `Image "pin-current" could not be loaded` in the console, which means `ensurePinImages` is not running on the style that carries the layer.

- [ ] **Step 6: Run the smoke check**

Run: `npm run smoke`
Expected: pass. It does not click pins, so it is a regression check on everything else, not evidence for Step 5.

- [ ] **Step 7: Commit**

```bash
git add src/MapScreen.tsx
git commit -m "feat(map): register pin glyphs and resolve their state on open

Images re-register on every styledata because setStyle({diff:false})
drops them and this map styles twice. State resolves once per open and
lands in a single setData, so pins fill in together rather than
popping in one at a time. Interaction follows the merged layer id."
```

---

## Verification

```bash
npx tsc --noEmit   # silent
npm test           # full suite
npm run build      # tsc + vite
npm run smoke      # puppeteer e2e
```

Then the browser checks from Task 4 Step 5, which are the only evidence that the feature works at all.
