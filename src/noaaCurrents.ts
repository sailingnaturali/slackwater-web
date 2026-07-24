import { createTidePredictor } from "@neaps/tide-predictor";
import { createBundledResolver, toSlug } from "@sailingnaturali/station-corrections";
import { withNowCurrent, type CurrentEvent, type CurrentState } from "./chs/current";
import { resolvedStations } from "./tides";
import { chsStations, chsCurrentStations } from "./chsStations";
import currentData from "./data/currents.json";

/** A bundled NOAA current station: predicts signed velocity offline, like a
 * bundled tide station predicts height — same harmonic sum, different unit. */
export interface NoaaCurrentStation {
  kind: "noaa-current";
  /** `noaa/<CO-OPS id>`, e.g. "noaa/PUG1741". */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  floodDirection: number;
  ebbDirection: number;
  /** Z0 net mean flow along the major axis, knots, signed. */
  meanFlow: number;
  constituents: { name: string; amplitude: number; phase: number }[];
}

export interface ResolvedNoaaCurrentStation extends NoaaCurrentStation {
  context: string;
  slug: string;
  aliases: string[];
}

export const isNoaaCurrent = (s: { kind?: string }): s is ResolvedNoaaCurrentStation =>
  s.kind === "noaa-current";

const resolve = createBundledResolver();

// Slugs already spoken for: a current station named after the same water as a
// tide station (Friday Harbor has both) must not shadow the tide URL that's
// already in shared links.
const takenSlugs = new Set([
  ...resolvedStations.map((s) => s.slug),
  ...chsStations.map((s) => s.slug),
  ...chsCurrentStations.map((s) => s.slug),
]);

/**
 * Deterministic local slug tiebreak. NOAA gives ~40 of the 133 bundled
 * current stations a shared landmark name, distinguished only by the
 * distance/bearing qualifier station-corrections splits into `context`
 * rather than `slug` (e.g. "Alki Point, 1 mile West of" vs "Alki Point, West
 * of" both resolve `name` to "Alki Point"). Rung 1 is the plain resolved
 * slug; rung 2 is the existing cross-type tiebreak (a current station named
 * after a tide station), now just the next rung instead of a special case;
 * rungs 3 and 4 are local-only placeholders pulling NOAA's own qualifier (and
 * failing that, its station id) back in to break the remaining ties — a
 * future station-corrections curation pass may give these a nicer slug, at
 * which point `formerSlugs` (see url.ts) is the redirect path off the old one.
 */
export function assignSlug(
  r: { slug: string; name: string; context: string },
  id: string,
  used: Set<string>,
): string {
  const candidates = [
    r.slug,
    `${r.slug}-current`,
    toSlug(`${r.name} ${r.context}`),
    `${r.slug}-${id.replace("noaa/", "").toLowerCase()}`,
  ];
  const slug = candidates.find((c) => !used.has(c)) ?? candidates[candidates.length - 1];
  used.add(slug);
  return slug;
}

export const noaaCurrentStations: NoaaCurrentStation[] = (
  currentData as Omit<NoaaCurrentStation, "kind">[]
).map((s) => ({ kind: "noaa-current" as const, ...s }));

const usedSlugs = new Set(takenSlugs);

export const resolvedNoaaCurrentStations: ResolvedNoaaCurrentStation[] =
  noaaCurrentStations.map((station) => {
    const r = resolve(station);
    const slug = assignSlug(r, station.id, usedSlugs);
    return {
      ...station,
      name: r.name,
      context: r.context,
      slug,
      aliases: r.aliases,
      latitude: r.latitude,
      longitude: r.longitude,
    };
  });

const HOUR = 3_600_000;

/**
 * Everything the current panes need, in one pass — the currents twin of
 * `predict()` in tides.ts, emitting the CHS adapter's CurrentState so every
 * component downstream stays provenance-blind.
 *
 * The predictor's "level" is signed major-axis velocity in knots: the same
 * harmonic sum, with the Z0 mean flow riding in as the offset. Extremes of
 * that curve are max flood (positive highs) and max ebb (negative lows);
 * zero crossings are slack. A high that never reaches positive water (or a
 * low that never goes negative) is a weakest-ebb/flood wiggle mid-phase —
 * dropped, because calling it a "max" would mislabel the turn structure.
 */
export function noaaCurrentState(station: NoaaCurrentStation, now: Date): CurrentState {
  const predictor = createTidePredictor(station.constituents, { offset: station.meanFlow });
  const start = new Date(now.getTime() - 30 * HOUR);
  const end = new Date(now.getTime() + 30 * HOUR);

  const timeline = predictor
    .getTimelinePrediction({ start, end, timeFidelity: 600 })
    .map((p) => ({ time: new Date(p.time), signed: p.level }));

  const maxes: CurrentEvent[] = predictor
    .getExtremesPrediction({ start, end })
    .filter((e) => (e.high ? e.level > 0 : e.level < 0))
    .map((e) => ({
      time: new Date(e.time),
      kind: e.high ? ("max-flood" as const) : ("max-ebb" as const),
      speed: Math.abs(e.level),
    }));

  // Slack: linear interpolation of the sign change between timeline samples.
  // 600s sampling puts the crossing within ~seconds for real stations.
  const slacks: CurrentEvent[] = [];
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (a.signed === 0 || a.signed > 0 === b.signed > 0) continue;
    const frac = a.signed / (a.signed - b.signed);
    slacks.push({
      time: new Date(a.time.getTime() + frac * (b.time.getTime() - a.time.getTime())),
      kind: "slack",
    });
  }

  const events = [...maxes, ...slacks].sort((x, y) => x.time.getTime() - y.time.getTime());

  // withNowCurrent fills every now-relative field from timeline + events.
  return withNowCurrent(
    {
      signed: 0,
      speed: 0,
      phase: "slack",
      setDegrees: 0,
      floodDirection: station.floodDirection,
      ebbDirection: station.ebbDirection,
      nextSlack: null,
      following: null,
      events,
      timeline,
    },
    now,
  );
}
