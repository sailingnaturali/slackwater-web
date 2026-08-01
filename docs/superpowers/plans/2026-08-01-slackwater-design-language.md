# Slackwater Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the app's two visual axes — colour encodes water state, form encodes station kind — and land the type, card, launch and icon changes that follow from it.

**Architecture:** Purely presentational. No prediction, data or offline behaviour changes. Task 1 replaces the design tokens so nothing downstream is built against the old language; Tasks 2-5 each consume those tokens and are independent of one another.

**Tech Stack:** React 19, TypeScript, Vite 8, vitest 4 (jsdom), `renderToStaticMarkup` for component assertions, maplibre-gl 5, puppeteer-core for `scripts/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-01-slackwater-design-language-design.md`

## Global Constraints

- **Colour encodes state; form encodes kind.** No component may set colour from station kind.
- Direction tokens, exact values: `--flood: #4a9fd8`, `--ebb: #e8a33d`, `--go: #88b868`.
- `--rising` is an alias of `--flood`; `--falling` is an alias of `--ebb`.
- `--accent` stays `var(--sn-leaf)` — links, focus rings and buttons are unchanged.
- Font stacks, exact values: `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` and `--font-mono: ui-monospace, SFMono-Regular, monospace`. `--font-display` is deleted.
- **14px minimum font size**, with exactly one exception: `.eyebrow` at 12px.
- `--ink-faint: #7d9cb8` (the old `#5888a8` fails 4.5:1 on the ground).
- Dark remains the only colour scheme. Do not add a light theme or `prefers-color-scheme` block.
- Run `npm test` (which runs `build:data` first) before every commit. Do not stage `probe2.mjs` or `probe3.mjs` — pre-existing untracked files, unrelated to this work.
- Repo is `slackwater-web` on `main`, except Task 4 Step 5-7 which edit `../slackwater-ios`.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/styles.css` | All design tokens and component styles | 1, 2 |
| `package.json` / `vite.config.ts` | Font dependency + precache removal | 1 |
| `src/StationGlyph.tsx` | **New.** The kind-glyph, tinted by state | 2 |
| `src/StationGlyph.test.tsx` | **New.** The two-axis invariant | 2 |
| `src/StationCard.tsx` | List card layout A | 2 |
| `src/StationCard.test.tsx` | Card assertions | 2 |
| `src/App.tsx` | Initial station resolution | 3 |
| `src/App.test.tsx` | Launch resolution assertions | 3 |
| `slackwater-ios/tools/gen-icon.swift` | Icon generator, shared source | 4 |
| `public/favicon.svg`, `public/icon-*.png` | Web icon assets | 4 |
| `src/mapStyle.ts` | Pin layers | 5 |
| `src/mapStyle.test.ts` | Pin assertions | 5 |

---

### Task 1: Tokens and type

Replaces the design language at its root. Every later task depends on these tokens existing.

**Files:**
- Modify: `src/styles.css:24-62` (token block), plus the six `var(--font-display)` sites at lines 82, 372, 660, 684, 723, 984 and the size/contrast sites listed in Step 5
- Modify: `src/styles.css:1-3` (font `@import`s)
- Modify: `package.json` (three dependencies)
- Modify: `vite.config.ts` (workbox `globPatterns` + its comment)
- Test: `src/tokens.test.ts` (**new**)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--flood`, `--ebb`, `--go`, `--rising`, `--falling`, `--font-sans`, `--font-mono`, `--ink-faint`. Tasks 2 and 5 reference these by name. `--font-display` no longer exists.

- [ ] **Step 1: Write the failing test**

