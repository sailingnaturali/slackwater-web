import type { Extreme, TideState } from "../tides";
import { localDay } from "../tides";
import type { IwlsSample, IwlsStationMeta } from "./client";
import { fetchSeries, fetchStationList } from "./client";
import { resolveStationId } from "./resolve";
import { type ChsCache, dayKey } from "./cache";
import type { ChsStation } from "../chsStations";

export const TIMELINE_STEP_MINUTES = 10;

/**
 * IWLS `wlp-hilo` gives the extreme values but not high/low labels, and they
 * strictly alternate, so each is a high iff it's greater than its neighbor.
 * The first element has no previous extreme, so it compares to the next one
 * instead (the last element mirrors this against its previous).
 */
function classifyExtremes(hilo: IwlsSample[]): Extreme[] {
  const pts = hilo.map((s) => ({ time: new Date(s.eventDate), level: s.value }));
  if (pts.length === 1) {
    // No neighbor to compare against, so the point can't classify itself — comparing
    // against its own level was always false, mislabelling every lone extreme "low".
    // Mooted once the window spans multiple days (chsTideDay always does); guarded
    // here so a single-sample fetch still returns something sane.
    return [{ ...pts[0], high: true }];
  }
  return pts.map((p, i) => {
    const ref = i > 0 ? pts[i - 1].level : pts[i + 1].level;
    return { time: p.time, level: p.level, high: p.level > ref };
  });
}

/** First sample per `stepMin` bucket (spec §3: never pass raw 1-minute through). */
function downsample(curve: IwlsSample[], stepMin: number): { time: Date; level: number }[] {
  const stepMs = stepMin * 60_000;
  const out: { time: Date; level: number }[] = [];
  let bucket = -1;
  for (const s of curve) {
    const t = new Date(s.eventDate).getTime();
    const b = Math.floor(t / stepMs);
    if (b !== bucket) {
      out.push({ time: new Date(s.eventDate), level: s.value });
      bucket = b;
    }
  }
  return out;
}

/** Adapt one CHS tide day into the shape `predict()` returns, so downstream code is provenance-blind. */
export function toTideState(hilo: IwlsSample[], curve: IwlsSample[], now: Date): TideState {
  const extremes = classifyExtremes(hilo);
  const timeline = downsample(curve, TIMELINE_STEP_MINUTES);
  const nowMs = now.getTime();

  // level at now: nearest timeline sample (10-minute spacing; nearest is within 5 min)
  let level = timeline[0]?.level ?? 0;
  let bestDt = Infinity;
  for (const p of timeline) {
    const dt = Math.abs(p.time.getTime() - nowMs);
    if (dt < bestDt) {
      bestDt = dt;
      level = p.level;
    }
  }
  const next = extremes.find((e) => e.time.getTime() > nowMs) ?? null;
  const rising = next ? next.high : false;
  return { level, rising, next, extremes, timeline };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Every station-local day touched by `[start, end]`, in order. */
function localDaysInWindow(start: Date, end: Date, timezone: string): string[] {
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
 * cap, spec §7b) and bucket the result by local day so a week of subsequent
 * browsing costs no further requests.
 */
async function seriesForWindow(
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
  for (const [d, slice] of buckets) {
    await cache.set(dayKey(stationId, series, d), slice);
  }
  return days.flatMap((d) => buckets.get(d) ?? []).filter(inRange(start, end));
}

/**
 * Resolve a registry station to its IWLS id, fetch/cache the tide data around
 * `now`, and adapt it to a `TideState`.
 *
 * Mirrors `predict()`'s own window exactly (now-18h to now+30h) so `next`/
 * `rising` never run out of extremes near the end of a local day the way a
 * single day's slice would.
 */
export async function chsTideDay(
  station: ChsStation,
  now: Date,
  deps: { cache: ChsCache; fetchFn?: typeof fetch; stationList?: IwlsStationMeta[] },
): Promise<TideState> {
  const list = deps.stationList ?? (await fetchStationList(deps.fetchFn));
  const id = resolveStationId(station, list, "wlp");

  const start = new Date(now.getTime() - 18 * HOUR_MS);
  const end = new Date(now.getTime() + 30 * HOUR_MS);
  const days = localDaysInWindow(start, end, station.timezone);

  const [hilo, curve] = await Promise.all([
    seriesForWindow(id, "wlp-hilo", days, station.timezone, start, end, deps.cache, deps.fetchFn),
    seriesForWindow(id, "wlp", days, station.timezone, start, end, deps.cache, deps.fetchFn),
  ]);
  return toTideState(hilo, curve, now);
}
