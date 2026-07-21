import { distanceKm, type Station } from "./tides";

export interface NearbyStation<T extends Station = Station> {
  station: T;
  km: number;
}

/**
 * The nearest `limit` stations to a position.
 *
 * Bounded deliberately: a list of everything sorted by distance is not
 * "nearby", it is the whole list in a different order.
 */
export function nearestStations<T extends Station>(
  origin: { latitude: number; longitude: number },
  stations: T[],
  limit: number,
): NearbyStation<T>[] {
  return stations
    .map((station) => ({ station, km: distanceKm(origin, station) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}
