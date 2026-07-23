import type { IwlsSample, IwlsStationMeta } from "./client";
import { fetchStationMeta } from "./client";
import { type ChsCache } from "./cache";
import { HOUR_MS, localDaysInWindow, resolveCachedId, seriesForWindow } from "./window";
import type { ChsStation } from "../chsStations";

/** Below this magnitude the water reads "Slack", not a direction (spec §5a). */
export const SLACK_KN = 0.15;

export interface CurrentEvent { time: Date; kind: "slack" | "max-flood" | "max-ebb"; speed: number }
export interface CurrentState {
  signed: number;
  speed: number;
  phase: "flood" | "ebb" | "slack";
  setDegrees: number;
  floodDirection: number;
  ebbDirection: number;
  nextSlack: CurrentEvent | null;
  following: CurrentEvent | null;
  events: CurrentEvent[];
  timeline: { time: Date; signed: number }[];
}

const P16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export function compass16(deg: number): string {
  const d = (((deg % 360) + 360) % 360);
  return P16[Math.round(d / 22.5) % 16];
}

export function currentPhaseWord(phase: CurrentState["phase"]): string {
  return phase === "flood" ? "Flooding" : phase === "ebb" ? "Ebbing" : "Slack";
}

const QUALIFIER: Record<string, CurrentEvent["kind"]> = {
  SLACK: "slack", EXTREMA_FLOOD: "max-flood", EXTREMA_EBB: "max-ebb",
};

/** wcp1-events → labelled CurrentEvents (CHS computes the slacks and peaks — spec §4). */
function toEvents(raw: IwlsSample[]): CurrentEvent[] {
  return raw
    .filter((s) => s.qualifier && QUALIFIER[s.qualifier])
    .map((s) => ({ time: new Date(s.eventDate), kind: QUALIFIER[s.qualifier!], speed: s.value }));
}

/** Merge speed + direction by timestamp and project onto the flood axis. */
function toTimeline(speeds: IwlsSample[], dirs: IwlsSample[], floodDirection: number) {
  const dirAt = new Map(dirs.map((d) => [d.eventDate, d.value]));
  const rad = Math.PI / 180;
  return speeds
    .filter((s) => dirAt.has(s.eventDate))
    .map((s) => ({
      time: new Date(s.eventDate),
      signed: s.value * Math.cos((dirAt.get(s.eventDate)! - floodDirection) * rad),
    }));
}

/** Signed velocity at `now`, linearly interpolated between bracketing samples. */
function signedAt(now: Date, timeline: { time: Date; signed: number }[]): number {
  if (timeline.length === 0) return 0;
  const t = now.getTime();
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1], b = timeline[i];
    if (t <= b.time.getTime()) {
      const span = b.time.getTime() - a.time.getTime();
      const frac = span > 0 ? (t - a.time.getTime()) / span : 0;
      return a.signed + (b.signed - a.signed) * frac;
    }
  }
  return timeline[timeline.length - 1].signed;
}

function nowFields(
  timeline: { time: Date; signed: number }[], events: CurrentEvent[],
  floodDirection: number, ebbDirection: number, now: Date,
): Pick<CurrentState, "signed" | "speed" | "phase" | "setDegrees" | "nextSlack" | "following"> {
  const signed = signedAt(now, timeline);
  const speed = Math.abs(signed);
  const phase = speed < SLACK_KN ? "slack" : signed > 0 ? "flood" : "ebb";
  // ponytail: gates are rectilinear reversing passes — direction is bimodal
  // (exactly floodDir/ebbDir), so the sign fixes the set. Carry a real
  // direction timeline only if a rotary gate ever joins the registry.
  const setDegrees = signed >= 0 ? floodDirection : ebbDirection;
  const nowMs = now.getTime();
  const nextSlack = events.find((e) => e.kind === "slack" && e.time.getTime() > nowMs) ?? null;
  const following = nextSlack
    ? events.find((e) => e.kind !== "slack" && e.time.getTime() > nextSlack.time.getTime()) ?? null
    : null;
  return { signed, speed, phase, setDegrees, nextSlack, following };
}

export function toCurrentState(
  eventsRaw: IwlsSample[], speeds: IwlsSample[], dirs: IwlsSample[],
  floodDirection: number, ebbDirection: number, now: Date,
): CurrentState {
  const events = toEvents(eventsRaw);
  const timeline = toTimeline(speeds, dirs, floodDirection);
  return {
    ...nowFields(timeline, events, floodDirection, ebbDirection, now),
    floodDirection, ebbDirection, events, timeline,
  };
}

export function withNowCurrent(state: CurrentState, now: Date): CurrentState {
  return { ...state, ...nowFields(state.timeline, state.events, state.floodDirection, state.ebbDirection, now) };
}

export async function chsCurrentDay(
  station: ChsStation, now: Date,
  deps: { cache: ChsCache; fetchFn?: typeof fetch; stationList?: IwlsStationMeta[] },
): Promise<CurrentState> {
  const id = await resolveCachedId(station, "wcsp1", deps);

  // Flood/ebb axis: per-station, stable, cached with no day component.
  const metaKey = `meta|${id}`;
  let axis = (await deps.cache.get(metaKey)) as { floodDirection: number; ebbDirection: number } | null;
  if (!axis) {
    const m = await fetchStationMeta(id, deps.fetchFn);
    axis = { floodDirection: m.floodDirection ?? 0, ebbDirection: m.ebbDirection ?? 180 };
    await deps.cache.set(metaKey, axis);
  }

  const start = new Date(now.getTime() - 18 * HOUR_MS);
  const end = new Date(now.getTime() + 30 * HOUR_MS);
  const days = localDaysInWindow(start, end, station.timezone);
  const [events, speeds, dirs] = await Promise.all([
    seriesForWindow(id, "wcp1-events", days, station.timezone, start, end, deps.cache, deps.fetchFn),
    seriesForWindow(id, "wcsp1", days, station.timezone, start, end, deps.cache, deps.fetchFn),
    seriesForWindow(id, "wcdp1", days, station.timezone, start, end, deps.cache, deps.fetchFn),
  ]);
  return toCurrentState(events, speeds, dirs, axis.floodDirection, axis.ebbDirection, now);
}
