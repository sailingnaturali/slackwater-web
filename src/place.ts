import gazetteerData from "@sailingnaturali/station-corrections/data/gazetteer.json";
import { resolvedStations, distanceKm, matchStation, type ResolvedStation, type Match } from "./tides";
import { chsStations, chsCurrentStations, type ChsStation } from "./chsStations";
import { getPlaceStation } from "./savedStations";

/**
 * Both bundled NOAA and online CHS ports are candidates for "which station is
 * nearest". The search only ever reads identity (position, slug, name), never
 * constituents, so a CHS port — which has no harmonics — belongs in the pool.
 * Without it, Victoria snaps across Haro Strait to a NOAA station (spec §7).
 */
export type Candidate = ResolvedStation | ChsStation;

/** The whole pool the app can name — bundled NOAA plus online CHS ports. */
export const candidates: Candidate[] = [...resolvedStations, ...chsStations, ...chsCurrentStations];

export interface Place {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

const gazetteer = gazetteerData as Place[];

/**
 * Beyond this, no gazetteer entry is a sane answer for "where are you" — a
 * boat off Hawaii should not be told it's in Victoria. The gazetteer's
 * widest nearest-neighbour gap is ~61km (Nanaimo to its nearest neighbour),
 * so 100km comfortably covers real drift within the Salish Sea while still
 * being a rounding error next to the distance to anywhere actually outside
 * its ~19-place coverage.
 */
export const MAX_PLACE_DISTANCE_KM = 100;

/** How many nearby stations `matchForPosition` offers for a later chooser UI. */
const ALTERNATIVES_LIMIT = 5;

/** The named place nearest a position, or null if nothing in the gazetteer is close. */
export function nearestPlace(position: { latitude: number; longitude: number }): Place | null {
  if (!gazetteer.length) return null;
  const [best] = gazetteer
    .map((place) => ({ place, distanceKm: distanceKm(position, place) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return best.distanceKm <= MAX_PLACE_DISTANCE_KM ? best.place : null;
}

/** Stations nearest a place, nearest first. */
export function stationsNear(place: Place, limit: number): Candidate[] {
  return candidates
    .map((station) => ({ station, distanceKm: distanceKm(place, station) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map((r) => r.station);
}

export interface PositionMatch {
  place: Place;
  station: Candidate;
  /** Nearest-first; always includes `station`, so the chooser needs no second lookup. */
  alternatives: Candidate[];
  /** True when `station` came from a saved place -> station choice, not the automatic nearest. */
  overridden: boolean;
}

/**
 * Position -> named place -> station. A saved choice for the place wins over
 * the automatic nearest, and it only ever applies to that place's name.
 */
export function matchForPosition(
  position: { latitude: number; longitude: number },
): PositionMatch | null {
  const place = nearestPlace(position);
  if (!place) return null;

  const alternatives = stationsNear(place, ALTERNATIVES_LIMIT);
  const overrideSlug = getPlaceStation(place.name);
  const overrideStation =
    overrideSlug != null
      ? (alternatives.find((s) => s.slug === overrideSlug) ??
        candidates.find((s) => s.slug === overrideSlug))
      : undefined;

  if (overrideStation) {
    const withSelection = alternatives.some((s) => s.slug === overrideStation.slug)
      ? alternatives
      : [...alternatives, overrideStation].sort(
          (a, b) => distanceKm(place, a) - distanceKm(place, b),
        );
    return { place, station: overrideStation, alternatives: withSelection, overridden: true };
  }

  return { place, station: alternatives[0], alternatives, overridden: false };
}

/**
 * The single "given this fix, which station and how good a match" — station
 * (and place override) from `matchForPosition`, quality from `matchStation`.
 * Both the initial gate and the live watch call this so they never disagree
 * for the same coordinate; they used to, and the disagreement made
 * `rememberLocation` demote one pick into Recent — a phantom entry on a
 * first-ever visit.
 */
export function locateStation(position: {
  latitude: number;
  longitude: number;
}): { station: Candidate; distanceKm: number; quality: Match["quality"] } | null {
  const match = matchForPosition(position);
  if (!match) return null;
  const graded = matchStation(position);
  return {
    station: match.station,
    distanceKm: distanceKm(position, match.station),
    quality: graded?.quality ?? "nearest",
  };
}
