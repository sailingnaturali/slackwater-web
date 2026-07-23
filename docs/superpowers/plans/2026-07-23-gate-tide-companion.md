# Gate + Tide Companion View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a current gate is viewed in slackwater-web, show its companion tide port's curve in a second chart panel below the current chart, driven by the same scrub instant.

**Architecture:** The pairing is data: an optional `tideReference` key on current-gate entries in the station-corrections registry (validator-enforced). slackwater-web resolves a gate's companion with one function (`companionOf`), feeds it to the *already-existing but idle* `useChsTide` call in App.tsx, and renders the existing `TideChart` in a second panel. No new hooks, fetch paths, or chart components.

**Tech Stack:** station-corrections (Node, `node --test`, YAML→JSON build), slackwater-web (React + Vite + Vitest).

**Spec:** `docs/superpowers/specs/2026-07-23-gate-tide-companion-design.md`

## Global Constraints

- Repos: `~/src/sailingnaturali/station-corrections`, `~/src/sailingnaturali/currents-mcp`, `~/src/sailingnaturali/slackwater-web`. Run commands from each repo's root.
- The gate never waits on the companion: loading/offline companion ⇒ no tide panel, no spinner, no error copy. Gate view otherwise identical to today.
- Tide-station pages, URLs, and the gate event list are unchanged.
- Releases/release notes are outbound text: **draft, get Bryan's explicit go before `gh release create`**.
- station-corrections is hand-edited YAML → committed JSON artifacts: after any `data/registry.yaml` edit run `npm run build:data` and commit both files (CI diffs them).

## Plan-time verifications (differences from the spec, already resolved)

