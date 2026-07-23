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
  /** Stations whose download failed — drives the meter's attention (red) state. */
  failed: number;
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
  const through = new Date(Date.now() + (HORIZON_DAYS - 1) * DAY_MS);

  return {
    ...snapshot,
    online,
    complete,
    failed,
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
      // Wipe every cached day, then resetAll (not restartAll) so even ready
      // stations re-download — restartAll deliberately skips ready.
      void cache.evictBefore("9999-99-99").then(() => {
        writeSyncPaused(false);
        return store.resetAll();
      });
    },
  };
}