Create `src/tokens.test.ts`. This is the grep-style guard from spec §7.1 — it fails if anyone reintroduces the old language.

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("defines the diverging direction axis and the go colour", () => {
    expect(css).toContain("--flood: #4a9fd8");
    expect(css).toContain("--ebb: #e8a33d");
    expect(css).toContain("--go: #88b868");
    expect(css).toContain("--rising: var(--flood)");
    expect(css).toContain("--falling: var(--ebb)");
  });

  it("has no display serif left to apply inconsistently", () => {
    expect(css).not.toContain("--font-display");
    expect(css).not.toContain("Fraunces");
  });

  it("uses the system stack", () => {
    expect(css).toContain("--font-sans: system-ui");
    expect(css).toContain("--font-mono: ui-monospace");
    expect(css).not.toContain("@fontsource");
  });

  it("raises faint ink to a 4.5:1 contrast", () => {
    expect(css).toContain("--ink-faint: #7d9cb8");
    expect(css).not.toContain("#5888a8");
  });

  it("keeps no font size below the 14px floor except the eyebrow", () => {
    // rem sizes below 0.875rem (14px) are the bug Brandon reported.
    const tooSmall = [...css.matchAll(/font-size:\s*(0\.\d+)rem/g)]
      .map((m) => Number(m[1]))
      .filter((v) => v < 0.875);
    expect(tooSmall).toEqual([0.75]); // the single .eyebrow exception, 12px
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tokens.test.ts`
Expected: FAIL — `--flood: #4a9fd8` is not in the file.

- [ ] **Step 3: Replace the token block**

In `src/styles.css`, delete the three `@import` lines at the very top (lines 1-3).

Then replace lines 42-58 (the font and semantic layer) with:

```css
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, monospace;

  /* Semantic layer — the only things components reference.
   *
   * Colour encodes STATE. Form encodes KIND. These are two different axes and
   * they used to share one pair of hues: the map painted station kind in
   * green/blue while this file painted direction in the same green/blue, so a
   * green dot meant "current station" on one surface and "flooding" on
   * another. Direction is now a signed diverging axis (amber<->blue, the
   * standard colourblind-safe pair), which frees green to mean only slack —
   * the moment the app is named for. Never colour anything by station kind.
   */
  --ground: var(--sn-navy-deep);
  --ink: #eaf2f7;
  --ink-soft: rgba(234, 242, 247, 0.78);
  --ink-faint: #7d9cb8;
  --surface: #06203f;
  --hairline: #14375c;
  --accent: var(--sn-leaf);
  --flood: #4a9fd8;
  --ebb: #e8a33d;
  --go: #88b868;
  --rising: var(--flood);
  --falling: var(--ebb);
  --curve: var(--sn-sky);
  --selected: var(--sn-harbor);
  --warn: #e8a33d;
```

Note `--sn-steel: #5888a8` at line 32 stays — it is still used for hover borders — but `--ink-faint` no longer points at it.

- [ ] **Step 4: Remove the display serif**

Replace `font-family: var(--font-display);` with `font-family: var(--font-sans);` at each of the six sites, and set the weight where the serif's 500 was carrying the emphasis:

| Line | Selector | Change |
|---|---|---|
| 82 | `h1, h2` | family → sans, `font-weight: 600` |
| 372 | `.reading .value` | family → sans, `font-weight: 600` |
| 660 | `.station-card-name` | family → sans, `font-weight: 600`, `font-size: 17px` |
| 684 | `.station-card-value` | family → sans, `font-weight: 600`, `font-size: 26px` |
| 723 | `.location-title` | family → sans, `font-weight: 600` |
| 984 | `.map-popup-name` | family → sans, `font-weight: 600` |

- [ ] **Step 5: Raise the sizes to the floor**

Apply the 14px floor. Every `font-size` below `0.875rem` becomes `0.875rem`, except `.eyebrow`, which becomes `0.75rem` (12px — a tracked uppercase label, not content). The sites are:

```
99-100   .eyebrow              0.7rem  -> 0.75rem
356      .reading .dir         0.72rem -> 0.875rem
391      .chart text           11px    -> 14px
475      .event .pill          0.68rem -> 0.875rem
585      .station-group count  0.7rem  -> 0.875rem
665      .pill                 0.7rem  -> 0.875rem
696      .phase-pill           0.7rem  -> 0.875rem
307,333  .chooser              0.8rem  -> 0.875rem
419,434  .events-date, .today  0.8rem/0.85rem -> 0.875rem
673,674  .station-card-context / -next  0.82rem -> 0.875rem
729,749  .location-action, settings     0.82rem/0.85rem -> 0.875rem
```

Add `font-variant-numeric: tabular-nums;` to `.reading .value` (line ~372) and `.event time` / `.event .height` (lines ~497-498).

- [ ] **Step 6: Run the token test**

Run: `npx vitest run src/tokens.test.ts`
Expected: PASS, all five assertions.

- [ ] **Step 7: Drop the font packages and their precache**

```bash
npm uninstall @fontsource-variable/fraunces @fontsource-variable/geist @fontsource-variable/geist-mono
```

In `vite.config.ts`, change the `globPatterns` line and correct the comment above it, which currently explains why `woff2` is in the list. Chesterton's fence applies in reverse here: the reason is gone, so the entry and its justification both go.

Replace:
```js
        // The station data and the engine are the whole product offline, so they
        // are precached rather than fetched on demand. woff2 is in here too —
        // the self-hosted fonts (see README: no webfont request, on purpose)
        // otherwise fail with ERR_INTERNET_DISCONNECTED the moment the network
        // actually goes away, which the offline smoke check caught.
```
with:
```js
        // The station data and the engine are the whole product offline, so they
        // are precached rather than fetched on demand. There is no woff2 entry:
        // the app uses the system font stack, so there is no font file to miss
        // when the network goes away.
```
and change `globPatterns` to:
```js
        globPatterns: ["**/*.{js,css,html,svg,png,json}"],
```

- [ ] **Step 8: Run the full suite and the build**

Run: `npm test`
Expected: PASS. Some `StationCard`/`mapStyle` tests still pass here because Task 1 changes no markup.

Run: `npm run build`
Expected: succeeds; no unresolved `@fontsource` import.

- [ ] **Step 9: Commit**

```bash
git add src/styles.css src/tokens.test.ts package.json package-lock.json vite.config.ts
git commit -m "feat(design): colour encodes state, form encodes kind; system type

Direction becomes a signed amber<->blue diverging axis and green
narrows to slack, so the map's kind colours and the list's direction
colours stop meaning different things in the same hues. Drops the
three self-hosted webfonts for the system stack and raises every
size to a 14px floor."
```

---

### Task 2: List card layout A and the kind glyph

**Files:**
- Create: `src/StationGlyph.tsx`
- Create: `src/StationGlyph.test.tsx`
- Modify: `src/StationCard.tsx` (whole component body, lines 35-132)
- Modify: `src/styles.css` (`.station-card*` block, lines 639-707)
- Modify: `src/StationCard.test.tsx`

**Interfaces:**
- Consumes: `--flood`, `--ebb`, `--go`, `--ink-faint` from Task 1.
- Produces: `StationGlyph({ kind, tone })` where `kind: "tide" | "current"` and `tone: "rising" | "falling" | "flood" | "ebb" | "slack" | "unknown"`. Task 5 does **not** use this component (the map uses circle layers), but reuses the same `tone` vocabulary.

- [ ] **Step 1: Write the failing glyph test**

Create `src/StationGlyph.test.tsx`. This is spec §7.2 — the two-axis invariant stated as a test.

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationGlyph } from "./StationGlyph";

const render = (kind: "tide" | "current", tone: string) =>
  renderToStaticMarkup(<StationGlyph kind={kind} tone={tone as never} />);

// The shape of the path data is what distinguishes kind; the class is what
// distinguishes state. Compare the <path d="..."> set, not the whole markup.
const paths = (html: string) => [...html.matchAll(/d="([^"]+)"/g)].map((m) => m[1]).join("|");
const toneClass = (html: string) => html.match(/class="station-glyph (\w+)"/)![1];

describe("StationGlyph — colour is state, form is kind", () => {
  it("gives the same colour to different kinds in the same state", () => {
    const tide = render("tide", "slack");
    const current = render("current", "slack");
    expect(toneClass(tide)).toBe(toneClass(current));
    expect(paths(tide)).not.toBe(paths(current));
  });

  it("gives the same form to one kind across different states", () => {
    const flood = render("current", "flood");
    const ebb = render("current", "ebb");
    expect(paths(flood)).toBe(paths(ebb));
    expect(toneClass(flood)).not.toBe(toneClass(ebb));
  });

  it("falls back to a neutral tone when state is unknown", () => {
    expect(toneClass(render("tide", "unknown"))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/StationGlyph.test.tsx`
Expected: FAIL — cannot resolve `./StationGlyph`.

- [ ] **Step 3: Write the glyph component**

Create `src/StationGlyph.tsx`:

```tsx
/**
 * A station's kind, drawn — double wave for a current station, a dome over a
 * datum line for a tide station. The glyph's COLOUR is its live state and
 * never its kind: that separation is the whole point (see styles.css, semantic
 * layer). A green double wave is a current station at slack, which is the most
 * useful thing to spot while scrolling a mixed list.
 */
export type Tone = "rising" | "falling" | "flood" | "ebb" | "slack" | "unknown";

export function StationGlyph({ kind, tone }: { kind: "tide" | "current"; tone: Tone }) {
  return (
    <svg
      className={`station-glyph ${tone}`}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={kind === "current" ? "Current station" : "Tide station"}
    >
      {kind === "current" ? (
        <>
          <path d="M2 9c3-5 5-5 8 0s5 5 8 0 4-3 4-3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M2 16c3-5 5-5 8 0s5 5 8 0 4-3 4-3" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
        </>
      ) : (
        <>
          <path d="M3 15c4-9 14-9 18 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M3 19h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".45" />
        </>
      )}
    </svg>
  );
}
```

- [ ] **Step 4: Add the glyph styles**

Append to `src/styles.css` near the `.station-card` block:

```css
/* Kind is the shape; state is the colour. Never the other way round. */
.station-glyph { width: 26px; height: 26px; flex: 0 0 auto; margin-top: 2px; color: var(--ink-faint); }
.station-glyph.rising, .station-glyph.flood { color: var(--flood); }
.station-glyph.falling, .station-glyph.ebb { color: var(--ebb); }
.station-glyph.slack { color: var(--go); }
.station-glyph.unknown { color: var(--ink-faint); }
```

- [ ] **Step 5: Run the glyph test**

Run: `npx vitest run src/StationGlyph.test.tsx`
Expected: PASS, three assertions.

- [ ] **Step 6: Update the card test for layout A**

In `src/StationCard.test.tsx`, replace the `"shows a distance pill only when km is given"` test — distance is no longer a pill, it is a third identity line:

```tsx
  it("shows distance with the identity, not as a pill", () => {
    const withKm = renderToStaticMarkup(
      <StationCard station={station} km={12} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withKm).toContain("station-card-dist");
    expect(withKm).not.toContain('class="pill"');

    const withoutKm = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withoutKm).not.toContain("station-card-dist");
  });

  it("renders a kind glyph whose colour tracks state, not kind", () => {
    const rising = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    const falling = renderToStaticMarkup(
      <StationCard station={station} state={{ ...state, rising: false }} units="imperial" onSelect={() => {}} />,
    );
    expect(rising).toContain("station-glyph rising");
    expect(falling).toContain("station-glyph falling");
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/StationCard.test.tsx`
Expected: FAIL — `station-card-dist` is not rendered.

- [ ] **Step 8: Rewrite the card for layout A**

In `src/StationCard.tsx`, replace the doc comment at lines 35-44 and the `card` JSX. The gradient rationale comment goes with the gradient.

```tsx
/**
 * One station, everywhere it appears — the sidebar groups and search results.
 * Same card, so the two views can never drift.
 *
 * Layout A (spec §3): six facts in two columns of three. Identity left — name,
 * location, distance — because distance is station identity, not a reading, and
 * belongs with the location it qualifies. State right — value, phase, next
 * extreme. Scan left to find the station, right to read the water.
 *
 * The card used to carry a diagonal gradient, one fixed value on every card. It
 * encoded nothing but looked like it did, and the first outside reviewer duly
 * tried to decode it. Flat surface now; colour on this card means state.
 */
export function StationCard({ ... }) {   // signature unchanged
  const tone: Tone = current
    ? (current.phase as Tone)
    : state
      ? (state.rising ? "rising" : "falling")
      : "unknown";

  const card = (
    <button
      className={selected ? "station-card current" : "station-card"}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <StationGlyph kind={current ? "current" : "tide"} tone={tone} />

      <div className="station-card-main">
        <p className="station-card-name">{station.name}</p>
        {station.context && <p className="station-card-context">{station.context}</p>}
        {km != null && (
          <p className="station-card-dist">
            {formatDistance(km, units)} {distanceUnit(units)}
          </p>
        )}
      </div>

      <div className="station-card-reading">
        {state && !current && (
          <>
            <span className="station-card-value">
              {formatHeight(state.level, units)}
              <abbr>{heightUnit(units)}</abbr>
            </span>
            <span className={state.rising ? "dir rising" : "dir falling"}>
              {state.rising ? "▲ Rising" : "▼ Falling"}
            </span>
          </>
        )}
        {current &&
          (current.derived || current.phase === "slack" ? (
            <span className={`phase-pill ${current.phase}`}>{current.phase}</span>
          ) : (
            <>
              <span className="station-card-value">
                {formatSpeed(current.speed, speedUnit)}
                <abbr>{speedUnitLabel(speedUnit)}</abbr>
              </span>
              <span className={`dir ${current.phase}`}>
                <CompassArrow deg={current.setDegrees} className={current.phase} />{" "}
                {current.phase === "flood" ? "Flood" : "Ebb"}
              </span>
            </>
          ))}
        {state?.next && (
          <p className="station-card-next">
            {state.next.high ? "High" : "Low"} {formatHeight(state.next.level, units)}{" "}
            {heightUnit(units)} · {cardTime(state.next.time, station.timezone)}
          </p>
        )}
        {current?.nextSlack && (
          <p className="station-card-next">
            {TURN_LABEL[current.nextSlack.kind]} · {cardTime(current.nextSlack.time, station.timezone)}
          </p>
        )}
      </div>
    </button>
  );

  return card;
}
```

Add the import at the top: `import { StationGlyph, type Tone } from "./StationGlyph";`

- [ ] **Step 9: Update the card styles**

In `src/styles.css`, replace the `.station-card` rule (line 641) — the gradient becomes flat — and add the new identity/state rules:

```css
.station-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 0.85rem 1rem;
  cursor: pointer;
  text-align: left;
}
.station-card-main { display: flex; flex-direction: column; min-width: 0; gap: 0.15rem; flex: 1 1 auto; }
.station-card-name { font-family: var(--font-sans); font-weight: 600; font-size: 17px; margin: 0; }
.station-card-context { margin: 0; font-size: 0.875rem; color: var(--ink-faint); }
.station-card-dist { margin: 0; font-size: 0.875rem; color: var(--ink-faint); font-variant-numeric: tabular-nums; }
.station-card-reading {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
  flex-shrink: 0;
  text-align: right;
}
.station-card-value {
  font-family: var(--font-sans);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-size: 26px;
  line-height: 1.1;
}
.station-card-next { margin: 0; font-size: 0.875rem; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
```

Delete the now-stale comment at lines 639-640 that describes the fixed gradient. The `.station-card-title` rule is unused — delete it.

- [ ] **Step 10: Run the tests**

Run: `npx vitest run src/StationCard.test.tsx src/StationGlyph.test.tsx src/StationList.test.tsx`
Expected: PASS. `StationList.test.tsx` needs no edit — it asserts on station names and group structure, never on `.pill` or `.station-card-title`.

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/StationGlyph.tsx src/StationGlyph.test.tsx src/StationCard.tsx src/StationCard.test.tsx src/styles.css
git commit -m "feat(card): layout A, kind glyph, flat surface

Identity left (name, location, distance), state right (value, phase,
next extreme). Distance leaves the top-right pill and joins the
location it qualifies. The fixed diagonal gradient goes flat — it
encoded nothing and the first outside reviewer tried to decode it."
```

---

### Task 3: Launch into the last-viewed station

Smaller than it looks. `useLocation` already swaps in the nearest station once location resolves (`App.tsx:194-212`) and the declined branch already opens the list (`App.tsx:228`). The only gap is the initial station, which is a hardcoded Friday Harbor.

**Files:**
- Modify: `src/App.tsx:56` (add helper), `src/App.tsx:135` (initialiser)
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `loadSaved()` and `Saved.recent` from `src/savedStations.ts` (already imported by `App.tsx`).
- Produces: `initialStation(urlMatch, saved, all)` — exported from `App.tsx` for test.

- [ ] **Step 1: Write the failing test**

Append to `src/App.test.tsx`:

```tsx
import { initialStation } from "./App";

describe("initialStation", () => {
  const a = { slug: "everett", name: "Everett" } as never;
  const b = { slug: "friday-harbor", name: "Friday Harbor" } as never;
  const all = [a, b];
  const empty = { starred: [], recent: [], lastLocationSlug: null, placeStations: {} };

  it("prefers a deep link over everything", () => {
    const saved = { ...empty, recent: ["everett"] };
    expect(initialStation({ station: b } as never, saved, all)).toBe(b);
  });

  it("falls back to the last viewed station", () => {
    expect(initialStation(null, { ...empty, recent: ["everett"] }, all)).toBe(a);
  });

  it("falls back to the fixed station when nothing is remembered", () => {
    expect(initialStation(null, empty, all)).toBe(b);
  });

  it("ignores a remembered slug that no longer resolves", () => {
    expect(initialStation(null, { ...empty, recent: ["sunk-island"] }, all)).toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — `initialStation` is not exported.

- [ ] **Step 3: Add the helper**

In `src/App.tsx`, immediately after the `FALLBACK` definition at line 56:

```tsx
/**
 * Which station a cold load opens. A deep link always wins. Otherwise the last
 * station actually viewed, which `visit()` already persists — reopening the app
 * where you left off beats a fixed station you have no connection to. FALLBACK
 * (Friday Harbor) is the floor for a genuinely first-ever load.
 *
 * Nearest-when-located is NOT handled here: the useLocation effect below swaps
 * the station in once a position resolves, which is the right sequencing —
 * showing something immediately beats blocking on a permission prompt.
 */
export function initialStation(
  urlMatch: { station: ViewStation } | null,
  saved: Saved,
  all: ViewStation[] = resolvedStations,
): ViewStation {
  if (urlMatch) return urlMatch.station;
  const slug = saved.recent[0];
  return (slug && all.find((s) => s.slug === slug)) || FALLBACK;
}
```

- [ ] **Step 4: Use it**

`App.tsx:135` — note `saved` is initialised on the line below `station` today, so move the `saved` `useState` above the `station` one first, then:

```tsx
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [station, setStation] = useState<ViewStation>(() => initialStation(urlMatch, saved));
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS, four assertions.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(launch): open the last viewed station, not a fixed one

Nearest-when-located already worked via the useLocation effect; the
gap was a cold load always landing on Friday Harbor regardless of
what you last looked at."
```

---

### Task 4: Icon

**Files:**
- Modify: `../slackwater-ios/tools/gen-icon.swift:118` and `:120-121`
- Replace: `public/icon-192.png`, `public/icon-512.png`
- Modify: `public/favicon.svg`
- Replace: `../slackwater-ios/Slackwater/Assets.xcassets/AppIcon.appiconset/icon-1024.png`

**Interfaces:**
- Consumes: the `--flood` / `--ebb` / `--go` values from Task 1, as literal hex.
- Produces: no code interface.

**Note:** this task has no unit test — it produces images. Verification is visual, in Step 4.

- [ ] **Step 1: Recolour the lobes**

In `../slackwater-ios/tools/gen-icon.swift`, `candidateA()`, lines 120-121. The crest lobe is flood and the trough lobe is ebb, so they take `--flood` blue and `--ebb` amber. The dot stays leaf green because green now means *only* slack — which is what removes the double duty, not a redraw.

Replace:
```swift
    fillLobe(ctx, pts, zero: zero, above: true, top: rgb(0x88B868, 0.6), bottom: rgb(0x88B868, 0.05))
    fillLobe(ctx, pts, zero: zero, above: false, top: rgb(0x7FB4D8, 0.05), bottom: rgb(0x7FB4D8, 0.6))
```
with:
```swift
    // Flood above the zero line, ebb below — the app's diverging direction
    // axis. Green is absent here on purpose: it means slack, and slack is the
    // dot at the crossing, not a lobe.
    fillLobe(ctx, pts, zero: zero, above: true, top: rgb(0x4A9FD8, 0.6), bottom: rgb(0x4A9FD8, 0.05))
    fillLobe(ctx, pts, zero: zero, above: false, top: rgb(0xE8A33D, 0.05), bottom: rgb(0xE8A33D, 0.6))
```

- [ ] **Step 2: Extend the zero line**

Line 118 draws the line inset to `0.06S…0.94S` while `curvePoints` at line 113 runs `-0.06S…1.06S` and bleeds off-frame. That mismatch is what reads as unfinished.

Replace:
```swift
    ctx.addLines(between: [CGPoint(x: S * 0.06, y: zero), CGPoint(x: S * 0.94, y: zero)])
```
with:
```swift
    // Full width: the curve bleeds off both edges, so an inset line reads as
    // unfinished rather than as a deliberate margin.
    ctx.addLines(between: [CGPoint(x: 0, y: zero), CGPoint(x: S, y: zero)])
```

Leave `curvePoints` and the sine itself alone. The curve is a true sine — `y = zero - amp·sin(2π(t-0.5))`, uniformly sampled — and the crest-looks-thin effect is the round-cap uniform stroke, which is optical.

- [ ] **Step 3: Regenerate**

```bash
cd ../slackwater-ios && swift tools/gen-icon.swift /tmp/sw-icons && ls /tmp/sw-icons
```
Expected: writes `icon-candidate-a.png`, `-b`, `-c`.

- [ ] **Step 4: Look at it**

Open `/tmp/sw-icons/icon-candidate-a.png`. Confirm: blue crest lobe, amber trough lobe, green dot at the centre crossing, zero line running edge to edge. If the dot no longer reads against the blue lobe, the navy ring at line 93-95 is the knob to widen — do not change the dot's colour.

- [ ] **Step 5: Install as the iOS app icon**

```bash
cd ../slackwater-ios && sips -z 1024 1024 /tmp/sw-icons/icon-candidate-a.png \
  --out Slackwater/Assets.xcassets/AppIcon.appiconset/icon-1024.png
```

- [ ] **Step 6: Install as the web icons**

```bash
cd ../slackwater-web
sips -z 192 192 /tmp/sw-icons/icon-candidate-a.png --out public/icon-192.png
sips -z 512 512 /tmp/sw-icons/icon-candidate-a.png --out public/icon-512.png
```

- [ ] **Step 7: Hand-author the favicon to match**

`gen-icon.swift` emits PNG only, so `public/favicon.svg` is written by hand. It still carries the retired two-wave mark. Replace its whole contents:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#05122A"/><path d="M0 32 C 8 12, 16 12, 24 32 S 40 52, 48 32 S 60 22, 64 26" fill="none" stroke="#C0D8E4" stroke-width="4.5" stroke-linecap="round"/><line x1="0" y1="32" x2="64" y2="32" stroke="#E4F0E4" stroke-width="1" opacity=".2"/><circle cx="24" cy="32" r="6" fill="#88B868" stroke="#05122A" stroke-width="1.5"/></svg>
```

- [ ] **Step 8: Update the manifest theme colour**

`vite.config.ts` sets `theme_color` and `background_color` to `#0b1a2b`, the retired icon's navy. The icon field is `#05122A` (`gen-icon.swift:17`). Set both to `#05122A`.

- [ ] **Step 9: Build and commit**

Run: `npm run build`
Expected: succeeds.

```bash
git add public/favicon.svg public/icon-192.png public/icon-512.png vite.config.ts
git commit -m "feat(icon): flood blue, ebb amber, green means only slack

The mark painted the flood lobe and the slack dot the same green, so
green meant both maximum current and no current. Recolours the lobes
onto the diverging axis and leaves the dot as the sole green. Also
extends the zero line to full width to match the curve's bleed."

cd ../slackwater-ios
git add tools/gen-icon.swift Slackwater/Assets.xcassets/AppIcon.appiconset/icon-1024.png
git commit -m "feat(icon): flood blue, ebb amber, green means only slack"
```

---

### Task 5: Map pins

**Files:**
- Modify: `src/mapStyle.ts:36-40`, `:58-69`
- Test: `src/mapStyle.test.ts`

**Interfaces:**
- Consumes: the `--flood` / `--ebb` / `--go` hex values, as literals (maplibre paint cannot read CSS custom properties).
- Produces: pin layer ids `station-dots-current` and `station-dots-tide`, replacing `station-dots`. `pinFeatures` and its `kind` property are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/mapStyle.test.ts`:

```ts
describe("map pins — colour is state, form is kind", () => {
  it("no longer colours pins by station kind", () => {
    const src = readFileSync(new URL("./mapStyle.ts", import.meta.url), "utf8");
    expect(src).not.toContain("#8fd0a0");
    expect(src).not.toContain("#7fb3d5");
    expect(src).not.toMatch(/circle-color[^\n]*\["get", "kind"\]/);
  });

  it("distinguishes kind by form: current filled, tide hollow", () => {
    const style = localFallbackStyle(LAND, pins);
    const current = style.layers.find((l) => l.id === "station-dots-current")!;
    const tide = style.layers.find((l) => l.id === "station-dots-tide")!;
    expect(current).toBeDefined();
    expect(tide).toBeDefined();
    const cp = current.paint as Record<string, unknown>;
    const tp = tide.paint as Record<string, unknown>;
    // Same colour expression on both — kind must not change it.
    expect(cp["circle-color"]).toEqual(tp["circle-color"]);
    // Form differs: the tide pin is a ring, the current pin is solid.
    expect(cp["circle-opacity"]).toBe(1);
    expect(tp["circle-opacity"]).toBe(0);
  });
});
```

Add `import { readFileSync } from "node:fs";` at the top of the file. `localFallbackStyle` is already imported (line 3) and `LAND` / `pins` are already defined at module scope (lines 6-7), so nothing else needs adding.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: FAIL — `#8fd0a0` is still present.

- [ ] **Step 3: Replace the pin constants**

In `src/mapStyle.ts`, replace lines 36-40:

```ts
// Land is a classic paper-chart cream over navy water.
const LAND_TONE = "#f5ecd7";
const WATER_TONE = "#0b1a2b";

// A pin's COLOUR is the water's state, never the station's kind — kind is the
// pin's form (filled = current, hollow ring = tide). `pinFeatures` carries
// identity only and CHS readings are fetched online (see mapPopup.pinReading,
// which returns null for every CHS station), so most Salish Sea pins have no
// knowable state at draw time. They draw neutral, which honestly means "unknown
// — tap it" rather than asserting a state we don't have.
//
// ponytail: filled-vs-hollow circles, not the wave/dome glyphs the list uses.
// Matching those exactly needs SDF icons via map.addImage + icon-color; do that
// if pin kind ever gets misread in the field.
const PIN_UNKNOWN = "#7d9cb8";
```

- [ ] **Step 4: Split the dot layer by kind**

Replace the `dots` constant at lines 59-69 and the two `return` statements that reference it:

```ts
  const dotBase = {
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": 5,
      "circle-color": PIN_UNKNOWN,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": WATER_TONE,
    },
  };
  const currentDots: StyleLayer = {
    ...dotBase,
    id: "station-dots-current",
    filter: ["==", ["get", "kind"], "current"],
    paint: { ...dotBase.paint, "circle-opacity": 1 },
  };
  const tideDots: StyleLayer = {
    ...dotBase,
    id: "station-dots-tide",
    filter: ["==", ["get", "kind"], "tide"],
    // A ring: no fill, the pin's colour moved onto the stroke.
    paint: {
      ...dotBase.paint,
      "circle-opacity": 0,
      "circle-stroke-width": 2,
      "circle-stroke-color": PIN_UNKNOWN,
    },
  };
```

Then change `if (!style.glyphs) return [dots];` to `if (!style.glyphs) return [currentDots, tideDots];` and the final `return [dots, labels];` to `return [currentDots, tideDots, labels];`.

- [ ] **Step 5: Run the map tests**

Run: `npx vitest run src/mapStyle.test.ts`
Expected: PASS. The pre-existing `kind` assertion at line 19-20 still passes — `pinFeatures` is untouched.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Run the smoke check**

Run: `npm run smoke`
Expected: PASS. It asserts `.reading-compact .value`, `.station-card`, `.station-card-name` and `.place h1`, all of which Task 2 preserved. If it fails on a selector, fix the selector in `scripts/smoke.mjs` — do not reintroduce markup to satisfy it.

- [ ] **Step 8: Commit**

```bash
git add src/mapStyle.ts src/mapStyle.test.ts scripts/smoke.mjs
git commit -m "feat(map): pins encode kind by form, not colour

The map painted station kind in the same green/blue the rest of the
app uses for direction. Kind becomes filled-vs-hollow; colour is
reserved for state, and neutral where state isn't knowable offline."
```

---

## Verification

After all five tasks:

```bash
npm test          # full vitest suite
npm run build     # tsc + vite build, no unresolved font imports
npm run smoke     # puppeteer end-to-end
```

Then load `npm run dev` and confirm by eye, since the whole point of this work is visual:

1. The station list shows identity left, state right, a glyph per kind, flat card backgrounds.
2. A current gate at slack shows a green glyph; the same gate flooding shows blue.
3. No serif anywhere.
4. Nothing smaller than 14px except the tracked uppercase eyebrows.
5. The map shows filled pins for gates, hollow rings for tide stations, all neutral.
6. Reload — the app opens on the station you were last looking at.
