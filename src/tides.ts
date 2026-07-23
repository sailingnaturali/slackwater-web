import { createTidePredictor } from "@neaps/tide-predictor";
// Browser-safe since 1.3.0: the package imports its data as compiled JSON
// rather than reading files, so nothing reaches for a filesystem at runtime.
// (1.2.x needed the data hand-imported here; that blanked the page.)
import { createBundledResolver } from "@sailingnaturali/station-corrections";
import { getTimes as getSunTimes } from "suncalc";
import stationData from "./data/stations.json";

export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  chartDatum: string;
  /** Metres from MSL up to chart datum; heights are reported above chart datum. */
  datumOffset: number;
  source: string;
  sourceUrl: string;
  constituents: { name: string; amplitude: number; phase: number }[];
}

export const stations = stationData as Station[];

export interface ResolvedStation extends Station {
  /** Display name, cleaned and curated. */
  name: string;
  /** The water body, island or characteristic that distinguishes it. */
  context: string;
  /** Canonical URL segment. */
  slug: string;
  /** Alternate names and search terms this station is known by. */
  aliases: string[];
}

const resolve = createBundledResolver();

/**
 * Stations with naming resolved once at module load.
 *
 * Naming lives in @sailingnaturali/station-corrections so the app, iOS and the
 * MCPs all say the same thing. Position comes from the resolver too, so a
 * corrected station lands where the correction says.
 */
export const resolvedStations: ResolvedStation[] = stations.map((station) => {
  const r = resolve(station);
  return {
    ...station,
    name: r.name,
    context: r.context,
    slug: r.slug,
    aliases: r.aliases,
    latitude: r.latitude,
    longitude: r.longitude,
  };
});

export interface Extreme {
  time: Date;
  level: number;
  high: boolean;
}

export interface TideState {
  /** Height above chart datum, now. */
  level: number;
  rising: boolean;
  next: Extreme | null;
  extremes: Extreme[];
  timeline: { time: Date; level: number }[];
}

const HOUR = 3_600_000;

function predictorFor(station: Station) {
  return createTidePredictor(station.constituents, { offset: station.datumOffset });
}

/**
 * Everything the hero readout needs, in one pass.
 *
 * Deliberately computed together: the state line, the chart, and the day's
 * table all read from the same prediction, so they can never disagree on
 * screen — which is the failure users notice fastest in a tide app.
 */
export function predict(station: Station, now: Date): TideState {
  const predictor = predictorFor(station);

  // A day either side of the target so the chart has context and "next" always
  // exists, even just before midnight.
  const start = new Date(now.getTime() - 18 * HOUR);
  const end = new Date(now.getTime() + 30 * HOUR);

  const extremes: Extreme[] = predictor
    .getExtremesPrediction({ start, end })
    .map((extreme) => ({
      time: new Date(extreme.time),
      level: extreme.level,
      high: extreme.high,
    }));

  const timeline = predictor
    .getTimelinePrediction({ start, end, timeFidelity: 600 })
    .map((point) => ({ time: new Date(point.time), level: point.level }));

  const level = predictor.getWaterLevelAtTime({ time: now }).level;
  const soon = predictor.getWaterLevelAtTime({ time: new Date(now.getTime() + 600_000) }).level;
  const next = extremes.find((extreme) => extreme.time > now) ?? null;

  // Direction comes from the next turn, not from comparing two sampled levels.
  // Within a few minutes of a turn the curve is flat - the levels either side
  // differ by well under a millimetre - so sampling picks up numerical noise
  // and can report "falling" while parked exactly on a low. Heading toward a
  // high means rising, and that stays true however flat the water is.
  const rising = next ? next.high : soon > level;

  return { level, rising, next, extremes, timeline };
}

/**
 * Extremes across `days` starting from the local day containing `from`.
 *
 * Separate from `predict` because the schedule pages independently of the hero:
 * you can read next Saturday's tides without moving "now".
 */
export function predictRange(station: Station, from: Date, days: number): Extreme[] {
  const predictor = predictorFor(station);
  // A day either side so a turn near local midnight is not clipped by UTC edges.
  const start = new Date(from.getTime() - 24 * HOUR);
  const end = new Date(from.getTime() + (days + 1) * 24 * HOUR);
  const wanted = new Set(
    Array.from({ length: days }, (_, i) =>
      localDay(new Date(from.getTime() + i * 24 * HOUR), station.timezone),
    ),
  );
  return predictor
    .getExtremesPrediction({ start, end })
    .map((extreme) => ({
      time: new Date(extreme.time),
      level: extreme.level,
      high: extreme.high,
    }))
    .filter((extreme) => wanted.has(localDay(extreme.time, station.timezone)));
}

/**
 * Pull a scrubbed time onto a nearby high or low.
 *
 * Released within `windowMinutes` of a turn, the line parks exactly on it -
 * "when is high water" is the commonest reason to move the line at all, and
 * landing three minutes off is a worse answer than landing on it.
 */
