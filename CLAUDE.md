# slackwater-web

The no-signal PWA. Workspace-wide context lives in `../CLAUDE.md`; this file is
repo-specific facts that aren't obvious from the code.

## `npm test` is not enough — run `npm run build` too

**`npm test` does not typecheck.** The `test` script is `build:data && vitest run`;
`tsc` only runs as part of `build`. A type error therefore passes the entire suite.

This has already shipped a broken build once: a change typed a parameter
`ViewStation[]` when only `ResolvedStation` carries a `slug`, and all 284 tests
passed straight over `TS2339` while `npm run build` failed. Before calling any
change done:

```bash
npx tsc --noEmit     # must be silent
npm test
npm run build
```

`npm run smoke` (puppeteer, needs a Chrome binary) is the end-to-end check and is
worth running for anything touching the map, offline sync, or the service worker.

## `src/bundle.test.ts` scans `dist/`

It asserts the built bundle reaches for no Node builtins, which means it reads
`dist/assets`. In a fresh clone or worktree that directory doesn't exist yet and
you get 2 failures that have nothing to do with your change. Run `npm run build`
once first. Not a flake — don't go looking for it.

## Colour is state. Form is kind. Never the other way round.

The single design invariant, established 2026-08-01
(`docs/superpowers/specs/2026-08-01-slackwater-design-language-design.md`).

- **Colour** encodes what the water is doing: `--flood` / `--ebb` (a signed
  diverging axis) and `--go` for slack. `--rising` and `--falling` are aliases of
  the first two.
- **Form** encodes what kind of station it is: `StationGlyph`'s wave-vs-dome shape
  on cards, and the circle-vs-square SDF marks in `src/pinGlyphs.ts` for map pins —
  the two surfaces deliberately don't share a mark (see
  `docs/superpowers/specs/2026-08-01-map-pin-glyphs-design.md` §1).
- **Nothing may derive colour from station kind.** The map and the stylesheet
  once disagreed about what green meant — kind on one surface, direction on the
  other — which is the defect this rule exists to prevent.

Station kind comes from `isCurrentStation` in `src/place.ts`. Use it. Do not infer
kind from whether a live reading has arrived: CHS readings are fetched online and
arrive late or never, so `current == null` means "unknown", not "tide station".

Three tests enforce this and will fail loudly if it erodes:

| Test | Catches |
|---|---|
| `src/tokens.test.ts` | retired tokens/hues returning; any font size under 14px (one exception: `.eyebrow` at 12px) |
| `src/StationGlyph.test.tsx` | colour tracking kind, or form tracking state |
| `src/mapStyle.test.ts` | pins coloured by kind — asserts the one pin layer's `icon-image` reads only `kind` and its `icon-color` only `state` |

`--warn` is deliberately a different hue from `--ebb`. They were briefly the same
hex and collided in the event list, where a sunset pill and a max-ebb pill became
indistinguishable. Keep them apart.

## Dark is the only theme

Deliberate, and load-bearing — this gets read at 05:00 in a cockpit where a
paper-white screen destroys night vision. The device preference is ignored on
purpose (`src/styles.css`, top-of-file comment). Legibility complaints are fixed
with size, weight and contrast, never with a light scheme.

## Fonts are the system stack

No webfonts, by design: a font file is a network dependency in an app whose whole
promise is not needing one, and self-hosting only converts that into precache
weight. There is no `woff2` entry in the workbox `globPatterns` for the same
reason. Don't add one back.
