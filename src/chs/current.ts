import type { IwlsSample, IwlsStationMeta } from "./client";
import { fetchStationMeta } from "./client";
import { type ChsCache } from "./cache";
import { HOUR_MS, localDaysInWindow, resolveCachedId, seriesForWindow } from "./window";
import type { ChsStation } from "../chsStations";

/** Below this magnitude the water reads "Slack", not a direction (spec §5a). */
export const SLACK_KN = 0.15;

export interface CurrentEvent {
  time: Date;
  kind: "slack" | "max-flood" | "max-ebb";
  /** Absent for a derived gate: CHS publishes no current there, so no speed is known. */
  speed?: number;
  /** Derived gates only: this slack sits at high water (true) or low water (false). */
  highWater?: boolean;
}
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
  /**
   * True when slack times were derived from a reference port's tide (a gate CHS
   * publishes no current for). Such a state carries honest slack times and a
   * flood/ebb phase from the tide trend, but no speed magnitude and no timeline.
   */
  derived?: boolean;
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
  if (state.derived) return { ...state, ...derivedNowFields(state.events, now) };
  return { ...state, ...nowFields(state.timeline, state.events, state.floodDirection, state.ebbDirection, now) };
}

// --- Derived gates: slack from a reference port's tide ---------------------
//
// Some passes (Malibu Rapids) have no CHS current station at all. The standard
// mariner's rule is that slack occurs a fixed lag after the reference port's
// high/low water, and the pass floods on the rising tide, ebbs on the falling
// one. So we can state slack *times* and the flood/ebb *phase* honestly — but
// never a speed, which CHS does not predict.

/** Within this of a derived slack, the gate reads "Slack" rather than flood/ebb. */
export const DERIVED_SLACK_WINDOW_MIN = 12;

/** wlp-hilo extremes strictly alternate; each is a high iff it exceeds its neighbour. */
function classifyHilo(hilo: IwlsSample[]): { time: Date; high: boolean }[] {
  const pts = hilo.map((s) => ({ time: new Date(s.eventDate), level: s.value }));
  return pts.map((p, i) => ({
    time: p.time,
    high: p.level > (i > 0 ? pts[i - 1].level : pts[i + 1]?.level ?? p.level),
  }));
}

function derivedNowFields(
  events: CurrentEvent[], now: Date,
): Pick<CurrentState, "signed" | "speed" | "phase" | "setDegrees" | "nextSlack" | "following"> {
  const nowMs = now.getTime();
  const nextSlack = events.find((e) => e.time.getTime() > nowMs) ?? null;
  // Distance to the nearest slack either side of now decides whether we call it "Slack".
  const best = events.reduce((m, e) => Math.min(m, Math.abs(e.time.getTime() - nowMs)), Infinity);
  // Heading toward a high-water slack ⇒ tide rising ⇒ flooding; toward low water ⇒ ebbing.
  // Past the last slack, invert its origin (an HW slack turns the flood to ebb).
  const rising = nextSlack ? nextSlack.highWater! : !events[events.length - 1]?.highWater;
  const phase: CurrentState["phase"] =
    best <= DERIVED_SLACK_WINDOW_MIN * 60_000 ? "slack" : rising ? "flood" : "ebb";
  return { signed: 0, speed: 0, phase, setDegrees: 0, nextSlack, following: null };
}

/** Reference-port high/low water → a derived gate's slack times + flood/ebb phase. */
export function deriveCurrentState(
  hilo: IwlsSample[], hwLagMin: number, lwLagMin: number, now: Date,
): CurrentState {
  const events: CurrentEvent[] = classifyHilo(hilo).map((e) => ({
    time: new Date(e.time.getTime() + (e.high ? hwLagMin : lwLagMin) * 60_000),
    kind: "slack",
    highWater: e.high,
  }));
  return {
    ...derivedNowFields(events, now),
    floodDirection: 0, ebbDirection: 0, events, timeline: [], derived: true,
  };
}

export async function chsCurrentDay(
  station: ChsStation, now: Date,
  deps: { cache: ChsCache; fetchFn?: typeof fetch; stationList?: IwlsStationMeta[] },
): Promise<CurrentState> {
  if (station.derived) {
    const { reference, hwLagMin, lwLagMin } = station.derived;
    // Resolve the reference tide port by its position, cached under this gate's id.
    const id = await resolveCachedId(
      { id: station.id, latitude: reference.latitude, longitude: reference.longitude, name: reference.name },
      "wlp-hilo", deps,
    );
    const start = new Date(now.getTime() - 18 * HOUR_MS);
    const end = new Date(now.getTime() + 30 * HOUR_MS);
    const days = localDaysInWindow(start, end, station.timezone);
    const hilo = await seriesForWindow(id, "wlp-hilo", days, station.timezone, start, end, deps.cache, deps.fetchFn);
    return deriveCurrentState(hilo, hwLagMin, lwLagMin, now);
  }

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
