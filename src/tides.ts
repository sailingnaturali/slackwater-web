import { createTidePredictor } from "@neaps/tide-predictor";
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

  return { level, rising: soon > level, next, extremes, timeline };
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

/** Extremes falling on the same local day as `day`, for the day's table. */
export function extremesOn(state: TideState, day: Date, timezone: string): Extreme[] {
  const target = localDay(day, timezone);
  return state.extremes.filter((extreme) => localDay(extreme.time, timezone) === target);
}

function localDay(date: Date, timezone: string): string {
  return date.toLocaleDateString("en-CA", { timeZone: timezone });
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
function m2SpreadMinutes(candidates: Station[]): number {
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

  let quality: Match["quality"];
  if (best.distanceKm < 2) {
    // Standing at the station: the gradient describes the risk of snapping
    // across it, and there is no snap to make. Distance wins outright here.
    quality = "good";
  } else if (best.distanceKm > 40) {
    quality = "nearest";
  } else if (spread > 20 || best.distanceKm > 10) {
    quality = "approximate";
  } else {
    quality = "good";
  }

  return { ...best, quality };
}
