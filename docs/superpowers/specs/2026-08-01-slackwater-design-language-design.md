# Slackwater design language — colour, type, card, launch

*Design spec, 2026-08-01. Origin: Brandon's first design review of the iOS app.*

## Why

Brandon reviewed Slackwater and filed a list of design complaints. Working through them
surfaced a defect underneath most of them: **the app encodes two different axes in the same two
hues.**

| Where | Value | Meaning |
|---|---|---|
| `mapStyle.ts:40` | `#8fd0a0` green | station **kind** = current |
| `mapStyle.ts:40` | `#7fb3d5` blue | station **kind** = tide |
| `styles.css:54` | `#88b868` green | **direction** = rising / flood |
| `styles.css:55` | `#7fb4d8` blue | **direction** = falling / ebb |

The map says green means "this is a current station." The list, chart and logo say green means
"flooding." Two axes, one pair of hues, four hex points apart. Brandon found the same defect
independently in the app icon, where green is both the flood lobe and the slack dot — slack
being the *absence* of current, painted the same colour as its maximum.

Every other complaint on the list is downstream of this, or is a legibility bug. This spec
settles the language once so the map, list, chart, logo and iOS app stop deciding it separately.

## Decisions

1. **Colour encodes state. Form encodes kind.**
2. **Direction is a signed, diverging axis** — flood/rising at one end, ebb/falling at the
   other, slack at zero. Green leaves the direction scale entirely and becomes the "go" colour.
3. **Type is the system stack.** All three self-hosted webfonts are deleted.
4. **List card layout A** — identity left, state right, kind glyph in the gutter.
5. **`slackwater-web` is the design lab.** iOS ports the settled language afterward.
6. **Launch lands on a station detail view** — nearest, falling back to last-viewed.

## 1. Colour system

```css
/* direction — one signed, diverging axis */
--flood:   #4a9fd8;        /* flood current, rising tide */
--ebb:     #e8a33d;        /* ebb current, falling tide  */
--rising:  var(--flood);   /* alias: reads naturally against state.rising */
--falling: var(--ebb);
/* the go colour — never a direction */
--go:      #88b868;        /* slack, and later the paid go-windows */
```

Deleted: `--rising: #88b868`, `--falling: #7fb4d8`, and `PIN = { tide, current }` in
`mapStyle.ts:40`.

Rationale for amber/blue over the existing green/blue: it is the standard colourblind-safe
diverging pair, it holds up on the navy ground, and it frees green. Green mattering is the
point — Brandon reads green as "go ahead", and for an app named Slackwater the moment you are
waiting for is slack, not flood. Green now points at the thing the app is named after and at
the feature that will be sold.

**Map pins** take the same three state colours. Kind moves to the glyph (§3), so a pin's fill
answers "what is the water doing there" and its shape answers "what kind of station is it."

**`--accent` stays leaf green.** Links, focus rings and buttons keep it. A focus ring is not a
reading and context disambiguates; inventing a second interactive hue to avoid a collision that
does not occur in practice would cost more than it saves. Revisit if go-windows ship a green
span that sits adjacent to green chrome.

## 2. Type system

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, monospace;   /* eyebrows only */
```

`--font-display` is deleted. Every `var(--font-display)` site becomes `var(--font-sans)` with
`font-weight: 600`. Removing the serif *is* the fix for Brandon's "inconsistently applied"
complaint — there is no longer a third family to apply inconsistently. Mono narrows to one job:
the uppercase tracked eyebrow.

Dependencies removed: `@fontsource-variable/fraunces`, `@fontsource-variable/geist`,
`@fontsource-variable/geist-mono`, their three `@import`s at the top of `styles.css`, and their
service-worker precache entries. `styles.css:14-17` argues a webfont must not become a network
dependency in an offline-first app; self-hosting only converted that into precache weight, and
the system stack removes it outright. It also converges the web app with iOS, which is already
SF.

### Legibility floor

Brandon: *"way too small for my old man eyes in bright light."* This is an accessibility bug,
not a taste note, and is not negotiable in the way the rest of the spec is.

| Role | Now | Target |
|---|---|---|
| any text | `0.68rem` floor | **14px floor** |
| eyebrow | `0.7rem` (11.2px) | 12px, tracking unchanged — the one documented exception to the floor, because it is a tracked uppercase label rather than content |
| card name | `1.05rem` display serif | 17px / 600 |
| card value | `1.3rem` display serif | 26px / 600, `tabular-nums` |
| next extreme | `0.82rem` (13.1px) | 14px |
| `--ink-faint` | `#5888a8` (~4.35:1 on ground) | `#7d9cb8` (clears 4.5:1) |

`font-variant-numeric: tabular-nums` applies to every reading and time. It is already on
`.station-card-value` and `.pill`; it extends to the hero value and the event list.

**Dark remains the only scheme.** `styles.css:19-21` is load-bearing — this gets read at 05:00
in a cockpit where a paper-white screen destroys night vision. The bright-light fix is size,
weight and contrast, not a light theme.

## 3. The list card

Layout A. Six facts in two columns of three, which is the symmetry Brandon identified:

