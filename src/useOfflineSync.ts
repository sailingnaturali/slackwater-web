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

// The date the last completed sync's cache reaches — persisted so a later
// (possibly offline) session knows how long its offline data is good for, and
// whether it has expired. Cleared by clearCache.
const SYNCED_KEY = "slackwater.syncedThrough";
function readSyncedThrough(): Date | null {
  const raw = localStorage.getItem(SYNCED_KEY);
  return raw ? new Date(raw) : null;
}
function writeSyncedThrough(d: Date): void {
  localStorage.setItem(SYNCED_KEY, d.toISOString());
}
function startOfTodayMs(): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t.getTime();
}

export interface OfflineSyncView extends SyncSnapshot {
  online: boolean;
  complete: boolean;
  /** Stations whose download failed — drives the meter's attention (red) state. */
  failed: number;
  /** A sync is in progress: at least one station is still pending or downloading. */
  active: boolean;
  /** The horizon end of the current (in-progress) sync — the "downloading through" date. */
  through: Date;
  /** How far the last COMPLETED sync's cached data reaches, or null if never completed. */
  syncedThrough: Date | null;
  /** The last completed sync no longer covers today — offline data is stale, reconnect. */
  expired: boolean;
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

export function useOfflineSync(
  origin: { latitude: number; longitude: number } | null,
): OfflineSyncView {
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

  // Once location is known (and whenever it changes), re-order the remaining
  // pending downloads closest-first. Geolocation resolves after mount, so the
  // sync may begin in registry order for a station or two before this lands.
  useEffect(() => {
    if (origin) store.prioritize(origin);
  }, [origin?.latitude, origin?.longitude]);

  const online = isOnline();
  const complete = snapshot.total > 0 && snapshot.ready === snapshot.total;
  const failed = snapshot.jobs.filter((j) => j.status === "failed").length;
  const active = snapshot.jobs.some((j) => j.status === "pending" || j.status === "downloading");
  const through = new Date(Date.now() + (HORIZON_DAYS - 1) * DAY_MS);
  const syncedThrough = readSyncedThrough();
  const expired = syncedThrough != null && syncedThrough.getTime() < startOfTodayMs();

  // Record how far a completed sync reaches, so a later session (maybe offline)
  // can tell whether its cached data still covers today.
  useEffect(() => {
    if (complete) writeSyncedThrough(new Date(Date.now() + (HORIZON_DAYS - 1) * DAY_MS));
  }, [complete]);

  return {
    ...snapshot,
    online,
    complete,
    failed,
    active,
    through,
    syncedThrough,
    expired,
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
      // Wipe every cached day, drop the freshness marker, then resetAll (not
      // restartAll) so even ready stations re-download.
      localStorage.removeItem(SYNCED_KEY);
      void cache.evictBefore("9999-99-99").then(() => {
        writeSyncPaused(false);
        return store.resetAll();
      });
    },
  };
}