1. **Malibu double-fetch:** spec said "verify the cache absorbs the duplicate Atkinson fetch". Verified in code: `src/chs/current.ts` caches the reference hi/lo series **under the gate's id**, and the tide chart also needs the full `wlp` timeline the derived path never requests. Not a duplicate — the companion fetch is new data, cached under Atkinson's own id after first load. Nothing to fix; no cache surgery.
2. **App-level render test** ("both charts render, scrub moves both") is scaled down to wiring-level tests in `chsWiring.test.ts` (the repo's established pattern — pure functions over the real registry; there is no App render harness and both charts share one `now` prop by construction).
3. `ChsStation` does **not** gain a `tideReference` field — `companionOf` resolves from the module-level registry `entries` directly; only the local `RegistryEntry` type gains the field. Same observable behavior as the spec's wording, smaller surface.

---

### Task 1: station-corrections — `tideReference` validator rules

**Files:**
- Modify: `src/registry.js` (after the `derived` block, ~line 127)
- Test: `src/registry.test.js`

**Interfaces:**
- Produces: `validateRegistry` accepts an optional `tideReference: string` on current-gate records; rejects it on tide ports, on derived gates, when the key is unknown, or when the key is not a tide port.

- [ ] **Step 1: Write the failing tests**

Add to `src/registry.test.js`, following the existing derived-gate test style (yaml string → `validateRegistry(loadRegistry(...))`, assert on the problems array):

```js
test("accepts a current gate with a tideReference to an existing tide port", () => {
  const problems = validateRegistry(
    loadRegistry(
      "chs-port:\n  name: Port\n  context: Somewhere\n  position: [49.0, -123.0]\n  provider: chs\n  kind: tide\n" +
        "chs-gate:\n  name: Gate\n  context: Elsewhere\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-port\n",
    ),
  );
  assert.deepEqual(problems, []);
});

test("rejects a tideReference that is unknown, not a tide port, on a tide port, or on a derived gate", () => {
  const base =
    "chs-port:\n  name: Port\n  context: Somewhere\n  position: [49.0, -123.0]\n  provider: chs\n  kind: tide\n" +
    "chs-other-gate:\n  name: Other Gate\n  context: Elsewhere\n  position: [49.2, -123.2]\n  provider: chs\n  kind: current\n";
  // unknown key
  let p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-nope\n"));
  assert.ok(p.some((m) => /tideReference "chs-nope" is not a station/.test(m)));
  // points at a current gate
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-other-gate\n"));
  assert.ok(p.some((m) => /tideReference "chs-other-gate" must be a tide port/.test(m)));
  // on a tide port
  p = validateRegistry(loadRegistry(base + "chs-port2:\n  name: Port Two\n  context: Away\n  position: [49.3, -123.3]\n  provider: chs\n  kind: tide\n  tideReference: chs-port\n"));
  assert.ok(p.some((m) => /a tide port cannot carry a tideReference/.test(m)));
  // on a derived gate (derived.reference already pairs it)
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: chs-port\n  derived:\n    reference: chs-port\n    hwLagMinutes: 25\n    lwLagMinutes: 35\n"));
  assert.ok(p.some((m) => /derived gate already pairs via derived.reference/.test(m)));
  // not a string
  p = validateRegistry(loadRegistry(base + "chs-gate:\n  name: Gate\n  context: Away\n  position: [49.1, -123.1]\n  provider: chs\n  kind: current\n  tideReference: 7\n"));
  assert.ok(p.some((m) => /tideReference must be a station key string/.test(m)));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/src/sailingnaturali/station-corrections && node --test src/registry.test.js`
Expected: the two new tests FAIL (the accept test passes trivially only if no rule fires — the reject test must fail with no matching problem messages).
Note: the accept test may pass before implementation (unknown fields are ignored today). The reject test is the failing one; that is enough.

- [ ] **Step 3: Implement the validator rules**

In `src/registry.js`, directly after the `derived` validation block (after its closing brace, ~line 127), add:

```js
    // A `tideReference` names the tide port a gate is shown beside (a curated
    // proximity pairing, not a derivation). Only an ordinary current gate may
    // carry one: a tide port is the thing referenced, and a derived gate
    // already names its port via derived.reference.
    if (record.tideReference !== undefined) {
      if (!isNonEmptyString(record.tideReference)) {
        problems.push(`${id}: tideReference must be a station key string`);
      } else if (record.kind === "tide") {
        problems.push(`${id}: a tide port cannot carry a tideReference`);
      } else if (record.derived !== undefined) {
        problems.push(`${id}: derived gate already pairs via derived.reference - drop tideReference`);
      } else if (!registry.has(record.tideReference)) {
        problems.push(`${id}: tideReference "${record.tideReference}" is not a station in this registry`);
      } else if (registry.get(record.tideReference).kind !== "tide") {
        problems.push(`${id}: tideReference "${record.tideReference}" must be a tide port (kind: tide)`);
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/registry.test.js`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/registry.js src/registry.test.js
git commit -m "Validate tideReference: a gate's curated companion tide port"
```

---

### Task 2: station-corrections — annotate the pairs, build, release; re-vendor in currents-mcp

**Files:**
- Modify: `data/registry.yaml`, `data/registry.json` (generated), `package.json` (version)
- Modify (sibling repo): `currents-mcp/src/currents_mcp/_registry.json`

**Interfaces:**
- Produces: published `@sailingnaturali/station-corrections@2.4.0` whose `data/registry.json` carries `tideReference` on the nine gates below. Task 3 depends on this publish.

- [ ] **Step 1: Annotate the nine gates in `data/registry.yaml`**

Add one `tideReference:` line to each of these entries (exact keys; place it after the entry's last existing field):

| Entry | Add |
|---|---|
| `chs-seymour-narrows` | `tideReference: chs-campbell-river` |
| `chs-first-narrows` | `tideReference: chs-vancouver` |
| `chs-second-narrows` | `tideReference: chs-vancouver` |
| `chs-sechelt-rapids` | `tideReference: chs-point-atkinson` |
| `chs-hole-in-the-wall` | `tideReference: chs-owen-bay` |
| `chs-beazley-passage` | `tideReference: chs-owen-bay` |
| `chs-active-pass` | `tideReference: chs-fulford-harbour` |
| `chs-porlier-pass` | `tideReference: chs-fulford-harbour` |
| `chs-tillicum-bridge` | `tideReference: chs-victoria` |

`chs-malibu-rapids` gets nothing — its `derived.reference` is the pairing.

- [ ] **Step 2: Rebuild artifacts and run the full suite**

Run: `npm run build:data && npm test`
Expected: `wrote …/registry.json` and all tests PASS (the validator now checks the real data too — a typo'd key above fails here).

- [ ] **Step 3: Bump version and commit**

Set `"version": "2.4.0"` in `package.json`, then:

```bash
git add data/registry.yaml data/registry.json package.json
git commit -m "Annotate gate tideReference pairs; v2.4.0"
git push
```

- [ ] **Step 4: Draft release notes, get Bryan's go, then release**

Release notes are outbound text — show Bryan this draft and release **only on his explicit go**:

> **v2.4.0 — tideReference**
>
> Current-gate entries may now carry `tideReference: <registry-key>`, naming the tide port a gate is naturally read beside (Seymour Narrows → Campbell River, Sechelt Rapids → Point Atkinson, …). Validator-enforced: the key must exist and be a `kind: tide` port; a derived gate keeps pairing via `derived.reference`. Nine gates annotated.

After the go: `gh release create v2.4.0 --title "v2.4.0" --notes "<the approved text>"` (publish.yml publishes to npm on release).

- [ ] **Step 5: Re-vendor in currents-mcp**

```bash
cp ~/src/sailingnaturali/station-corrections/data/registry.json ~/src/sailingnaturali/currents-mcp/src/currents_mcp/_registry.json
cd ~/src/sailingnaturali/currents-mcp && uv run pytest tests/test_registry_drift.py -q
```

Expected: PASS. Then:

```bash
git add src/currents_mcp/_registry.json
git commit -m "Re-vendor station registry (station-corrections 2.4.0: tideReference)"
git push
```

No currents-mcp version bump — it doesn't read `tideReference`; this is only keeping the vendored copy in step (its drift test enforces it on dev boxes).

---

### Task 3: slackwater-web — dependency bump + `companionOf`

**Files:**
- Modify: `package.json` / `package-lock.json` (dep bump), `src/chsStations.ts`
- Test: `src/chsWiring.test.ts`

**Interfaces:**
- Consumes: published `@sailingnaturali/station-corrections@2.4.0` (Task 2).
- Produces: `companionOf(gate: ChsStation): ChsStation | null` exported from `src/chsStations.ts` — the tide port from a derived gate's `derived.reference`, else the gate's `tideReference`, else `null`.

- [ ] **Step 1: Bump the registry dependency**

Run: `cd ~/src/sailingnaturali/slackwater-web && npm update @sailingnaturali/station-corrections && grep '"@sailingnaturali/station-corrections"' package-lock.json -A1 | head -4`
Expected: lockfile shows `2.4.0` (the `^2.3.0` range in package.json already admits it — package.json may not change).

- [ ] **Step 2: Write the failing tests**

Add to `src/chsWiring.test.ts` (import `companionOf` alongside the existing `chsStations` import, and `chsCurrentStations`):

```ts
import { chsStations, chsCurrentStations, companionOf } from "./chsStations";

describe("companionOf pairs a gate with its tide port", () => {
  const gate = (slug: string) => chsCurrentStations.find((s) => s.slug === slug)!;

  it("a derived gate's companion is its derived reference (Malibu → Point Atkinson)", () => {
    expect(companionOf(gate("chs-malibu-rapids"))?.id).toBe("chs-point-atkinson");
  });

  it("an annotated gate's companion is its tideReference (Seymour → Campbell River)", () => {
    expect(companionOf(gate("chs-seymour-narrows"))?.id).toBe("chs-campbell-river");
  });

  it("the companion is a tide port from the tide pool, usable by useChsTide", () => {
    const companion = companionOf(gate("chs-active-pass"))!;
    expect(companion.series).toBe("tide");
    expect(chsStations).toContain(companion);
  });

  it("an unannotated gate has no companion (Blackney Passage)", () => {
    expect(companionOf(gate("chs-blackney-passage"))).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/chsWiring.test.ts`
Expected: FAIL — `companionOf` is not exported.

- [ ] **Step 4: Implement**

In `src/chsStations.ts`:

1. Add to the `RegistryEntry` type (after the `derived` field):

```ts
  /** A curated pairing: the tide port this gate is shown beside. Registry-validated (exists, kind: tide). */
  tideReference?: string;
```

2. At the bottom of the file, after `chsCurrentStations`:

```ts
/**
 * The tide port shown beside a gate: a derived gate's reference (the pairing
 * IS the derivation there), else the registry's curated tideReference. Null
 * for an unpaired gate — the gate page then shows no tide panel.
 */
export function companionOf(gate: ChsStation): ChsStation | null {
  const e = entries[gate.id];
  const key = e?.derived?.reference ?? e?.tideReference;
  return key ? (chsStations.find((s) => s.id === key) ?? null) : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/chsWiring.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/chsStations.ts src/chsWiring.test.ts
git commit -m "companionOf: resolve a gate's paired tide port from the registry"
```

---

### Task 4: slackwater-web — App wiring, tide panel, footer copy

**Files:**
- Modify: `src/App.tsx` (~lines 190–230 wiring; ~line 511 chart section; ~line 579 footer)

**Interfaces:**
- Consumes: `companionOf` (Task 3); existing `useChsTide`, `TideChart`, `heldWhileLoading`.

- [ ] **Step 1: Wire the companion into the existing tide hook**

In `src/App.tsx`, the wiring around lines 190–219 currently reads (gate arm *below* the tide arm):

```ts
  const chsStation = isChs(station) && !isChsCurrent(station) ? station : null;
  const chs = useChsTide(chsStation, now);
  ...
  const currentGate = isChsCurrent(station) ? station : null;
```

Reorder so the gate and its companion exist first, and feed the companion to the idle hook. Replace the `chsStation` line with:

```ts
  // A third arm alongside the tide one: a current gate has no level, only a
  // signed velocity. Hoisted above the tide hook so a gate's companion tide
  // port (companionOf) can ride the otherwise-idle useChsTide call below.
  const currentGate = isChsCurrent(station) ? station : null;
  const companion = currentGate ? companionOf(currentGate) : null;
  // Two engines, one shape (see useChsTide): a bundled station predicts
  // synchronously; a CHS port fetches. When a gate is viewed this hook — which
  // would otherwise sit idle — fetches the gate's companion tide port instead.
  const chsStation = isChs(station) && !isChsCurrent(station) ? station : companion;
```

and delete the now-duplicate `const currentGate = ...` line further down (keep its comment block if it reads better there; one declaration only). Import `companionOf` in the `chsStations` import at the top:

```ts
import { isChs, isChsCurrent, companionOf, type ChsStation } from "./chsStations";
```

Everything downstream (`chs`, `chsState`, `state`, `tideView`, holds) is untouched: when a gate with a companion is viewed, `tideView` now carries the companion port's tide state; for a companion-less gate `chsStation` is null and `tideView` stays null, exactly as today.

- [ ] **Step 2: Render the tide panel on the gate page**

In the gate branch of the chart area (currently `{currentGate ? (curView && (<> <section className="panel chart-panel"> <CurrentChart .../> ... </section> <EventList .../> </>))`), insert a second panel between the CurrentChart section and the EventList:

```tsx
              {companion && tideView && (
                <section className="panel chart-panel">
                  <p className="eyebrow">Tide at {companion.name}</p>
                  <TideChart
                    station={companion}
                    state={tideView.state}
                    now={tideView.now}
                    units={units}
                    onScrub={scrub}
                  />
                </section>
              )}
```

No new styles: `panel`, `chart-panel`, and `eyebrow` all exist. Both charts read the shared `now` and call the shared `scrub`, so the scrub instant and day-pager drive both. The panel is simply absent while the companion loads or is offline (`tideView` null) — the gate never waits on it.

- [ ] **Step 3: Footer copy for a gate with a companion**

The middle footer branch (`) : isChs(station) ? (`, ~line 579) currently renders "Current data for X … speeds and times". Replace that `<p className="muted">` with:

```tsx
            <p className="muted">
              {isChsCurrent(station)
                ? companion
                  ? `Current data for ${resolved.name} and tide data for ${companion.name} are`
                  : `Current data for ${resolved.name} is`
                : `Tide data for ${resolved.name} is`}{" "}
              served live from the <a href="https://tides.gc.ca/">Canadian Hydrographic Service</a>{" "}
              (CHS) under licence —{" "}
              {isChsCurrent(station)
                ? companion
                  ? "speeds, heights and times"
                  : "speeds and times"
                : "heights and times"}{" "}
              as published by CHS, not computed on your device. Not to be used for navigation (CHS
              clause 10).
            </p>
```

The derived branch above it (Malibu) is untouched — its copy already names Point Atkinson, and the note under Malibu's schematic chart stays (it still explains why that curve has no speed axis).

- [ ] **Step 4: Full suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS, production build succeeds (tsc runs in the Vite build).

- [ ] **Step 5: Smoke the real thing**

Run the dev server and load, with network up:
- `/tide/chs-seymour-narrows` — current chart + "Tide at Campbell River" panel; scrubbing either chart moves one line through both; paging a day pages both.
- `/tide/chs-malibu-rapids` — schematic current chart + "Tide at Point Atkinson" panel; slack marks line up with Atkinson HW+25/LW+35.
- `/tide/chs-blackney-passage` — no tide panel, page identical to before.
- `/tide/chs-victoria` and a NOAA station — unchanged.

Expected: all four as described. This is the check that fails if the wiring is subtly wrong.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "Show a gate's companion tide port under the current chart"
git push
```

(Also push the Task 3 commit if not yet pushed.)
