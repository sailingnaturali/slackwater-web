# Map pin glyphs — kind by shape, state by colour, at pin size

*Design spec, 2026-08-01. Follows on from `2026-08-01-slackwater-design-language-design.md`.*

## Why

That spec established the rule — colour encodes water state, form encodes station kind — and applied it
everywhere. On the map it applied it with a deliberate simplification: kind became **filled circle vs
hollow ring**, and every pin drew neutral because state was thought to be unknowable offline. Both
halves of that turned out to be weaker than they needed to be.

**The form does less work than the colour it replaced.** Rendered and inspected at 3× on the merged
build, the two pin forms are technically correct and perceptually marginal: at a 5px radius over pale
water, a filled `#7d9cb8` disc and a ring enclosing pale water are nearly the same tone. The
distinction separates properly over the cream land tone, but almost every station sits over water. A
reader who does not already know the rule will not recover it from the map.

**State is far more knowable than the earlier amendment claimed.** That amendment said "most Salish Sea
pins have no knowable state at draw time," reasoning from `pinReading` (`mapPopup.ts`) returning `null`
for every CHS station. That is true only of the *synchronous* path. CHS readings are cached in
IndexedDB (`src/chs/cache.ts`) and the offline sync prefetches whole days for every CHS station
(`offlineSync.ts:83`), so for any synced station the state is available — just asynchronously. The
honest statement is not "unknowable" but "not knowable *synchronously*".

Together those turn the map from "which stations exist" into "what is the water doing, everywhere, at a
glance" — which is the question the app exists to answer.

## Decisions

1. **Pins become SDF symbol icons**, replacing the two circle layers with one symbol layer.
2. **Shape is kind; colour is state; a halo carries both against the chart.**
3. **The glyph language is shared with the list, but redrawn for pin size** — same meaning, fewer and
   heavier strokes.
4. **State resolves for everything it can**, synchronously for bundled NOAA and asynchronously for CHS
   from the existing cache, and degrades to a neutral "unknown" rather than to a guess.

## 1. The mark

The list glyphs are a 24px double wave (current) and a dome over a datum line (tide). At pin size the
double wave's second stroke — 2.4px at 50% opacity, close beside the first — reads as a smudge over
bathymetry contours. So the pin gets its own drawing at its own size, in the same language:

| Kind | List (24px) | Pin (22px) |
|---|---|---|
| current | two waves, second at 50% | **one wave**, full weight |
| tide | dome + datum line | **dome + shorter datum line** |

Consistency here is of *language*, not of path data: a wave means current and a dome means tide on both
surfaces. Sharing the literal SVG would be a false economy — it optimises for zero drift between two
drawings that have different legibility constraints, and buys that with a pin that cannot be read while
under way.

`icon-halo-color: #0b1a2b` with `icon-halo-width: 1.5` gives every pin a dark separating edge. This is
the specific mechanism that fixes the contrast problem, and it is also why SDF is required: maplibre
supports `icon-color` and `icon-halo-*` **only** on SDF icons (verified against the installed
maplibre-gl 5.24.0 — `sdf: boolean` in the image options, `icon-halo-color` as a `DataDrivenProperty`).

## 2. Layers

The two circle layers (`station-dots-current`, `station-dots-tide`) collapse into **one symbol layer**,
`station-pins`. Both axes become data-driven expressions over feature properties, which keeps the rule
expressible as a test:

```js
"icon-image": ["match", ["get", "kind"], "current", "pin-current", "pin-tide"],
"icon-color": ["match", ["get", "state"],
                "flood", "#4a9fd8",
                "ebb",   "#e8a33d",
                "slack", "#88b868",
                /* unknown */ "#7d9cb8"],
"icon-halo-color": "#0b1a2b",
"icon-halo-width": 1.5,
```

Hex literals rather than CSS custom properties, because maplibre paint expressions cannot read them —
the same necessity already recorded for `PIN_UNKNOWN`.

Two things fall out of this for free. The layer count drops from two to one. And the **local fallback
style can draw pins**: it declares no glyphs, which today forces a dots-only, label-less fallback,
but `icon-image` needs no glyph server — only text does.

## 3. Architecture

