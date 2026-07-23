# Offline Sync + Download Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On load, auto-prefetch every CHS station's data across a 7-day horizon so the app becomes 100% offline, with a compact progress meter on the Settings row and a downloads manager to pause/resume/restart.

**Architecture:** A framework-agnostic orchestrator store (`offlineSync.ts`) drives the app's existing cache-first loaders (`chsTideDay` / `chsCurrentDay`) over the horizon; because those write IndexedDB, the run is idempotent and resumable. A React hook (`useOfflineSync`) auto-starts it and owns connectivity + persisted pause-all. Two small components render the meter (`OfflineStatus`) and the manager dialog (`OfflineManager`).

**Tech Stack:** TypeScript, React 18 (`useSyncExternalStore`), Vitest + `react-dom/server` for render tests. No new dependencies.

## Global Constraints

- Prefetch scope is exactly `candidates.filter(isChs)` — bundled NOAA harmonic stations predict offline and are excluded.
- Horizon = 7 days; anchors stepped every 2 days (loaders window ±30h, so 2-day steps tile with overlap).
- Concurrency = 3 jobs in flight, `paceMs` = 250ms gap before each job.
- `pauseAll` persists across reload via `localStorage` key `slackwater.syncPaused`; individual `pause(id)` is session-only.
- The store must be pure (no React, no `navigator`, no `localStorage`) — connectivity and persistence live in the hook. This keeps the store unit-testable with a stubbed loader.
- `Date.now()` / `setTimeout` are allowed here (this is the web app, not a workflow script).
- All commits use the repo trailer from CLAUDE.md (`Co-Authored-By:` + `Claude-Session:`). Commit messages below show the subject line only.
- Follow existing house style: native `<dialog>` for modals (see `Settings.tsx`), render tests via `renderToStaticMarkup` (see `StationCard.test.tsx`).

## File Structure

- `src/offlineSync.ts` (create) — orchestrator store + `horizonAnchors` + default loader dispatch. One responsibility: queue and run station jobs.
- `src/offlineSync.test.ts` (create) — store unit tests with a stubbed loader.
- `src/useOfflineSync.ts` (create) — React binding: `useSyncExternalStore`, auto-start, connectivity, persisted pause-all, clear-cache.
- `src/useOfflineSync.test.ts` (create) — persistence + auto-start-gating test.
- `src/OfflineStatus.tsx` (create) — compact meter/icon button for the Settings row.
- `src/OfflineStatus.test.tsx` (create) — render test.
- `src/OfflineManager.tsx` (create) — the `<dialog>` manager.
- `src/OfflineManager.test.tsx` (create) — render test.
- `src/App.tsx` (modify ~369-383) — mount the hook, render `OfflineStatus` beside Settings, render `OfflineManager`.
- `src/styles.css` (modify, append) — `.offline-status`, `.offline-meter`, `.offline-manager` rules.

---

### Task 1: Orchestrator store (`offlineSync.ts`)

**Files:**
- Create: `src/offlineSync.ts`
- Test: `src/offlineSync.test.ts`

**Interfaces:**
- Consumes: `candidates` from `./place`; `isChs`, `isChsCurrent`, `ChsStation` from `./chsStations`; `chsTideDay` from `./chs/tide`; `chsCurrentDay` from `./chs/current`; `indexedDbCache`, `ChsCache` from `./chs/cache`.
- Produces:
  - `type JobStatus = "pending" | "downloading" | "ready" | "failed" | "paused"`
  - `interface StationJob { station: ChsStation; status: JobStatus }`
  - `interface SyncSnapshot { jobs: StationJob[]; total: number; ready: number; paused: boolean }`
  - `type Loader = (station: ChsStation, now: Date) => Promise<unknown>`
  - `const HORIZON_DAYS = 7`
  - `function horizonAnchors(now: Date): Date[]`
  - `function createOfflineSync(deps?: { load?: Loader; now?: () => Date; concurrency?: number; paceMs?: number; stations?: ChsStation[] }): OfflineSync`
  - `interface OfflineSync { snapshot(): SyncSnapshot; subscribe(fn: () => void): () => void; start(): Promise<void>; pauseAll(): void; resumeAll(): Promise<void>; pause(id: string): void; restart(id: string): Promise<void>; restartAll(): Promise<void>; resumeIncomplete(): Promise<void> }`

