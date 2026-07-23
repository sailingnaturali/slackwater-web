import { useEffect, useState } from "react";
import type { TideState } from "./tides";
import type { ChsStation } from "./chsStations";
import { chsTideDay } from "./chs/tide";
import { type ChsCache, indexedDbCache } from "./chs/cache";
import type { IwlsStationMeta } from "./chs/client";

export type ChsStatus = "loading" | "ready" | "offline";

export async function loadChsTide(
  station: ChsStation, day: Date, cache: ChsCache,
  fetchFn?: typeof fetch, stationList?: IwlsStationMeta[],
): Promise<{ state: TideState | null; status: ChsStatus }> {
  try {
    const state = await chsTideDay(station, day, { cache, fetchFn, stationList });
    // A valid 200 with no samples (station carries the series but returned an
    // empty window) adapts to a degenerate state — flat line at level 0. That's
    // a lie, not a reading: treat it as honestly degraded, same as offline.
    if (state.timeline.length === 0 || state.extremes.length === 0) {
      return { state: null, status: "offline" };
    }
    return { state, status: "ready" };
  } catch {
    // Fetch failed and the adapter could not serve from cache — the honest offline state.
    return { state: null, status: "offline" };
  }
}

const browserCache = indexedDbCache();

export function useChsTide(station: ChsStation | null, day: Date): { state: TideState | null; status: ChsStatus } {
  const [result, setResult] = useState<{ state: TideState | null; status: ChsStatus }>(
    { state: null, status: "loading" },
  );
  const dayKey = day.toISOString().slice(0, 10);

  useEffect(() => {
    if (!station) return;
    let live = true;
    setResult({ state: null, status: "loading" });
    loadChsTide(station, day, browserCache).then((r) => { if (live) setResult(r); });
    return () => { live = false; };
    // day identity via its ISO day, not the Date object
  }, [station?.id, dayKey]);

  return result;
}
