# Gate + tide companion view

2026-07-23 · slackwater-web (and station-corrections for the pairing data)

## What

When a current gate is viewed, show its companion tide port's curve in a second
chart panel below the current chart — one scrub instant and one day-pager
driving both. Malibu Rapids + Point Atkinson is the motivating case: Malibu's
slack *is* derived from Atkinson high/low water, so the two charts are one
dataset shown twice. For ordinary gates (Seymour Narrows + Campbell River) the
pairing is curated proximity, not derivation.

Tide-station pages are unchanged. Gates without a pairing are unchanged.

## Data — station-corrections

Add an optional `tideReference: "<registry-key>"` to current-gate entries.
Validator rules: the key must exist in the registry and be `kind: tide`.

Annotated pairs (confident only):

| Gate | tideReference |
|---|---|
| chs-seymour-narrows | chs-campbell-river |
| chs-first-narrows | chs-vancouver |
| chs-second-narrows | chs-vancouver |
| chs-sechelt-rapids | chs-point-atkinson |
| chs-hole-in-the-wall | chs-owen-bay |
| chs-beazley-passage | chs-owen-bay |
| chs-active-pass | chs-fulford-harbour |
| chs-porlier-pass | chs-fulford-harbour |
| chs-tillicum-bridge | chs-victoria |

Malibu gets no `tideReference` — its existing `derived.reference`
(chs-point-atkinson) doubles as the companion. Gates with no near tide port in
the registry or a genuinely ambiguous reference (race-passage, gabriola-passage,
dodd-narrows, the Yuculta group, the Johnstone-area gates, boundary-pass,
juan-de-fuca-east) stay unannotated and show no companion; pairs can be added
later as one-line registry edits.

Ship: registry version bump + publish, then re-vendor the copy in currents-mcp
(its drift test enforces this).

## Wiring — slackwater-web

- `RegistryEntry` and `ChsStation` gain `tideReference?: string`.
- One resolver: `companionOf(gate: ChsStation): ChsStation | null` — the tide
  port named by `derived.reference` (derived gates) or `tideReference`
  (annotated gates), else null. Resolution failures (key missing, not a tide
  port) are validator territory; the app-side resolver may assume the registry
  is coherent, same as `resolveDerived` does today.
- App.tsx: when a gate is viewed, the existing `useChsTide` call — currently
  handed `null` and idle — is handed the companion port instead. The tide state
  flows through the existing `heldWhileLoading` hold and renders with the
  existing `TideChart`. No new hook, no new fetch path.
- The gate never waits on the companion: if the companion fetch is loading or
  offline, the tide panel is simply absent and the gate view renders exactly as
  today. No spinner, no error copy for the companion.
- For Malibu the companion fetch duplicates the Atkinson HW/LW request the
  slack-derivation path already makes; `src/chs/cache.ts` is expected to
  absorb the duplicate. Verify during implementation — if it doesn't, fix the
  cache rather than special-casing Malibu.

## UI

On a gate page with a companion, below the `CurrentChart` panel: a second
`chart-panel` containing `TideChart` for the companion port, headed by a small
eyebrow-style label naming it ("Tide at Point Atkinson"). Both charts read the
same `now` (`t ?? liveNow`) and call the same `scrub()`, so scrubbing either
chart or paging the schedule moves one shared instant through both.

The event list stays current-only. URLs are unchanged — the gate's slug is the
page; the companion is derived state, never part of the URL.

## Deliberately out (v1)

- HW/LW rows interleaved into the gate's event list
- Tide pages listing/showing their dependent gates
- Nearest-by-distance automatic pairing
- A merged dual-axis chart (tide + current in one panel)

## Tests

- station-corrections: validator test — every `tideReference` resolves to an
  existing `kind: tide` entry.
- slackwater-web: `companionOf` unit tests (derived gate → its reference;
  annotated gate → its port; bare gate → null); an App test that a gate with a
  companion renders both charts and a scrub moves both; Malibu's companion
  resolves to Point Atkinson; a gate with no pairing renders no tide panel.