- [ ] **Step 1: Write the failing test**

```ts
// src/offlineSync.test.ts
import { describe, it, expect } from "vitest";
import { createOfflineSync, horizonAnchors, HORIZON_DAYS, type Loader } from "./offlineSync";
import { candidates } from "./place";
import { isChs, type ChsStation } from "./chsStations";

function fixture(id: string, series: "tide" | "current"): ChsStation {
  return {
    kind: "chs", series, provider: "chs", id, slug: id, name: id,
    context: "", latitude: 48, longitude: -123, aliases: [], timezone: "America/Vancouver",
  };
}
const okLoad: Loader = async () => ({});
const anchor0 = new Date("2026-07-23T12:00:00Z");
const stations = [fixture("chs-a", "tide"), fixture("chs-b", "current")];

describe("horizonAnchors", () => {
  it("steps every 2 days across the horizon (7 days → 4 anchors at 0,2,4,6)", () => {
    const a = horizonAnchors(anchor0);
    expect(a).toHaveLength(4);
    const dayMs = 24 * 60 * 60 * 1000;
    expect(a.map((d) => (d.getTime() - anchor0.getTime()) / dayMs)).toEqual([0, 2, 4, 6]);
    expect(HORIZON_DAYS).toBe(7);
  });
});

describe("createOfflineSync", () => {
  it("enumerates exactly the isChs candidates by default", () => {
    const sync = createOfflineSync({ load: okLoad });
    const expected = candidates.filter(isChs).length;
    expect(sync.snapshot().total).toBe(expected);
    expect(sync.snapshot().jobs.every((j) => isChs(j.station))).toBe(true);
  });

  it("marks every station ready after a successful run", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    const s = sync.snapshot();
    expect(s.ready).toBe(2);
    expect(s.jobs.map((j) => j.status)).toEqual(["ready", "ready"]);
  });

  it("marks a station failed when its loader throws, others still complete", async () => {
    const load: Loader = async (station) => {
      if (station.id === "chs-a") throw new Error("offline");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    const byId = Object.fromEntries(sync.snapshot().jobs.map((j) => [j.station.id, j.status]));
    expect(byId["chs-a"]).toBe("failed");
    expect(byId["chs-b"]).toBe("ready");
  });

  it("pauseAll before start is a no-op run; jobs stay pending and paused is true", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    sync.pauseAll();
    await sync.start();
    expect(sync.snapshot().paused).toBe(true);
    expect(sync.snapshot().jobs.every((j) => j.status === "pending")).toBe(true);
  });

  it("pause(id) skips that station on run", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    sync.pause("chs-a");
    await sync.start();
    const byId = Object.fromEntries(sync.snapshot().jobs.map((j) => [j.station.id, j.status]));
    expect(byId["chs-a"]).toBe("paused");
    expect(byId["chs-b"]).toBe("ready");
  });

  it("restart(id) drives a failed station to ready", async () => {
    let fail = true;
    const load: Loader = async (station) => {
      if (station.id === "chs-a" && fail) throw new Error("x");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    expect(sync.snapshot().jobs.find((j) => j.station.id === "chs-a")!.status).toBe("failed");
    fail = false;
    await sync.restart("chs-a");
    expect(sync.snapshot().jobs.find((j) => j.station.id === "chs-a")!.status).toBe("ready");
  });

  it("resumeIncomplete re-runs only failed jobs", async () => {
    let fail = true;
    const load: Loader = async (station) => {
      if (station.id === "chs-b" && fail) throw new Error("x");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    fail = false;
    await sync.resumeIncomplete();
    expect(sync.snapshot().ready).toBe(2);
  });

  it("snapshot reference is stable between emits", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    const before = sync.snapshot();
    expect(sync.snapshot()).toBe(before);
    await sync.start();
    expect(sync.snapshot()).not.toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/offlineSync.test.ts`
Expected: FAIL — cannot resolve `./offlineSync`.

- [ ] **Step 3: Write the implementation**

