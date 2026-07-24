import { candidates } from "./place";
import { distanceKm } from "./tides";
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

// 7 days of offline runway. Each loader call fetches a full padded week per
// series and now caches every whole day of it (see seriesForWindow, issue #7),
// so the first anchor populates most of the horizon in one request pair and the
// later overlapping anchors are almost all cache hits — a cold prefetch of ~30
// stations costs roughly two request pairs per station, well under the IWLS
// 30/min cap. Stations sync closest-first (see prioritize) so the ones they'll
// actually use are ready long before the far ones.
export const HORIZON_DAYS = 7;
const STEP_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

// Anchor times tiling the horizon. Each loader call windows ±30h, so 2-day steps
// overlap: kept deliberately tight so that even if a week-wide fetch's interior
// reach falls short at a DST/timezone boundary, the next anchor backfills the gap
// rather than leaving an uncached hole. The overlap is cheap now — anchors past
// the first mostly resolve straight from cache.
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
  prioritize(origin: { latitude: number; longitude: number }): void;
  pauseAll(): void;
  resumeAll(): Promise<void>;
  pause(id: string): void;
  restart(id: string): Promise<void>;
  restartAll(): Promise<void>;
  resetAll(): Promise<void>;
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
  // 1, not 3: each loader fires 2–3 series in parallel internally, and the IWLS
  // rate limiter paces them anyway — serial stations keep progress legible (one
  // completes before the next starts) and the request queue shallow.
  const concurrency = deps.concurrency ?? 1;
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
    prioritize(origin) {
      // Closest-first: the worker always takes the first `pending` job, so
      // ordering the list by distance means the stations the user is near — the
      // ones they'll actually open — download before the far-flung ones. Safe
      // mid-sync: re-sorting only changes which pending job is picked next.
      jobs.sort((a, b) => distanceKm(origin, a.station) - distanceKm(origin, b.station));
      emit();
    },
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
      // Retry the incomplete ones, LEAVE READY ALONE: this is the manager's
      // kick-start button — a ready station is already offline, re-fetching it
      // would waste the scarce IWLS request budget. Use resetAll() for a true
      // from-scratch re-download (clearCache does).
      for (const job of jobs) if (job.status !== "ready") job.status = "pending";
      paused = false;
      emit();
      return pump();
    },
    resetAll() {
      // Re-queue EVERY job, ready included — for clearCache, which has just
      // wiped the cache, so even ready stations must re-download.
      for (const job of jobs) job.status = "pending";
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
