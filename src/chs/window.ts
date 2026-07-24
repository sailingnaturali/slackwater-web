import { localDay } from "../tides";
import type { IwlsSample, IwlsStationMeta } from "./client";
import { fetchSeries, fetchStationList } from "./client";
import { resolveStationId } from "./resolve";
import { type ChsCache, dayKey } from "./cache";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Every station-local day touched by `[start, end]`, in order. */
export function localDaysInWindow(start: Date, end: Date, timezone: string): string[] {
  const days: string[] = [];
  const seen = new Set<string>();
  for (let t = start.getTime(); t <= end.getTime(); t += HOUR_MS) {
    const d = localDay(new Date(t), timezone);
    if (!seen.has(d)) {
      seen.add(d);
      days.push(d);
    }
  }
  return days;
}

const inRange = (start: Date, end: Date) => (s: IwlsSample) => {
  const t = new Date(s.eventDate).getTime();
  return t >= start.getTime() && t <= end.getTime();
};

/**
 * Cache-check every station-local day the window touches; on any miss, fetch
 * the whole window in a single request (padded to the IWLS 7-day-per-request
 * cap, spec §7b) and bucket the result by local day. Subsequent browsing of
 * days already in the fetched window costs no further requests; a day outside
 * it still triggers one fetch (which caches its own week forward). The resolved
 * station id is cached separately (see `chsTideDay`), so it isn't re-fetched here.
 */
export async function seriesForWindow(
  stationId: string,
  series: string,
  days: string[],
  timezone: string,
  start: Date,
  end: Date,
  cache: ChsCache,
  fetchFn?: typeof fetch,
): Promise<IwlsSample[]> {
  const cached = await Promise.all(days.map((d) => cache.get(dayKey(stationId, series, d))));
  if (cached.every((c) => c !== null)) {
    return (cached as IwlsSample[][]).flat().filter(inRange(start, end));
  }

  // Padded a day earlier than the window needs, so a local day whose UTC
  // midnight falls before `start` (the station is west of UTC) isn't clipped;
  // capped at the IWLS 7-day max, which comfortably covers the ~2-day window
  // `chsTideDay` asks for plus a few days of cache-ahead.
  const from = new Date(start.getTime() - DAY_MS);
  const to = new Date(from.getTime() + 7 * DAY_MS);
  const all = await fetchSeries(stationId, series, from, to, fetchFn);

  const buckets = new Map<string, IwlsSample[]>();
  for (const s of all) {
    const d = localDay(new Date(s.eventDate), timezone);
    const bucket = buckets.get(d);
    if (bucket) bucket.push(s);
    else buckets.set(d, [s]);
  }
  // Cache every WHOLE day this one week-wide fetch covers, not just the `days`
  // this call needed. The request already paid for ~6 interior days; persisting
  // all of them lets a later load — the offline prefetch stepping the horizon,
  // or the user scrubbing forward — hit cache instead of re-fetching the very
  // same week (issue #7). Skip only the two partial edge days: the local day
  // holding `from` and the one holding `to` are clipped by the fetch cutoff, and
  // caching a partial day under its full-day key would let a later call reuse an
  // incomplete day forever (guarded by tide.test.ts "never caches a fetch-boundary
  // day"). `days` are padded strictly interior, so unioning them in only adds the
  // known-empty mark for a needed day that has no samples at all.
  const edge = new Set([localDay(from, timezone), localDay(to, timezone)]);
  const wholeDays = new Set([...days, ...buckets.keys()].filter((d) => !edge.has(d)));
  for (const d of wholeDays) {
    await cache.set(dayKey(stationId, series, d), buckets.get(d) ?? []);
  }
  return days.flatMap((d) => buckets.get(d) ?? []).filter(inRange(start, end));
}

/**
 * Resolve a registry station to its IWLS id and cache the join. The join is
 * stable, so it caches under a station-scoped key with no day component (never
 * evicted). On a hit, offline/repeat loads resolve without touching the network.
 */
export async function resolveCachedId(
  station: { id: string; latitude: number; longitude: number; name: string },
  seriesCode: string,
  deps: { cache: ChsCache; fetchFn?: typeof fetch; stationList?: IwlsStationMeta[] },
): Promise<string> {
  const resolveKey = `resolve|${station.id}`;
  let id = (await deps.cache.get(resolveKey)) as string | null;
  if (!id) {
    const list = deps.stationList ?? (await fetchStationList(deps.fetchFn));
    id = resolveStationId(station, list, seriesCode);
    await deps.cache.set(resolveKey, id);
  }
  return id;
}