```ts
// src/offlineSync.ts
import { candidates } from "./place";
import { isChs, isChsCurrent, type ChsStation } from "./chsStations";
import { chsTideDay } from "./chs/tide";
import { chsCurrentDay } from "./chs/current";
import { indexedDbCache } from "./chs/cache";

export type JobStatus = "pending" | "downloading" | "ready" | "failed" | "paused";
export interface StationJob {
  station: ChsStation;
  status: JobStatus;
}
export interface SyncSnapshot {
  jobs: StationJob[];
  total: number;
  ready: number;
  paused: boolean;
}
export type Loader = (station: ChsStation, now: Date) => Promise<unknown>;

export const HORIZON_DAYS = 7;
const STEP_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Anchor times tiling the horizon; each loader call windows ±30h, so 2-day steps overlap. */
export function horizonAnchors(now: Date): Date[] {
  const out: Date[] = [];
  for (let d = 0; d < HORIZON_DAYS; d += STEP_DAYS) out.push(new Date(now.getTime() + d * DAY_MS));
  return out;
}

// The real loader dispatches by series, sharing one IndexedDB cache with the
// on-demand GroupCard/detail loads (same DB name → same store).
const sharedCache = indexedDbCache();
const defaultLoad: Loader = (station, now) =>
  isChsCurrent(station)
    ? chsCurrentDay(station, now, { cache: sharedCache })
    : chsTideDay(station, now, { cache: sharedCache });

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export interface OfflineSync {
  snapshot(): SyncSnapshot;
  subscribe(fn: () => void): () => void;
  start(): Promise<void>;
  pauseAll(): void;
  resumeAll(): Promise<void>;
  pause(id: string): void;
  restart(id: string): Promise<void>;
  restartAll(): Promise<void>;
  resumeIncomplete(): Promise<void>;
}

export function createOfflineSync(
  deps: {
    load?: Loader;
    now?: () => Date;
    concurrency?: number;
    paceMs?: number;
    stations?: ChsStation[];
  } = {},
): OfflineSync {
  const load = deps.load ?? defaultLoad;
  const now = deps.now ?? (() => new Date());
  const concurrency = deps.concurrency ?? 3;
  const paceMs = deps.paceMs ?? 250;
  const stations = deps.stations ?? (candidates.filter(isChs) as ChsStation[]);

  const jobs: StationJob[] = stations.map((station) => ({ station, status: "pending" }));
  let paused = false;
  let running = false;

  const listeners = new Set<() => void>();
  function build(): SyncSnapshot {
    return {
      jobs: jobs.map((j) => ({ ...j })),
      total: jobs.length,
      ready: jobs.filter((j) => j.status === "ready").length,
      paused,
    };
  }
  let snap = build();
  function emit() {
    snap = build();
    listeners.forEach((l) => l());
  }

  async function processJob(job: StationJob) {
    job.status = "downloading";
    emit();
    await sleep(paceMs);
    try {
      for (const anchor of horizonAnchors(now())) await load(job.station, anchor);
      job.status = "ready";
    } catch {
      job.status = "failed";
    }
    emit();
  }

  async function worker() {
    // Sync find-then-mark: no await between them, so two workers never grab the
    // same job (single-threaded JS).
    while (!paused) {
      const job = jobs.find((j) => j.status === "pending");
      if (!job) return;
      await processJob(job);
    }
  }

  async function pump() {
    if (running || paused) return;
    running = true;
    try {
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
    } finally {
      running = false;
    }
  }

  return {
    snapshot: () => snap,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start: () => pump(),
    pauseAll() {
      paused = true;
      emit();
    },
    resumeAll() {
      paused = false;
      emit();
      return pump();
    },
    pause(id) {
      const job = jobs.find((j) => j.station.id === id);
      if (job && (job.status === "pending" || job.status === "failed")) {
        job.status = "paused";
        emit();
      }
    },
    restart(id) {
      const job = jobs.find((j) => j.station.id === id);
      if (job) {
        job.status = "pending";
        emit();
      }
      return pump();
    },
    restartAll() {
      for (const job of jobs) if (job.status !== "ready") job.status = "pending";
      paused = false;
      emit();
      return pump();
    },
    resumeIncomplete() {
      for (const job of jobs) if (job.status === "failed") job.status = "pending";
      emit();
      return pump();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/offlineSync.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/offlineSync.ts src/offlineSync.test.ts
git commit -m "feat(offline): station-prefetch orchestrator store"
```

