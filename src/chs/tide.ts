import type { Extreme, TideState } from "../tides";
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
  return pts.map((p, i) => {
    const ref = i > 0 ? pts[i - 1].level : (pts[i + 1]?.level ?? p.level);
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
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cache-check one series for one day; on a miss, fetch a 7-day forward
 * window in a single request (spec §7b) and cache each day's slice, so a
 * week of browsing only costs one request per series.
 */
async function seriesForDay(
  stationId: string,
  series: string,
  day: Date,
  cache: ChsCache,
  fetchFn?: typeof fetch,
): Promise<IwlsSample[]> {
  const key = dayKey(stationId, series, isoDay(day));
  const cached = await cache.get(key);
  if (cached) return cached as IwlsSample[];

  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const to = new Date(from.getTime() + 7 * DAY_MS);
  const all = await fetchSeries(stationId, series, from, to, fetchFn);
  for (let i = 0; i < 7; i++) {
    const d = new Date(from.getTime() + i * DAY_MS);
    const slice = all.filter((s) => isoDay(new Date(s.eventDate)) === isoDay(d));
    await cache.set(dayKey(stationId, series, isoDay(d)), slice);
  }
  return all.filter((s) => isoDay(new Date(s.eventDate)) === isoDay(day));
}

/** Resolve a registry station to its IWLS id, fetch/cache its tide day, and adapt it to a `TideState`. */
export async function chsTideDay(
  station: ChsStation,
  day: Date,
  deps: { cache: ChsCache; fetchFn?: typeof fetch; stationList?: IwlsStationMeta[] },
): Promise<TideState> {
  const list = deps.stationList ?? (await fetchStationList(deps.fetchFn));
  const id = resolveStationId(station, list, "wlp");
  const [hilo, curve] = await Promise.all([
    seriesForDay(id, "wlp-hilo", day, deps.cache, deps.fetchFn),
    seriesForDay(id, "wlp", day, deps.cache, deps.fetchFn),
  ]);
  return toTideState(hilo, curve, day);
}
