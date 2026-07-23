import { distanceKm } from "../tides";
import type { IwlsStationMeta } from "./client";

export const RESOLVE_TOLERANCE_KM = 3;

/**
 * Join a registry station to its IWLS id by position.
 *
 * Position is the match key, never name: the registry and IWLS name the same
 * port differently (see the "Victoria" vs "Victoria Harbour" cross-check
 * below), so name can only warn, not gate. Throws if the nearest same-series
 * station is beyond tolerance — binding a wrong-but-plausible station would
 * put the wrong water under a trusted name, which is the one failure this
 * app cannot ship.
 */
export function resolveStationId(
  target: { latitude: number; longitude: number; name: string },
  list: IwlsStationMeta[],
  seriesCode: string,
): string {
  const candidates = list.filter((s) => s.timeSeries.some((t) => t.code === seriesCode));
  if (candidates.length === 0) throw new Error(`no IWLS stations carry series ${seriesCode}`);

  let best = candidates[0];
  let bestKm = Infinity;
  for (const s of candidates) {
    const d = distanceKm(target, { latitude: s.latitude, longitude: s.longitude });
    if (d < bestKm) {
      bestKm = d;
      best = s;
    }
  }

  if (bestKm > RESOLVE_TOLERANCE_KM) {
    throw new Error(
      `no ${seriesCode} station within tolerance (${RESOLVE_TOLERANCE_KM} km) of ${target.name} ` +
        `(nearest ${best.officialName} at ${bestKm.toFixed(1)} km) — refusing to bind`,
    );
  }
  const a = target.name.toLowerCase();
  const b = best.officialName.toLowerCase();
  if (!(a.includes(b) || b.includes(a))) {
    console.warn(
      `CHS resolve: "${target.name}" matched "${best.officialName}" by position (${bestKm.toFixed(2)} km)`,
    );
  }
  return best.id;
}
