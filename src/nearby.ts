import { distanceKm, type Station } from "./tides";

/** Anything with a position can be ranked by distance — bundled or CHS. */
type Locatable = { latitude: number; longitude: number };

export interface NearbyStation<T extends Locatable = Station> {
  station: T;
  km: number;
}

/**
 * The nearest `limit` stations to a position.
 *
 * Bounded deliberately: a list of everything sorted by distance is not
 * "nearby", it is the whole list in a different order.
 */
export function nearestStations<T extends Locatable>(
  origin: { latitude: number; longitude: number },
  stations: T[],
  limit: number,
): NearbyStation<T>[] {
  return stations
    .map((station) => ({ station, km: distanceKm(origin, station) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
