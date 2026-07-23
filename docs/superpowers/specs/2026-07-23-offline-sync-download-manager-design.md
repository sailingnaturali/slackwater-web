# Offline sync + download manager

2026-07-23 · slackwater-web

## What

On load, auto-start a background prefetch of every station whose data isn't
already computed offline, so the app becomes 100% offline without the user
asking. Show progress on the right of the Settings row; when done, an icon marks
"offline-ready" and opens a manager for the downloads (pause/resume/restart).

This is the `signalk-currents` model — fetch each station's pre-computed
event/timeline series per UTC day and cache it — run **eagerly in the browser**
instead of on demand. It ships no data (each browser fetches for its own user,
clause-10-clean), builds no harmonic models, and adds no fetch code: it drives
the loaders the app already has.

## Why prefetch at all

Today the app is lazy: a CHS station's data is fetched only when you open that
station (`GroupCard` → `useChsCurrent`, cache-first). A station you never opened
has nothing cached, so it doesn't work offline. Bundled NOAA harmonic tides
(`predict()`) are already offline and need nothing. The gap is exactly the CHS
set: ~30 stations (29 tide ports + current gates) in `candidates` where
`isChs(station)`.

## Model

- **Scope:** every `isChs` station in `place.ts` `candidates`. Non-CHS
  (bundled NOAA) stations are skipped — already offline.
- **Horizon:** 7 days. Per-day predictions are immutable, so a cached day is
  cached forever; the window slides, so each launch fills any newly-needed days.
- **Loaders:** the existing `chsTideDay(station, day)` / `chsCurrentDay(station,
  now)`, which call `seriesForWindow` — **cache-first over IndexedDB**. This is
  what makes the whole run idempotent and resumable: re-running skips cached
  days, a reload continues where it stopped, and prefetch shares one cache with
  the on-demand `GroupCard`/detail loads.
- **Pacing:** small concurrency (3 in flight) with a `paceMs` gap between
  fetches, mirroring the plugin's politeness to CHS/NOAA.
- **Connectivity:** if `navigator.onLine` is false the run parks and resumes on
  the window `online` event. Downloading is the only online-required work, which
  is why it's surfaced prominently.

## Components (all `slackwater-web/src`)

### `offlineSync.ts` — orchestrator (framework-agnostic)

A plain store, no React, so the queue logic is unit-testable with a stubbed
loader. Responsibilities:

- Build the job list: one job per `isChs` candidate.
- A job's work = drive its loader across the horizon. The tide loader is
  day-keyed (`chsTideDay(station, day)` — call per horizon day); the current
  loader is now-keyed and windows forward (`chsCurrentDay(station, now)` — one
  call caches its week). Either way the orchestrator calls what covers the
  horizon and leans on cache-first to dedupe repeat days. A job is `ready` when
  every horizon day it needs is cached (verified via the cache, not assumed
  from a single call succeeding).
- Run ≤3 concurrent, paced; on job completion mark `ready`, on throw mark
  `failed`.
- Per-station status: `pending | downloading | ready | failed | paused`.
- Overall progress = stations `ready` / total (station granularity for the
  meter; per-station rows in the manager).
- Skip stations already fully cached for the horizon on start (→ instant
  `ready`), so a warm launch shows complete immediately.
- Controls: `pauseAll`, `resumeAll`, `pause(id)`, `restart(id)`, `restartAll`.
- Subscribe API (`subscribe(listener)` + `snapshot()`) for the hook.

The loader is injected (default: the real `chsTideDay`/`chsCurrentDay`; tests
pass a stub) so the core has no network or IndexedDB dependency.

### `useOfflineSync.ts` — React binding

Subscribes to the store, returns the snapshot, and auto-starts the run on mount
**unless** a persisted `slackwater.syncPaused` flag is set. That flag is written
by `pauseAll` and cleared by `resumeAll`/`restartAll` — so "stop eating data"
survives a reload, while individual `pause(id)` is session-only. A single hook
instance lives in `App`.

### `OfflineStatus.tsx` — the compact control

Sits on the **right of the Settings row** in `sidebar-foot`, beside the Settings
button as its own `<button>` (can't nest buttons — same beside-not-inside
pattern as the star toggle). States:

- syncing → a small progress meter + `68%`
- offline mid-sync → "waiting for signal" affordance
- paused → paused affordance
- complete → a slim **offline-ready icon** (`✓`)

Every state is clickable and opens `OfflineManager`.

### `OfflineManager.tsx` — the dialog

Per-station list grouped **Currents / Tides**, each row: name + status. Header
actions: **pause all / resume all / restart all**. Per-row: **pause / restart**.
Also a "downloaded through `<date>`" line and a **clear cache** action (drops the
IndexedDB current/tide day keys, resets to `pending`).

### `App.tsx` wiring

Mount `useOfflineSync`; render `<OfflineStatus>` beside the existing
`settings-entry` button in `sidebar-foot`; hold the manager-open state and render
`<OfflineManager>` when open.

## Error handling

- A failed station stays `failed` and does not block the queue; `restart(id)`
  re-queues it. `restartAll` re-queues every non-ready station.
- A 200-with-no-data day already resolves to the honest "offline" degraded state
  in the loaders — the orchestrator treats a job that yields no usable data as
  `failed`, same as a throw.
- Offline start (no connection at first load): everything stays `pending`, meter
  shows "waiting for signal", run begins on `online`.

## Testing

Orchestrator core, with an injected loader stub (no network, no IndexedDB):

- enumerates exactly the `isChs` candidates, skips non-CHS;
- a job whose days are all pre-cached lands `ready` without calling the loader;
- a throwing loader marks that station `failed` and the rest still complete;
- `pauseAll` halts new starts and persists the flag; `resumeAll` clears it;
- `restart(id)` moves a `failed`/`paused` station back through `downloading`
  to `ready`;
- progress math: `ready / total`.

One `test_*.tsx` render check that `OfflineStatus` shows a meter while syncing
and the ready icon when complete, mirroring `StationCard.test.tsx` style.

## Defaults (tunable)

| Knob | Default | Note |
|---|---|---|
| horizon | 7 days | signalk-currents ships 3; wider for trip runway |
| concurrency | 3 | paced with `paceMs` between fetches |
| `pauseAll` persistence | on | survives reload as `slackwater.syncPaused` |
| complete-state UI | slim ready icon | manager stays reachable (refresh/clear) |

## Out of scope

- Bundling NOAA current constituents / harmonic fitting (the earlier tier-1
  idea) — superseded by the fetch-and-cache model.
- CHS constituent side-load (BYO `chs-constituents`) — not needed once
  first-load prefetch reaches 100% offline.
- Background refresh while the app is closed (Service Worker periodic sync) —
  the slide-forward top-up happens on next launch; revisit only if trips run
  past the horizon without relaunching.
