import { useEffect, useState } from "react";
import type { ChsStation } from "./chsStations";
import { chsCurrentDay, type CurrentState } from "./chs/current";
import { type ChsCache, indexedDbCache } from "./chs/cache";
import type { IwlsStationMeta } from "./chs/client";

export type ChsStatus = "loading" | "ready" | "offline";

export async function loadChsCurrent(
  station: ChsStation, now: Date, cache: ChsCache,
  fetchFn?: typeof fetch, stationList?: IwlsStationMeta[],
): Promise<{ state: CurrentState | null; status: ChsStatus }> {
  try {
    const state = await chsCurrentDay(station, now, { cache, fetchFn, stationList });
    // A valid 200 with no samples adapts to a degenerate state — a lie, not a
    // reading. Treat it as honestly degraded, same as offline. A derived gate
    // has no timeline by design (slack times only), so only its events matter.
    const noData = state.derived ? state.events.length === 0 : state.timeline.length === 0 || state.events.length === 0;
    if (noData) {
      return { state: null, status: "offline" };
    }
    return { state, status: "ready" };
  } catch {
    // Fetch failed and the adapter could not serve from cache — the honest offline state.
    return { state: null, status: "offline" };
  }
}

const browserCache = indexedDbCache();

export function useChsCurrent(station: ChsStation | null, now: Date): { state: CurrentState | null; status: ChsStatus } {
  const [result, setResult] = useState<{ state: CurrentState | null; status: ChsStatus }>(
    { state: null, status: "loading" },
  );
  const dayKey = now.toISOString().slice(0, 10);

  useEffect(() => {
    if (!station) return;
    let live = true;
    setResult({ state: null, status: "loading" });
    loadChsCurrent(station, now, browserCache).then((r) => { if (live) setResult(r); });
    return () => { live = false; };
    // day identity via ISO day, not the ticking Date — refetch on station or day change only.
  }, [station?.id, dayKey]);

  return result;
}