export function snapToTurn(t: Date, extremes: Extreme[], windowMinutes: number): Date {
  let best: Extreme | null = null;
  let bestGap = windowMinutes * 60_000;
  for (const extreme of extremes) {
    const gap = Math.abs(extreme.time.getTime() - t.getTime());
    if (gap <= bestGap) {
      bestGap = gap;
      best = extreme;
    }
  }
  return best ? best.time : t;
}

/** Extremes falling on the same local day as `day`, for the day's table. */
export function extremesOn(state: TideState, day: Date, timezone: string): Extreme[] {
  const target = localDay(day, timezone);
  return state.extremes.filter((extreme) => localDay(extreme.time, timezone) === target);
}

export function localDay(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
}

export type DayEventKind = "high" | "low" | "sunrise" | "sunset";

/** One row of the schedule table — a tide turn or a sun event, same shape. */
export interface DayEvent {
  time: Date;
  kind: DayEventKind;
  /** Height above chart datum. Present for tide turns only. */
  level?: number;
}

/**
 * Sunrise/sunset for the station's local day, via suncalc.
 *
 * suncalc buckets by the UTC calendar day of the Date it's given, which
 * doesn't line up with the station's local day, so this asks it for the
 * day either side too and keeps whatever actually lands in the target
 * local day - the same widen-then-filter shape `predictRange` uses for
 * extremes, for the same reason (a turn/event near local midnight must not
 * get clipped by a UTC edge).
 *
 * A station far enough north can lack a sunrise or sunset entirely on a
 * given day (polar day/night) - suncalc's own shipped types (2.0.1) report
 * that as `null`, not Invalid Date. The bundled stations are all Salish Sea
 * (48-49°N) so this never fires today, but a null is dropped rather than
 * rendered as a row.
 */
function sunEvents(station: Station, day: Date): DayEvent[] {
  const target = localDay(day, station.timezone);
  const events: DayEvent[] = [];
  for (const offset of [-1, 0, 1]) {
    const reference = new Date(day.getTime() + offset * 24 * HOUR);
    const { sunrise, sunset } = getSunTimes(reference, station.latitude, station.longitude);
    if (sunrise && localDay(sunrise, station.timezone) === target) {
      events.push({ time: sunrise, kind: "sunrise" });
    }
    if (sunset && localDay(sunset, station.timezone) === target) {
      events.push({ time: sunset, kind: "sunset" });
    }
  }
  return events;
}

/**
 * Tide turns and sunrise/sunset for one local day, interleaved by time.
 *
 * The events table as a function of `t`, made concrete: everything that
 * happens to this station on this day, in the order it happens.
 */
export function dayEvents(station: Station, day: Date): DayEvent[] {
  const tides: DayEvent[] = predictRange(station, day, 1).map((extreme) => ({
    time: extreme.time,
    kind: extreme.high ? "high" : "low",
    level: extreme.level,
  }));
  return [...tides, ...sunEvents(station, day)].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const lat1 = a.latitude * toRad;
  const lat2 = b.latitude * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export interface Match {
  station: Station;
  distanceKm: number;
  /**
   * How much to trust this station for the requested position. Distance alone
   * is not enough: the tide can turn at visibly different times either side of
   * a pass. The gradient check below asks the constituents instead of a map.
   */
  quality: "good" | "approximate" | "nearest";
}

/** M2 phase spread, in minutes, across the candidates nearest a position. */
export function m2SpreadMinutes(candidates: Station[]): number {
  const phases = candidates
    .map((s) => s.constituents.find((c) => c.name === "M2")?.phase)
    .filter((p): p is number => p != null);
  if (phases.length < 2) return 0;
  // M2 advances 28.98°/hr, so degrees convert to minutes directly.
  const spread = Math.max(...phases) - Math.min(...phases);
  const wrapped = Math.min(spread, 360 - spread);
  return (wrapped / 28.9841042) * 60;
}

/**
 * Buckets a distance + M2 gradient spread into the three user-legible
 * qualities (§5f). Pulled out of `matchStation` so anything grading a
 * specific candidate — not just the single nearest pick — uses the same
 * thresholds rather than a second copy of them.
 */
export function matchQuality(distanceKm: number, spreadMinutes: number): Match["quality"] {
  if (distanceKm < 2) {
    // Standing at the station: the gradient describes the risk of snapping
    // across it, and there is no snap to make. Distance wins outright here.
    return "good";
  }
  if (distanceKm > 40) return "nearest";
  if (spreadMinutes > 20 || distanceKm > 10) return "approximate";
  return "good";
}

/**
 * Pick the station that answers for a position, and say how well it does.
 *
 * The gradient signal is the point: if the nearest few stations disagree on M2
 * phase, the tide genuinely differs across this neighbourhood and no snap
 * deserves to look confident, however close it is.
 */
export function matchStation(position: { latitude: number; longitude: number }): Match | null {
  if (!stations.length) return null;
  const ranked = stations
    .map((station) => ({ station, distanceKm: distanceKm(position, station) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const [best] = ranked;
  const spread = m2SpreadMinutes(ranked.slice(0, 3).map((r) => r.station));

  return { ...best, quality: matchQuality(best.distanceKm, spread) };
}