```
┌─────────────────────────────────────────┐
│ ~  Boundary Pass              2.4 kn    │
│    Salish Sea                 ↘ Flood   │
│    3.2 NM                Slack 2:14 PM  │
└─────────────────────────────────────────┘
  ^ glyph      ^ identity          ^ state
```

- **Identity left:** name (17px/600), location, distance. Distance moves out of the top-right
  pill and joins the location it belongs to — it is station identity, not a reading.
- **State right:** value (26px/600, tabular), phase word with direction arrow, next extreme at
  14px. Next extreme is the second most important fact on the card and stops being the
  smallest thing on it.
- **Background goes flat** to `--surface`. The diagonal gradient was one fixed value on every
  card; `StationCard.tsx:38-43` already recorded that a tint implying a meaning it does not
  carry would be worse than plain texture. Brandon read meaning into it, exactly as predicted.
  The comment is resolved and removed with the gradient.

### Glyph language

| Glyph | Kind |
|---|---|
| double wave | current station |
| dome over a datum line | tide station |

Glyph **fill is live state**, never kind. A green double wave is a current station at slack —
the single most scannable fact in a mixed list, and the reason kind had to give up colour. The
same two glyphs are the map pins.

`.phase-pill` keeps its shape and retints to the new tokens.

## 4. Navigation

Launch and relaunch resolve to a station detail view:

```
launch
 ├─ location fresh?     → nearest station
 ├─ else last viewed?   → that station
 └─ else               → the list
```

`LocationGate` (`App.tsx:343`) stays for the first-run permission ask, and deep links keep
bypassing it. The gate becomes a one-time screen rather than a wall, because a denied prompt
now still lands on something useful.

The list stays reachable from the existing `.picker` in the topbar, which already opens it as a
sheet. **This is a change to initial state, not a new navigation structure** — no tab bar, no
new routes.

## 5. The logo

Three edits to candidate A in `slackwater-ios/tools/gen-icon.swift`:

1. Crest lobe green → `--flood` blue; trough lobe → `--ebb` amber (lines 120-121).
2. Slack dot stays green. Green now means *only* slack, so the double duty is gone without
   redrawing the mark.
3. Zero line extends `0 → S` rather than `0.06S → 0.94S` (line 118), matching the curve's
   bleed. This is Brandon's "why doesn't the line extend the full width" — it was an inset
   against a curve that bleeds off-frame, and it read as unfinished.

**On "the curve doesn't read as a true sine":** it is one —
`y = zero - amp·sin(2π(t - 0.5))`, uniformly sampled over `[x0, x1]`, no distortion. The
suggested `x0: 0, x1: S` fixes the bleed mismatch, which is edit 3. The crest-looks-thin effect
is the round-cap uniform stroke and is optical; it is left alone deliberately, and Brandon gets
told why rather than us chasing it.

The web app's `favicon.svg` and `icon-192/512.png` still carry the older two-wave mark, so web
and iOS currently ship different logos. `icon-192.png` and `icon-512.png` are re-rendered from
the corrected `gen-icon.swift`; `favicon.svg` is hand-authored to match it, since the generator
emits PNG only. `gen-icon.swift` lives in `slackwater-ios` but its edit belongs to this work —
it is the single source for both apps' raster icons.

## 6. Scope

**In, on `slackwater-web`:** §1 colour, §2 type, §3 card, §4 launch, and the icon assets. §5
additionally touches one file in `slackwater-ios` (`tools/gen-icon.swift`), which is the shared
generator for both apps' raster icons.

**iOS-only:** the Station Detail map header shrink. Brandon's note — *"map takes the most prime
real-estate, I like having it at the top"* — describes `MapHeader.swift`. On web the map is a
separate full-screen view (`App.tsx:345`, `.map-screen { height: 100dvh }`) and **stays that
way**; a web viewport is not a phone and the full-screen map is the better call there. iOS
ports §1-§4 after web lands.

**Out of scope, own specs:** giving the map header additional information, and go-windows.

## 7. Testing

Existing tests assert current markup and are updated **with** each change, not after:
`StationCard.test.tsx`, `StationList.test.tsx`, `mapStyle.test.ts`, and `scripts/smoke.mjs`
(which reads `.reading-compact`).

Two new checks carry the invariants this spec exists to establish:

1. **No component references a deleted token** — `--font-display`, the old `--rising`/
   `--falling` literals, or `PIN`. A grep-style assertion over `src/`.
2. **Glyph differs by station kind while its colour tracks state** — a current station at slack
   and a tide station at slack render the *same* colour and *different* glyphs; the same
   current station at flood renders the *same* glyph and a *different* colour. This is the
   two-axis separation stated as a test, and it fails loudly if anyone reintroduces
   colour-means-kind.

## Order of work

1. Tokens and type (§1, §2) — mechanical, touches every file, lands first so nothing is built
   against the old language.
2. List card A and the glyph language (§3).
3. Launch-into-detail (§4).
4. Icon regeneration (§5), web and iOS.
5. Map pins onto the shared glyph + state colours (§1, §3).

Each step keeps the app green; none depends on a later one.
