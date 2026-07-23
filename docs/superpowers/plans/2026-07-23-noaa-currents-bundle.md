# NOAA Current Stations Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** US current stations (Deception Pass, Admiralty, San Juan Channel…) predicted fully offline in slackwater-web, appearing in search/nearby/list/detail exactly like the CHS gates do.

**Architecture:** `@sailingnaturali/current-stations` gains per-station positions (Task 1, upstream repo). The web repo vendors a Salish Sea extract of that bundle (the npm tarball deliberately excludes the full bundle), shapes it at build time into `src/data/currents.json`, and predicts signed major-axis velocity with the already-installed `@neaps/tide-predictor` (Z0 mean flow as the `offset`). A new `src/noaaCurrents.ts` emits the exact `CurrentState` shape the CHS path produces, so `CurrentChart`, `EventList`, and `StationCard` render it unchanged. Identity (slug/context/aliases) flows through the existing `createBundledResolver()` fallback — no registry precondition.

**Tech Stack:** Node build scripts (ESM), TypeScript + React 19, vitest, `@neaps/tide-predictor`, `@sailingnaturali/current-stations` ^0.2.0, `@sailingnaturali/station-corrections`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-noaa-currents-bundle-design.md` (as amended 2026-07-23: vendored extract, resolver-fallback identity).
- Salish Sea bbox, verbatim from `scripts/build-stations.mjs`: `[-125.5, 47.0, -122.0, 50.5]` (minLon, minLat, maxLon, maxLat).
- Harmonic stations only, **primary bin only** (bundle key without `@`), zero-amplitude constituents dropped.
- No network at web build/test time. Network happens exactly twice, by hand: the vendored extract and the golden fixture capture.
- `CurrentState` (from `src/chs/current.ts`) is the contract — do not fork a parallel state shape.
- Timezone is the constant `"America/Los_Angeles"` (single-zone bbox, same ponytail move as `chsStations.ts`'s `TIMEZONE`).
- Golden tolerances: events within **15 min**, speeds within **0.1 kn** (engine measured 9.7 min / 0.055 kn).
- Commit policy: Studio — commit and push each task. Tags: every `current-stations` version bump gets a `vX.Y.Z` tag.
- Prose/copy rules: user-facing units spelled out via existing `src/units.ts` helpers; footer must state predictions are computed on-device from NOAA public-domain data, not for navigation.

---

### Task 1: Positions in the `current-stations` bundle (upstream repo)

**Repo:** `/Users/clarkbw/src/sailingnaturali/current-stations` — run all commands there.

**Files:**
- Modify: `src/extract.js` (harmonic + subordinate entry construction)
- Modify: `index.d.ts` (`HarmonicStation`, `SubordinateStation`)
- Modify: `schema/currents.schema.json`
- Modify: `RELEASING.md` (add slackwater-web to "Consumers to bump")
- Test: `test/extract.test.js`
- Regenerate: `currents.json`, `currents.min.json`

**Interfaces:**
- Produces: every station object in a `Bundle` gains `latitude: number` and `longitude: number` (decimal degrees, from the NOAA station list's `lat`/`lng`). Bundle keys and all other fields unchanged. Released as **v0.2.0**.

- [ ] **Step 1: Write the failing test**

Open `test/extract.test.js`, find the existing extraction test that feeds fake stations through `extractBundle` with an injected `fetchFn`, and add assertions on the produced entries (adapt the fixture variable names to what the file actually uses — the fixture stations already carry `lat`/`lng` because `fetchStationList` requires them):

```js
test('bundle entries carry the station position', async () => {
  const { bundle } = await extractBundle({ stations: ['AAA1111'], fetchFn: fakeFetch });
  for (const s of bundle.stations) {
    assert.equal(typeof s.latitude, 'number');
    assert.equal(typeof s.longitude, 'number');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `latitude` is `undefined` on bundle entries.

- [ ] **Step 3: Implement**

In `src/extract.js`, every place a bundle entry is constructed from a station-list record `s` (the `harmonic.set(key, {...})` call ~line 69, the subordinate `subs.push({...})` ~line 96, and the secondary-bin harmonic path if it builds its own object), add:

```js
latitude: s.lat,
longitude: s.lng,
```

In `index.d.ts`, add to both `HarmonicStation` and `SubordinateStation` (after `name`):

```ts
  latitude: number;
  longitude: number;
```

In `schema/currents.schema.json`, add `latitude` and `longitude` as `{"type": "number"}` properties **and** to the `required` array of every station variant defined there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Regenerate the committed bundle** (network, ~25 min — run in background)

```bash
npx current-stations extract currents.json
npm run bundle:min
npm run validate:bundle
```

Expected: ~855 harmonic + ~1,700 subordinate, **0 unresolvable references**, validate passes. A nonzero unresolvable count means stop and investigate, per RELEASING.md.

- [ ] **Step 6: Update RELEASING.md consumers list**

Add to "Consumers to bump":

```markdown
- `slackwater-web` — vendors a Salish Sea extract (`data/noaa-currents.json`,
  `npx current-stations extract … --box 47,-125.5,50.5,-122`). Re-run its
  `npm test` after re-vendoring.
```

- [ ] **Step 7: Commit, release v0.2.0**

```bash
git add src/extract.js index.d.ts schema/currents.schema.json test/extract.test.js currents.json currents.min.json RELEASING.md
git commit -m "feat: carry station positions into the bundle"
npm version minor   # -> 0.2.0, commits and tags v0.2.0
git push && git push --tags
gh release create v0.2.0 --notes "Bundle entries now carry latitude/longitude from the NOAA station list."
gh release upload v0.2.0 currents.min.json#currents.json
```

Expected: publish workflow goes green (OIDC npm publish). A fresh scoped version can 404 from the registry for a few minutes — wait before Task 2's install.

---

### Task 2: Vendor the Salish extract + build script (web repo)

**Repo:** `/Users/clarkbw/src/sailingnaturali/slackwater-web` — all remaining tasks run here.

**Files:**
- Create: `data/noaa-currents.json` (vendored, committed)
- Create: `scripts/build-currents.mjs`
- Create: `src/currentsBundle.test.ts`
- Modify: `package.json` (devDependency + scripts), `.gitignore`

**Interfaces:**
- Produces: `src/data/currents.json` (generated, gitignored) — an array of
  ```ts
  { id: string /* "noaa/PUG1741" */, name: string, latitude: number, longitude: number,
    timezone: "America/Los_Angeles", floodDirection: number, ebbDirection: number,
    meanFlow: number /* Z0, knots, signed */,
    constituents: { name: string; amplitude: number; phase: number }[] }
  ```
- Produces: npm script `build:data` that runs both bundle builders; `dev`/`build`/`test` call it.

- [ ] **Step 1: Install and vendor** (network, one-time)

```bash
npm install -D @sailingnaturali/current-stations@^0.2.0
npx current-stations extract data/noaa-currents.json --box 47,-125.5,50.5,-122
```

Expected: a few dozen stations (mostly `PUG*`), pretty-printed JSON with `note`/`generated`/`stations`. `--box` order is south,west,north,east.

- [ ] **Step 2: Write the failing bundle test**

`src/currentsBundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import stations from "./data/currents.json";

// Mirrors bundle.test.ts for tides: what ships is exactly what the licence
// and geography filters promise, checked on every build.
describe("bundled NOAA current stations", () => {
  it("is non-empty and NOAA-only", () => {
    expect(stations.length).toBeGreaterThan(0);
    for (const s of stations) expect(s.id).toMatch(/^noaa\//);
  });

  it("stays inside the Salish Sea bbox", () => {
    for (const s of stations) {
      expect(s.latitude).toBeGreaterThanOrEqual(47.0);
      expect(s.latitude).toBeLessThanOrEqual(50.5);
      expect(s.longitude).toBeGreaterThanOrEqual(-125.5);
      expect(s.longitude).toBeLessThanOrEqual(-122.0);
    }
  });

  it("ships only predictable harmonic stations at their primary bin", () => {
    for (const s of stations) {
      expect(s.id).not.toContain("@");
      expect(s.constituents.length).toBeGreaterThan(0);
      for (const c of s.constituents) expect(c.amplitude).toBeGreaterThan(0);
      expect(typeof s.floodDirection).toBe("number");
      expect(typeof s.ebbDirection).toBe("number");
      expect(typeof s.meanFlow).toBe("number");
      expect(s.timezone).toBe("America/Los_Angeles");
    }
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/currentsBundle.test.ts`
Expected: FAIL — `src/data/currents.json` does not exist.

- [ ] **Step 4: Write `scripts/build-currents.mjs`**

```js
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
```

- [ ] **Step 5: Wire scripts and gitignore**

In `package.json` `scripts`, add `build:currents` and a `build:data` that runs both; point `dev`/`build`/`test` at it:

```json
"build:stations": "node scripts/build-stations.mjs",
"build:currents": "node scripts/build-currents.mjs",
"build:data": "npm run build:stations && npm run build:currents",
"dev": "npm run build:data && vite",
"build": "npm run build:data && tsc && vite build",
"test": "npm run build:data && vitest run",
```

(`smoke` inherits via `build`.) In `.gitignore`, next to the stations line, add:

```
src/data/currents.json
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run build:currents && npx vitest run src/currentsBundle.test.ts`
Expected: build prints a station count + KB; test PASSES.

- [ ] **Step 7: Full suite, commit**

Run: `npm test`
Expected: PASS (existing suites untouched).

```bash
git add data/noaa-currents.json scripts/build-currents.mjs src/currentsBundle.test.ts package.json package-lock.json .gitignore
git commit -m "feat: vendor and bundle NOAA current stations (harmonic, primary bin, Salish Sea)"
git push
```

---

### Task 3: `noaaCurrents.ts` — offline prediction to `CurrentState`

**Files:**
- Create: `src/noaaCurrents.ts`
- Test: `src/noaaCurrents.test.ts`

**Interfaces:**
- Consumes: `src/data/currents.json` (Task 2 shape); `withNowCurrent`, `CurrentState`, `CurrentEvent` from `src/chs/current.ts`; `createTidePredictor` from `@neaps/tide-predictor`; `createBundledResolver` from `@sailingnaturali/station-corrections`; `resolvedStations` from `./tides`.
- Produces (later tasks rely on these exact names):
  - `interface NoaaCurrentStation { kind: "noaa-current"; id; name; latitude; longitude; timezone; floodDirection; ebbDirection; meanFlow; constituents }`
  - `interface ResolvedNoaaCurrentStation extends NoaaCurrentStation { context: string; slug: string; aliases: string[] }`
  - `const resolvedNoaaCurrentStations: ResolvedNoaaCurrentStation[]`
  - `isNoaaCurrent(s: { kind?: string }): s is ResolvedNoaaCurrentStation` — usable on the `Candidate` union
  - `noaaCurrentState(station: NoaaCurrentStation, now: Date): CurrentState` — synchronous, never `derived`, window `now ± 30h`, timeline fidelity 600 s

- [ ] **Step 1: Write the failing tests**

`src/noaaCurrents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isNoaaCurrent,
  noaaCurrentState,
  resolvedNoaaCurrentStations,
  type NoaaCurrentStation,
} from "./noaaCurrents";
import { resolvedStations } from "./tides";
import { chsStations, chsCurrentStations } from "./chsStations";

// A pure M2 station: signed velocity is a ~12h25m sinusoid, so slacks come
// every ~6h12m and floods/ebbs alternate between them. Everything below is
// checkable by construction.
const m2: NoaaCurrentStation = {
  kind: "noaa-current",
  id: "noaa/TEST001",
  name: "Test Pass",
  latitude: 48.4,
  longitude: -122.7,
  timezone: "America/Los_Angeles",
  floodDirection: 40,
  ebbDirection: 220,
  meanFlow: 0,
  constituents: [{ name: "M2", amplitude: 2, phase: 0 }],
};
const NOW = new Date("2026-07-23T12:00:00-07:00");

describe("noaaCurrentState", () => {
  it("emits a CurrentState with timeline, alternating events, and no derived flag", () => {
    const s = noaaCurrentState(m2, NOW);
    expect(s.derived).toBeUndefined();
    expect(s.timeline.length).toBeGreaterThan(300); // 60h at 600s
    const slacks = s.events.filter((e) => e.kind === "slack");
    expect(slacks.length).toBeGreaterThanOrEqual(8); // ~9-10 in 60h
    // Slack spacing for M2 is half its 12.42h period.
    for (let i = 1; i < slacks.length; i++) {
      const gapMin = (slacks[i].time.getTime() - slacks[i - 1].time.getTime()) / 60000;
      expect(Math.abs(gapMin - 372.7)).toBeLessThan(10);
    }
    // Between consecutive slacks sits exactly one max, alternating flood/ebb.
    const maxes = s.events.filter((e) => e.kind !== "slack");
    for (let i = 1; i < maxes.length; i++) expect(maxes[i].kind).not.toBe(maxes[i - 1].kind);
    for (const m of maxes) expect(m.speed).toBeCloseTo(2, 1);
  });

  it("derives phase and set from the signed velocity at now", () => {
    const s = noaaCurrentState(m2, NOW);
    expect(["flood", "ebb", "slack"]).toContain(s.phase);
    if (s.phase === "flood") expect(s.setDegrees).toBe(40);
    if (s.phase === "ebb") expect(s.setDegrees).toBe(220);
    expect(s.speed).toBeCloseTo(Math.abs(s.signed), 5);
  });

  it("a mean flow stronger than the harmonics never slacks and never floods", () => {
    const ebbing = { ...m2, meanFlow: -3, constituents: [{ name: "M2", amplitude: 1, phase: 0 }] };
    const s = noaaCurrentState(ebbing, NOW);
    expect(s.events.filter((e) => e.kind === "slack")).toHaveLength(0);
    expect(s.events.filter((e) => e.kind === "max-flood")).toHaveLength(0);
    // The signed curve's local highs are weakest-ebb wiggles, not floods —
    // they must be dropped, not mislabelled.
    expect(s.events.every((e) => e.kind === "max-ebb")).toBe(true);
    expect(s.phase).toBe("ebb");
  });
});

describe("resolvedNoaaCurrentStations", () => {
  it("resolves identity for every bundled station", () => {
    expect(resolvedNoaaCurrentStations.length).toBeGreaterThan(0);
    for (const s of resolvedNoaaCurrentStations) {
      expect(isNoaaCurrent(s)).toBe(true);
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("never collides a slug with any other station the app can name", () => {
    const others = new Set([
      ...resolvedStations.map((s) => s.slug),
      ...chsStations.map((s) => s.slug),
      ...chsCurrentStations.map((s) => s.slug),
    ]);
    const seen = new Set<string>();
    for (const s of resolvedNoaaCurrentStations) {
      expect(others.has(s.slug)).toBe(false);
      expect(seen.has(s.slug)).toBe(false);
      seen.add(s.slug);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/noaaCurrents.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/noaaCurrents.ts`**

```ts
import { createTidePredictor } from "@neaps/tide-predictor";
import { createBundledResolver } from "@sailingnaturali/station-corrections";
import { withNowCurrent, type CurrentEvent, type CurrentState } from "./chs/current";
import { resolvedStations } from "./tides";
import { chsStations, chsCurrentStations } from "./chsStations";
import currentData from "./data/currents.json";

/** A bundled NOAA current station: predicts signed velocity offline, like a
 * bundled tide station predicts height — same harmonic sum, different unit. */
export interface NoaaCurrentStation {
  kind: "noaa-current";
  /** `noaa/<CO-OPS id>`, e.g. "noaa/PUG1741". */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  floodDirection: number;
  ebbDirection: number;
  /** Z0 net mean flow along the major axis, knots, signed. */
  meanFlow: number;
  constituents: { name: string; amplitude: number; phase: number }[];
}

export interface ResolvedNoaaCurrentStation extends NoaaCurrentStation {
  context: string;
  slug: string;
  aliases: string[];
}

export const isNoaaCurrent = (s: { kind?: string }): s is ResolvedNoaaCurrentStation =>
  s.kind === "noaa-current";

const resolve = createBundledResolver();

// Slugs already spoken for: a current station named after the same water as a
// tide station (Friday Harbor has both) must not shadow the tide URL that's
// already in shared links. "-current" is the deterministic tiebreak.
const takenSlugs = new Set([
  ...resolvedStations.map((s) => s.slug),
  ...chsStations.map((s) => s.slug),
  ...chsCurrentStations.map((s) => s.slug),
]);

export const noaaCurrentStations: NoaaCurrentStation[] = (
  currentData as Omit<NoaaCurrentStation, "kind">[]
).map((s) => ({ kind: "noaa-current" as const, ...s }));

export const resolvedNoaaCurrentStations: ResolvedNoaaCurrentStation[] =
  noaaCurrentStations.map((station) => {
    const r = resolve(station);
    const slug = takenSlugs.has(r.slug) ? `${r.slug}-current` : r.slug;
    return {
      ...station,
      name: r.name,
      context: r.context,
      slug,
      aliases: r.aliases,
      latitude: r.latitude,
      longitude: r.longitude,
    };
  });

const HOUR = 3_600_000;

/**
 * Everything the current panes need, in one pass — the currents twin of
 * `predict()` in tides.ts, emitting the CHS adapter's CurrentState so every
 * component downstream stays provenance-blind.
 *
 * The predictor's "level" is signed major-axis velocity in knots: the same
 * harmonic sum, with the Z0 mean flow riding in as the offset. Extremes of
 * that curve are max flood (positive highs) and max ebb (negative lows);
 * zero crossings are slack. A high that never reaches positive water (or a
 * low that never goes negative) is a weakest-ebb/flood wiggle mid-phase —
 * dropped, because calling it a "max" would mislabel the turn structure.
 */
export function noaaCurrentState(station: NoaaCurrentStation, now: Date): CurrentState {
  const predictor = createTidePredictor(station.constituents, { offset: station.meanFlow });
  const start = new Date(now.getTime() - 30 * HOUR);
  const end = new Date(now.getTime() + 30 * HOUR);

  const timeline = predictor
    .getTimelinePrediction({ start, end, timeFidelity: 600 })
    .map((p: { time: string | Date; level: number }) => ({
      time: new Date(p.time),
      signed: p.level,
    }));

  const maxes: CurrentEvent[] = predictor
    .getExtremesPrediction({ start, end })
    .filter((e: { high: boolean; level: number }) => (e.high ? e.level > 0 : e.level < 0))
    .map((e: { time: string | Date; high: boolean; level: number }) => ({
      time: new Date(e.time),
      kind: e.high ? ("max-flood" as const) : ("max-ebb" as const),
      speed: Math.abs(e.level),
    }));

  // Slack: linear interpolation of the sign change between timeline samples.
  // 600s sampling puts the crossing within ~seconds for real stations.
  const slacks: CurrentEvent[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (a.signed === 0 || a.signed > 0 === b.signed > 0) continue;
    const frac = a.signed / (a.signed - b.signed);
    slacks.push({
      time: new Date(a.time.getTime() + frac * (b.time.getTime() - a.time.getTime())),
      kind: "slack",
    });
  }

  const events = [...maxes, ...slacks].sort((x, y) => x.time.getTime() - y.time.getTime());

  // withNowCurrent fills every now-relative field from timeline + events.
  return withNowCurrent(
    {
      signed: 0,
      speed: 0,
      phase: "slack",
      setDegrees: 0,
      floodDirection: station.floodDirection,
      ebbDirection: station.ebbDirection,
      nextSlack: null,
      following: null,
      events,
      timeline,
    },
    now,
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/noaaCurrents.test.ts`
Expected: PASS. If the slug-collision test fails, list the colliding names in the failure output and apply the `-current` suffix path — do not rename stations inline; curation belongs upstream in station-corrections.

- [ ] **Step 5: Commit**

```bash
git add src/noaaCurrents.ts src/noaaCurrents.test.ts
git commit -m "feat: offline NOAA current prediction to CurrentState"
git push
```

---

### Task 4: Golden validation against NOAA's own predictions

**Files:**
- Create: `src/fixtures/pug1741-golden.json` (captured once, committed)
- Test: `src/noaaCurrentsGolden.test.ts`

**Interfaces:**
- Consumes: `noaaCurrentState`, `NoaaCurrentStation` from Task 3. Fixture shape is `GoldenFixture` from `@sailingnaturali/current-stations`: `{ station, bin, start, end, floodDirection, ebbDirection, offset, constituents: {name,amplitude,phase}[], events: { time, kind: "slack"|"flood"|"ebb", velocityMajor }[] }`.

- [ ] **Step 1: Capture the fixture** (network, one-time)

```bash
mkdir -p src/fixtures
npx current-stations golden src/fixtures/pug1741-golden.json \
  --station PUG1741 --bin 27 --start 2026-08-01 --end 2026-08-03
```

Expected: file with constituents and a non-empty `events` array, no `predictionsError`. (Bin 27 is PUG1741's reference bin — the engine's validation used it; the CLI errors on a wrong bin.)

- [ ] **Step 2: Write the test**

`src/noaaCurrentsGolden.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import golden from "./fixtures/pug1741-golden.json";
import { noaaCurrentState, type NoaaCurrentStation } from "./noaaCurrents";

// The engine's currents validation, replayed in TS: feed NOAA's constituents,
// predict NOAA's own published window, compare event times and speeds.
// Engine measured 9.7 min / 0.055 kn on this station; gates are 15 min / 0.1 kn.
const KIND = { slack: "slack", flood: "max-flood", ebb: "max-ebb" } as const;

const station: NoaaCurrentStation = {
  kind: "noaa-current",
  id: `noaa/${golden.station}`,
  name: golden.station,
  latitude: 48.6,
  longitude: -122.7,
  timezone: "America/Los_Angeles",
  floodDirection: golden.floodDirection,
  ebbDirection: golden.ebbDirection,
  meanFlow: golden.offset,
  constituents: golden.constituents,
};

describe("PUG1741 vs NOAA's published predictions", () => {
  const mid = new Date((new Date(golden.start).getTime() + new Date(golden.end).getTime()) / 2);
  const state = noaaCurrentState(station, mid);

  it("matches every NOAA event within 15 min and 0.1 kn", () => {
    const usable = golden.events.filter((e) => e.kind !== "unknown");
    expect(usable.length).toBeGreaterThan(0);
    for (const noaaEvent of usable) {
      const t = new Date(noaaEvent.time).getTime();
      const ours = state.events
        .filter((e) => e.kind === KIND[noaaEvent.kind as keyof typeof KIND])
        .reduce((best, e) =>
          Math.abs(e.time.getTime() - t) < Math.abs(best.time.getTime() - t) ? e : best,
        );
      expect(Math.abs(ours.time.getTime() - t) / 60000).toBeLessThanOrEqual(15);
      if (noaaEvent.kind !== "slack") {
        expect(Math.abs((ours.speed ?? 0) - Math.abs(noaaEvent.velocityMajor))).toBeLessThanOrEqual(0.1);
      }
    }
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run src/noaaCurrentsGolden.test.ts`
Expected: PASS. If a single event misses tolerance, print the deltas — a systematic ~minutes offset means a timezone/window bug in `noaaCurrentState`; scattered sub-tolerance noise means loosen nothing and investigate the interpolation instead. Do not widen tolerances to pass.

- [ ] **Step 4: Commit**

```bash
git add src/fixtures/pug1741-golden.json src/noaaCurrentsGolden.test.ts
git commit -m "test: validate offline current prediction against NOAA's published events"
git push
```

---

### Task 5: Station pool — search, nearby, URLs

**Files:**
- Modify: `src/place.ts` (Candidate union + pool)
- Test: extend `src/place.test.ts`, `src/url.test.ts`

**Interfaces:**
- Consumes: `resolvedNoaaCurrentStations`, `ResolvedNoaaCurrentStation` from Task 3.
- Produces: `type Candidate = ResolvedStation | ChsStation | ResolvedNoaaCurrentStation`; `candidates` includes the NOAA current pool. Everything downstream of `Candidate` (search, nearby, URL parsing, saved stations) inherits without code change.

- [ ] **Step 1: Write the failing tests**

Append to `src/place.test.ts` (match the file's existing import style):

```ts
import { isNoaaCurrent } from "./noaaCurrents";

it("the candidate pool includes bundled NOAA current stations", () => {
  expect(candidates.some((s) => isNoaaCurrent(s))).toBe(true);
});
```

Append to `src/url.test.ts`:

```ts
import { resolvedNoaaCurrentStations } from "./noaaCurrents";
import { candidates } from "./place";

it("routes a NOAA current station by slug and by provider id", () => {
  const station = resolvedNoaaCurrentStations[0];
  expect(parseUrl(`/tide/${station.slug}`, candidates)?.station.id).toBe(station.id);
  const byId = parseUrl(`/tide/${station.id.replace(/\//g, "-")}`, candidates);
  expect(byId?.station.id).toBe(station.id);
  expect(byId?.canonical).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/place.test.ts src/url.test.ts`
Expected: FAIL — pool contains no NOAA current stations (and a type error on the union).

- [ ] **Step 3: Implement in `src/place.ts`**

```ts
import { resolvedNoaaCurrentStations, type ResolvedNoaaCurrentStation } from "./noaaCurrents";

export type Candidate = ResolvedStation | ChsStation | ResolvedNoaaCurrentStation;

export const candidates: Candidate[] = [
  ...resolvedStations,
  ...chsStations,
  ...chsCurrentStations,
  ...resolvedNoaaCurrentStations,
];
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` will surface every switch on the widened union that now mishandles a NOAA current station (App.tsx, StationList.tsx are fixed in Tasks 6–7 — if they error here, add the narrow `isNoaaCurrent` guards those tasks specify rather than casting). Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/place.ts src/place.test.ts src/url.test.ts
git commit -m "feat: NOAA current stations join the search/nearby/URL pool"
git push
```

---

### Task 6: Detail view

**Files:**
- Modify: `src/App.tsx` (station arms ~lines 195–240, render ~530–650, footer)
- Test: extend `src/App.test.ts`

**Interfaces:**
- Consumes: `isNoaaCurrent`, `noaaCurrentState` from Task 3.
- Produces: viewing a NOAA current station renders `CurrentChart` + `EventList` from a synchronous `CurrentState`; scrubbing works; footer states on-device NOAA provenance.

- [ ] **Step 1: Write the failing test**

Follow `src/App.test.ts`'s existing pattern for rendering `App` at a URL (jsdom + history). Add:

```ts
it("renders a NOAA current station offline: chart, events, provenance", async () => {
  const station = resolvedNoaaCurrentStations[0];
  window.history.pushState({}, "", `/tide/${station.slug}`);
  render(<App />);
  // Synchronous prediction: no loading state, current layout immediately.
  expect(await screen.findByText(station.name)).toBeInTheDocument();
  expect(screen.getAllByText(/Slack|Max flood|Max ebb/).length).toBeGreaterThan(0);
  expect(screen.getByText(/computed on your device/i)).toBeInTheDocument();
  expect(screen.queryByText(/Canadian Hydrographic Service/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/App.test.ts`
Expected: FAIL — the station falls into the bundled-tide arm and renders a tide layout (or crashes on `chartDatum`).

- [ ] **Step 3: Implement in `src/App.tsx`**

In the station-arms block (~line 200):

```ts
const noaaCurrent = isNoaaCurrent(station) ? station : null;
```

Guard the tide-prediction memo so a current station never reaches `predict()`:

```ts
const noaaState = useMemo(
  () => (isChs(station) || isNoaaCurrent(station) ? null : predict(station, now)),
  [station, now],
);
```

Add the synchronous current arm beside the CHS one (mirrors the tide twin exactly — recomputed per tick, like `predict`):

```ts
const currentState = useMemo(
  () =>
    noaaCurrent
      ? noaaCurrentState(noaaCurrent, now)
      : chsCur.state
        ? withNowCurrent(chsCur.state, now)
        : null,
  [noaaCurrent, chsCur.state, now],
);
```

Render: change the branch condition `currentGate ? (...)` to `currentGate || noaaCurrent ? (...)`. Inside, `companion` stays gate-only (a NOAA station has no paired tide port yet — spec's deferred pairing), so the companion `TideChart` and `EventList`'s `state` prop already degrade to absent. `curView`'s hold: pass `false` for the loading flag when `noaaCurrent` is set (synchronous data never loads).

`resolved`: a NOAA current station arrives from `candidates` already resolved — extend the existing memo's CHS arm so `isChs(station) || isNoaaCurrent(station)` returns the station itself.

Footer: in the final (bundled-NOAA) else-arm area, add a current-station variant before the tide copy:

```tsx
) : isNoaaCurrent(station) ? (
  <p className="muted">
    Current predictions for {resolved.name} are computed on your device from{" "}
    <a href="https://tidesandcurrents.noaa.gov/">NOAA CO-OPS</a> harmonic
    constituents (public domain) — no connection needed. Speeds are along the
    channel axis at the station point.
  </p>
) : (
```

- [ ] **Step 4: Run to verify pass, then the whole suite**

Run: `npx vitest run src/App.test.ts && npx tsc --noEmit && npm test`
Expected: PASS. Also verify `src/useOfflineSync.ts` needed no change — it iterates CHS stations only; NOAA currents must NOT appear in the download accounting (spec §4).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.ts
git commit -m "feat: NOAA current station detail view, offline"
git push
```

---

### Task 7: List and search cards

**Files:**
- Modify: `src/StationList.tsx` (`GroupCard`)
- Test: extend `src/StationList.test.tsx`

**Interfaces:**
- Consumes: `isNoaaCurrent`, `noaaCurrentState` from Task 3.
- Produces: a NOAA current station's card shows a live current reading (synchronous), never a tide prediction. `SearchScreen` needs no change — `StationCard` renders identity when `state`/`current` are absent.

- [ ] **Step 1: Write the failing test**

Follow `src/StationList.test.tsx`'s existing render pattern; add:

```ts
it("a NOAA current station's card carries a current reading, not a tide", () => {
  const station = resolvedNoaaCurrentStations[0];
  // render a group containing `station` per the file's existing helpers
  expect(screen.getByText(station.name)).toBeInTheDocument();
  expect(screen.getByText(/Slack|Flooding|Ebbing/)).toBeInTheDocument();
  expect(screen.queryByText(/High|Low/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/StationList.test.tsx`
Expected: FAIL — the card hits `predict(station, now)` and renders a tide reading (constituents are velocities, so the number is also nonsense).

- [ ] **Step 3: Implement in `GroupCard`**

```ts
const gate = isChsCurrent(station) ? station : null;
const chsCur = useChsCurrent(gate, now);
const current = isNoaaCurrent(station)
  ? noaaCurrentState(station, now)
  : chsCur.state
    ? withNowCurrent(chsCur.state, now)
    : undefined;
```

and the tide prop:

```ts
state={
  isChs(station) ? tide
  : isNoaaCurrent(station) ? undefined
  : predict(station, now)
}
```

- [ ] **Step 4: Run to verify pass + suite**

Run: `npx vitest run src/StationList.test.tsx && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/StationList.tsx src/StationList.test.tsx
git commit -m "feat: current readings on NOAA current station cards"
git push
```

---

### Task 8: Docs + smoke

**Files:**
- Modify: `README.md` ("What ships" section)
- Verify: `npm run smoke`

- [ ] **Step 1: README**

In "What ships, and what deliberately does not", after the NOAA tide-station paragraph, add:

```markdown
US **current** stations ship too — harmonic constituents from NOAA CO-OPS via
[`@sailingnaturali/current-stations`](https://github.com/sailingnaturali/current-stations)
(public domain, vendored in `data/noaa-currents.json`), predicted on-device the
same way heights are. Slack, max flood and max ebb work with no signal in US
water; Canadian gates stay CHS-online, as below.
```

- [ ] **Step 2: Smoke the built app**

Run: `npm run smoke`
Expected: PASS — the smoke script walks every page; a NOAA current station page must load without console errors while offline-sync's CHS fetches fail (already tolerated per commit `4771a37`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: US current stations ship offline"
git push
```

---

## Self-Review Notes

- Spec §1 → Tasks 1–2 (bundle + filters + empty-guard + NOAA-only test). §2 → Task 3 (+ Task 4 golden). §3 (as amended) → Task 3 resolver + slug tiebreak. §4 → Tasks 5–7 (no new views; no offline chrome — Task 6 Step 4 verifies sync exclusion). §5 → build-time guards only. §6 → Tasks 2/3/4 tests. §7 deferred items untouched (subordinate stations carry a `ponytail:` ceiling comment in the build script).
- Names used across tasks: `noaaCurrentState`, `resolvedNoaaCurrentStations`, `isNoaaCurrent`, `NoaaCurrentStation`, `ResolvedNoaaCurrentStation`, `meanFlow`, script `build:data` — consistent throughout.
- Known judgment calls surfaced to the executor: predictor return-field names in Task 3 (`level`/`high`/`time`) match `tides.ts` usage; extreme-filter drops mid-phase wiggles; slack events carry no `speed` (matches derived-gate rendering).
