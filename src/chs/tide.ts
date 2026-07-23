import type { Extreme, TideState } from "../tides";
import type { IwlsSample, IwlsStationMeta } from "./client";
import { type ChsCache } from "./cache";
import type { ChsStation } from "../chsStations";
import { HOUR_MS, localDaysInWindow, resolveCachedId, seriesForWindow } from "./window";

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

/**
 * The three now-relative fields (`level`, `rising`, `next`) computed against
 * `now` from the day-based `timeline`/`extremes`. Shared so `withNow` recomputes
 * them exactly the way `toTideState` first derived them.
 */
function nowFields(
  timeline: { time: Date; level: number }[],
  extremes: Extreme[],
  now: Date,
): Pick<TideState, "level" | "rising" | "next"> {
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
  return { level, rising, next };
}

/** Adapt one CHS tide day into the shape `predict()` returns, so downstream code is provenance-blind. */
export function toTideState(hilo: IwlsSample[], curve: IwlsSample[], now: Date): TideState {
  const extremes = classifyExtremes(hilo);
  const timeline = downsample(curve, TIMELINE_STEP_MINUTES);
  return { ...nowFields(timeline, extremes, now), extremes, timeline };
}

/**
 * Re-anchor a fetched day's `TideState` to a ticking `now` without refetching.
 * The day's `extremes`/`timeline` are fixed once fetched, but `level`/`rising`/
 * `next` are now-relative — recompute only those so the CHS hero tracks the
 * clock like NOAA's `predict()` does, instead of freezing (and counting the
 * `next` countdown into negatives) at fetch time.
 */
export function withNow(state: TideState, now: Date): TideState {
  return { ...state, ...nowFields(state.timeline, state.extremes, now) };
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
  const id = await resolveCachedId(station, "wlp", deps);

  const start = new Date(now.getTime() - 18 * HOUR_MS);
  const end = new Date(now.getTime() + 30 * HOUR_MS);
  const days = localDaysInWindow(start, end, station.timezone);

  const [hilo, curve] = await Promise.all([
    seriesForWindow(id, "wlp-hilo", days, station.timezone, start, end, deps.cache, deps.fetchFn),
    seriesForWindow(id, "wlp", days, station.timezone, start, end, deps.cache, deps.fetchFn),
  ]);
  return toTideState(hilo, curve, now);
}