The existing seam holds: `mapStyle.ts` stays a pure style-object builder with no map instance, and
everything imperative stays in `MapScreen.tsx`. `map.addImage` is imperative, so:

| File | Responsibility |
|---|---|
| `src/pinGlyphs.ts` **(new)** | The two glyph path definitions and a function rendering each to an SDF-ready bitmap. Pure; exports the image ids. |
| `src/pinState.ts` **(new)** | Resolves station → tone. Synchronous for *both* bundled NOAA kinds — tide stations via `predict` and current stations via `noaaCurrentState` — and async for CHS via an injected cache. |
| `src/mapStyle.ts` | Unchanged role. `pinFeatures` gains an optional states map; `pinLayers` returns the one symbol layer. |
| `src/MapScreen.tsx` | Registers images on style load, runs the resolve pass, pushes the result. |

### State resolution

`pinFeatures(stations, states?)` takes an optional slug → tone map and writes a `state` property per
feature, defaulting to `"unknown"`. On map open `MapScreen` resolves every state it can — NOAA
synchronously, CHS **from the cache only** — and then calls `setData` **once** with the enriched
collection.

**The map never fetches.** *Amended 2026-08-01 after live observation.* CHS state comes from what the
offline sync has already stored in IndexedDB, and from nothing else: `MapScreen` passes a
`fetchFn` that rejects immediately, so `chsTideDay` / `chsCurrentDay` serve from cache or report
`"unknown"`.

This is not an optimisation, it is the difference between working and not. Left to fetch, opening the
map fires one request per unsynced CHS station through a shared rate limiter (`chs/client.ts` —
3-request burst, then one token per 2.5s, ~24/min) with retries on top. With the dozens of CHS
stations in a default Salish Sea view that is both a fetch storm against a third-party API on every
map open, and a wait of well over a minute before a single pin takes on colour — because the one
`setData` is gated on the slowest station. Observed directly: every pin rendered neutral grey across
two captures, with a clean console, because the work was merely still queued.

A station the sync has not reached stays neutral. That is the honest "unknown — tap it" the rest of
this spec describes, and tapping it is what fetches its reading.

One `setData` rather than `setFeatureState` per pin, deliberately: it requires no feature ids, it is a
single repaint instead of N, and the pins fill in together rather than popping in one at a time. The
cost is that pins are briefly neutral before the pass completes, which is honest — that *is* the state
of knowledge at that moment.

Resolution runs **once per map open**. Tide and current state move over minutes and the map is a
station picker, not an instrument. If it ever needs to be live, a timer around the same call is the
upgrade path; do not build it now.

## 4. The known trap

`MapScreen.tsx` hardcodes the pin layer ids for click and hover (`queryRenderedFeatures`, `mouseenter`,
`mouseleave`). When the last change split one layer into two, that omission would have silently killed
all pin interaction, and no test caught it — the smoke run never clicks a pin. This change merges two
layers back into one, so those call sites must move to `station-pins`.

Verification is a real browser check on both kinds — click and hover, current and tide — not an
inference from the diff. That is how it was caught last time and it is cheap.

## 5. Testing

| Test | Catches |
|---|---|
| `pinFeatures` writes `state`, defaults to `"unknown"` | a station with no resolved tone silently inheriting another's colour |
| `pinState` resolves bundled NOAA synchronously; returns `"unknown"` on cache miss | a cache miss being reported as slack |
| `icon-color` matches on `state` and never on `kind`; `icon-image` matches on `kind` and never on `state` | the two-axis rule eroding — the map-side sibling of `StationGlyph.test.tsx` |
| the two glyph path definitions differ | both kinds collapsing to one mark |

The existing `mapStyle.test.ts` assertion that no retired hue survives stays as-is.

## 6. Scope

**In:** the four decisions above, on `slackwater-web`.

**Out:** live/timed state refresh; sharing literal SVG path data with `StationGlyph`; any change to
`pinReading` or the popup; clustering.

**Adjacent, deliberately not bundled:** `maplibre-gl` 6.0.0 is open in dependabot. SDF `addImage` is
stable API and no breakage is expected, but this change is the one place in the app that would care.
Land it either clearly before or clearly after that bump rather than concurrently.