---

### Task 2: React binding (`useOfflineSync.ts`)

**Files:**
- Create: `src/useOfflineSync.ts`
- Test: `src/useOfflineSync.test.ts`

**Interfaces:**
- Consumes: `createOfflineSync`, `HORIZON_DAYS`, `SyncSnapshot`, `OfflineSync` from `./offlineSync`.
- Produces:
  - `function readSyncPaused(): boolean` / `function writeSyncPaused(v: boolean): void` (localStorage `slackwater.syncPaused`)
  - `interface OfflineSyncView extends SyncSnapshot { online: boolean; complete: boolean; through: Date; pauseAll(): void; resumeAll(): void; pause(id: string): void; restart(id: string): void; restartAll(): void; clearCache(): void; }`
  - `function useOfflineSync(): OfflineSyncView`

The hook wraps `pauseAll`/`resumeAll`/`restartAll` to also write/clear the persisted flag, tracks `navigator.onLine`, calls `resumeIncomplete()` on the `online` event, and exposes `clearCache()` (evict all cached days, then `restartAll`). `through` is the horizon end date for the "downloaded through" line. A single module-level store instance is shared.

- [ ] **Step 1: Write the failing test**

```ts
// src/useOfflineSync.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { readSyncPaused, writeSyncPaused } from "./useOfflineSync";

describe("sync-paused persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to false", () => {
    expect(readSyncPaused()).toBe(false);
  });

  it("round-trips true/false through localStorage", () => {
    writeSyncPaused(true);
    expect(readSyncPaused()).toBe(true);
    expect(localStorage.getItem("slackwater.syncPaused")).toBe("1");
    writeSyncPaused(false);
    expect(readSyncPaused()).toBe(false);
    expect(localStorage.getItem("slackwater.syncPaused")).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/useOfflineSync.test.ts`
Expected: FAIL — cannot resolve `./useOfflineSync`.

- [ ] **Step 3: Write the implementation**

```ts
// src/useOfflineSync.ts
import { useEffect, useSyncExternalStore } from "react";
import { createOfflineSync, HORIZON_DAYS, type SyncSnapshot } from "./offlineSync";
import { indexedDbCache } from "./chs/cache";

const KEY = "slackwater.syncPaused";
export function readSyncPaused(): boolean {
  return localStorage.getItem(KEY) === "1";
}
export function writeSyncPaused(v: boolean): void {
  if (v) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
}

export interface OfflineSyncView extends SyncSnapshot {
  online: boolean;
  complete: boolean;
  through: Date;
  pauseAll(): void;
  resumeAll(): void;
  pause(id: string): void;
  restart(id: string): void;
  restartAll(): void;
  clearCache(): void;
}

// One store for the app. Connectivity + persistence live here, not in the store.
const store = createOfflineSync();
const cache = indexedDbCache();
const DAY_MS = 24 * 60 * 60 * 1000;

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOfflineSync(): OfflineSyncView {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);

  useEffect(() => {
    // Auto-start on mount unless the user durably paused. Gate on connectivity.
    if (readSyncPaused()) {
      store.pauseAll();
    } else if (isOnline()) {
      void store.start();
    }
    const onOnline = () => {
      if (!readSyncPaused()) void store.resumeIncomplete();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const online = isOnline();
  const complete = snapshot.total > 0 && snapshot.ready === snapshot.total;
  const through = new Date(Date.now() + (HORIZON_DAYS - 1) * DAY_MS);

  return {
    ...snapshot,
    online,
    complete,
    through,
    pauseAll: () => {
      writeSyncPaused(true);
      store.pauseAll();
    },
    resumeAll: () => {
      writeSyncPaused(false);
      void store.resumeAll();
    },
    pause: (id) => store.pause(id),
    restart: (id) => void store.restart(id),
    restartAll: () => {
      writeSyncPaused(false);
      void store.restartAll();
    },
    clearCache: () => {
      void cache.evictBefore("9999-99-99").then(() => {
        writeSyncPaused(false);
        return store.restartAll();
      });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/useOfflineSync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/useOfflineSync.ts src/useOfflineSync.test.ts
git commit -m "feat(offline): useOfflineSync hook with persisted pause-all"
```

---

### Task 3: Progress meter (`OfflineStatus.tsx`)

**Files:**
- Create: `src/OfflineStatus.tsx`
- Test: `src/OfflineStatus.test.tsx`

**Interfaces:**
- Consumes: `OfflineSyncView` from `./useOfflineSync`.
- Produces: `function OfflineStatus({ view, onOpen }: { view: OfflineSyncView; onOpen: () => void }): JSX.Element`

Label rules (first match wins): `complete` → ready icon `✓` + "Offline ready"; `paused` → "Paused"; `!online && !complete` → "Waiting for signal"; else → meter + `${pct}%` where `pct = Math.round((ready / total) * 100)` (0 when total is 0). The whole thing is one `<button className="offline-status">` calling `onOpen`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/OfflineStatus.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineStatus } from "./OfflineStatus";
import type { OfflineSyncView } from "./useOfflineSync";

function view(over: Partial<OfflineSyncView>): OfflineSyncView {
  return {
    jobs: [], total: 4, ready: 1, paused: false, online: true, complete: false,
    through: new Date("2026-07-30T00:00:00Z"),
    pauseAll() {}, resumeAll() {}, pause() {}, restart() {}, restartAll() {}, clearCache() {},
    ...over,
  };
}

describe("OfflineStatus", () => {
  it("shows a percentage meter while syncing", () => {
    const html = renderToStaticMarkup(<OfflineStatus view={view({ ready: 1, total: 4 })} onOpen={() => {}} />);
    expect(html).toContain("25%");
    expect(html).toContain("offline-meter");
  });

  it("shows the ready icon when complete", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ ready: 4, total: 4, complete: true })} onOpen={() => {}} />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("Offline ready");
  });

  it("says waiting for signal when offline mid-sync", () => {
    const html = renderToStaticMarkup(
      <OfflineStatus view={view({ online: false, complete: false })} onOpen={() => {}} />,
    );
    expect(html).toContain("Waiting for signal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/OfflineStatus.test.tsx`
Expected: FAIL — cannot resolve `./OfflineStatus`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/OfflineStatus.tsx
import type { ReactNode } from "react";
import type { OfflineSyncView } from "./useOfflineSync";

export function OfflineStatus({ view, onOpen }: { view: OfflineSyncView; onOpen: () => void }) {
  const pct = view.total > 0 ? Math.round((view.ready / view.total) * 100) : 0;

  let label: string;
  let body: ReactNode;
  if (view.complete) {
    label = "Offline ready";
    body = <span className="offline-icon" aria-hidden="true">✓</span>;
  } else if (view.paused) {
    label = "Paused";
    body = <span className="offline-meter-label">Paused</span>;
  } else if (!view.online) {
    label = "Waiting for signal";
    body = <span className="offline-meter-label">Waiting for signal</span>;
  } else {
    label = `Downloading ${pct}%`;
    body = (
      <span className="offline-meter" aria-hidden="true">
        <span className="offline-meter-fill" style={{ width: `${pct}%` }} />
        <span className="offline-meter-pct">{pct}%</span>
      </span>
    );
  }

  return (
    <button className="offline-status" onClick={onOpen} aria-label={`Offline downloads — ${label}`}>
      {body}
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/OfflineStatus.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/OfflineStatus.tsx src/OfflineStatus.test.tsx
git commit -m "feat(offline): compact progress meter control"
```

---

### Task 4: Manager dialog (`OfflineManager.tsx`)

**Files:**
- Create: `src/OfflineManager.tsx`
- Test: `src/OfflineManager.test.tsx`

**Interfaces:**
- Consumes: `OfflineSyncView` from `./useOfflineSync`; `isChsCurrent` from `./chsStations`.
- Produces: `function OfflineManager({ open, view, onClose }: { open: boolean; view: OfflineSyncView; onClose: () => void }): JSX.Element`

A native `<dialog>` (mirror `Settings.tsx`: `showModal()`/`close()` driven by `open` in a `useEffect`). Header: title + Done. Body: "Downloaded through `<through>`" line; header actions **Pause all** (when not paused) / **Resume all** (when paused) / **Restart all**; two groups **Currents** (`isChsCurrent`) and **Tides**, each row = station name + status text + a per-row **Pause**/**Restart** button (Restart when `failed`/`paused`, else Pause). Footer: **Clear cache**.

- [ ] **Step 1: Write the failing test**

```tsx
// src/OfflineManager.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineManager } from "./OfflineManager";
import type { OfflineSyncView } from "./useOfflineSync";
import type { ChsStation } from "./chsStations";
import type { StationJob } from "./offlineSync";

function gate(id: string, series: "tide" | "current"): ChsStation {
  return {
    kind: "chs", series, provider: "chs", id, slug: id, name: id.replace("chs-", ""),
    context: "", latitude: 48, longitude: -123, aliases: [], timezone: "America/Vancouver",
  };
}
const jobs: StationJob[] = [
  { station: gate("chs-malibu", "current"), status: "ready" },
  { station: gate("chs-victoria", "tide"), status: "failed" },
];
function view(over: Partial<OfflineSyncView> = {}): OfflineSyncView {
  return {
    jobs, total: 2, ready: 1, paused: false, online: true, complete: false,
    through: new Date("2026-07-30T00:00:00Z"),
    pauseAll() {}, resumeAll() {}, pause() {}, restart() {}, restartAll() {}, clearCache() {},
    ...over,
  };
}

describe("OfflineManager", () => {
  it("groups stations and shows a restart affordance for a failed one", () => {
    const html = renderToStaticMarkup(<OfflineManager open view={view()} onClose={() => {}} />);
    expect(html).toContain("Currents");
    expect(html).toContain("Tides");
    expect(html).toContain("malibu");
    expect(html).toContain("victoria");
    expect(html).toContain("Restart");
    expect(html).toContain("Clear cache");
  });

  it("offers Resume all when paused", () => {
    const html = renderToStaticMarkup(<OfflineManager open view={view({ paused: true })} onClose={() => {}} />);
    expect(html).toContain("Resume all");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/OfflineManager.test.tsx`
Expected: FAIL — cannot resolve `./OfflineManager`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/OfflineManager.tsx
import { useEffect, useRef } from "react";
import { isChsCurrent } from "./chsStations";
import type { OfflineSyncView } from "./useOfflineSync";
import type { StationJob } from "./offlineSync";

const STATUS_TEXT: Record<StationJob["status"], string> = {
  pending: "Waiting",
  downloading: "Downloading…",
  ready: "Offline ✓",
  failed: "Failed",
  paused: "Paused",
};

function Row({ job, view }: { job: StationJob; view: OfflineSyncView }) {
  const canRestart = job.status === "failed" || job.status === "paused";
  return (
    <li className="offline-row">
      <span className="offline-row-name">{job.station.name}</span>
      <span className="offline-row-status">{STATUS_TEXT[job.status]}</span>
      {canRestart ? (
        <button onClick={() => view.restart(job.station.id)}>Restart</button>
      ) : (
        <button onClick={() => view.pause(job.station.id)} disabled={job.status === "ready"}>
          Pause
        </button>
      )}
    </li>
  );
}

export function OfflineManager({
  open,
  view,
  onClose,
}: {
  open: boolean;
  view: OfflineSyncView;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const currents = view.jobs.filter((j) => isChsCurrent(j.station));
  const tides = view.jobs.filter((j) => !isChsCurrent(j.station));
  const through = view.through.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <dialog ref={ref} className="offline-manager" onClose={onClose}>
      <div className="settings-head">
        <h2>Offline downloads</h2>
        <button className="done" onClick={onClose}>
          Done
        </button>
      </div>

      <p className="offline-through">
        {view.complete ? "Offline-ready through " : "Downloading through "}
        {through} · {view.ready}/{view.total}
      </p>

      <div className="offline-actions">
        {view.paused ? (
          <button onClick={view.resumeAll}>Resume all</button>
        ) : (
          <button onClick={view.pauseAll}>Pause all</button>
        )}
        <button onClick={view.restartAll}>Restart all</button>
      </div>

      {currents.length > 0 && (
        <>
          <p className="eyebrow">Currents</p>
          <ul className="offline-list">
            {currents.map((j) => (
              <Row key={j.station.id} job={j} view={view} />
            ))}
          </ul>
        </>
      )}
      {tides.length > 0 && (
        <>
          <p className="eyebrow">Tides</p>
          <ul className="offline-list">
            {tides.map((j) => (
              <Row key={j.station.id} job={j} view={view} />
            ))}
          </ul>
        </>
      )}

      <div className="offline-foot">
        <button className="offline-clear" onClick={view.clearCache}>
          Clear cache
        </button>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/OfflineManager.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/OfflineManager.tsx src/OfflineManager.test.tsx
git commit -m "feat(offline): downloads manager dialog"
```

---

### Task 5: Wire into App + styles

**Files:**
- Modify: `src/App.tsx` (imports near top; `sidebar-foot` block ~369-373; after `<Settings .../>` ~383)
- Modify: `src/styles.css` (append)

**Interfaces:**
- Consumes: `useOfflineSync` from `./useOfflineSync`; `OfflineStatus` from `./OfflineStatus`; `OfflineManager` from `./OfflineManager`.
- Produces: nothing new — end-to-end wiring.

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after the existing `import { Settings } from "./Settings";` (line ~20), add:

```tsx
import { useOfflineSync } from "./useOfflineSync";
import { OfflineStatus } from "./OfflineStatus";
import { OfflineManager } from "./OfflineManager";
```

- [ ] **Step 2: Mount the hook + manager open state**

In the `App` component body, next to `const [settingsOpen, setSettingsOpen] = useState(false);` (line ~123), add:

```tsx
const [offlineOpen, setOfflineOpen] = useState(false);
const offline = useOfflineSync();
```

- [ ] **Step 3: Render the meter beside Settings**

Replace the `sidebar-foot` block (currently lines ~369-373):

```tsx
        <div className="sidebar-foot">
          <button className="settings-entry" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
```

with:

```tsx
        <div className="sidebar-foot">
          <button className="settings-entry" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <OfflineStatus view={offline} onOpen={() => setOfflineOpen(true)} />
        </div>
```

- [ ] **Step 4: Render the manager dialog**

Immediately after the closing `/>` of `<Settings ... />` (line ~383), add:

```tsx
      <OfflineManager open={offlineOpen} view={offline} onClose={() => setOfflineOpen(false)} />
```

- [ ] **Step 5: Append styles**

Append to `src/styles.css`:

```css
/* Offline download meter + manager */
.sidebar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.offline-status {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.5rem;
  opacity: 0.85;
}
.offline-status:hover { opacity: 1; }
.offline-icon { color: #7bd88f; }
.offline-meter {
  position: relative;
  display: inline-block;
  width: 72px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}
.offline-meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: #7bd88f;
  transition: width 0.3s ease;
}
.offline-meter-pct,
.offline-meter-label {
  font-size: 0.75rem;
  opacity: 0.8;
  margin-left: 0.4rem;
}
.offline-manager .offline-through { opacity: 0.75; font-size: 0.85rem; }
.offline-actions { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.offline-list { list-style: none; padding: 0; margin: 0 0 0.75rem; }
.offline-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.35rem 0;
}
.offline-row-status { opacity: 0.7; font-size: 0.8rem; }
.offline-foot { margin-top: 0.5rem; }
```

Note: `.sidebar-foot` may already have rules being edited in an uncommitted change — merge these declarations rather than duplicating the selector if it already exists.

- [ ] **Step 6: Typecheck + full suite + build**

Run: `npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc exit 0; all tests pass; build succeeds.

- [ ] **Step 7: Manual smoke (real browser — IndexedDB + fetch aren't in jsdom)**

Run: `npx vite dev`, open the app online. Expected: the meter appears at the right of the Settings row and climbs to `✓ Offline ready`; clicking it opens the manager with Currents/Tides groups; toggle offline in devtools and reload → a never-visited station still renders its reading from cache.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/styles.css
git commit -m "feat(offline): wire meter + manager into the sidebar"
```

---

## Notes for the implementer

- **Do not** `git add -A` or commit `LocationGate.tsx`, `browserHelp.*`, or unrelated `styles.css` hunks — those are the owner's separate in-progress work. Stage only the files each task lists.
- The current-gate list wiring (`StationCard.tsx`, `StationList.tsx`, `App.tsx` `speedUnit`) is a prior, already-approved change that may be uncommitted in the tree — leave it as-is; it's orthogonal to this plan.
- `npx tsc --noEmit` is the project typecheck; run it wherever a task adds types.
