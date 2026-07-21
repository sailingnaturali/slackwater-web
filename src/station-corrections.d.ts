/**
 * @sailingnaturali/station-corrections ships no types (plain JS package).
 * Minimal ambient declaration covering only the surface this app consumes.
 */
declare module "@sailingnaturali/station-corrections" {
  export interface ResolvedStationData {
    id: string;
    name: string;
    context: string;
    slug: string;
    cities: string[];
    aliases: string[];
    latitude: number;
    longitude: number;
    corrected: boolean;
    derived: boolean;
    positionVerified?: string;
  }

  export function createBundledResolver(): (station: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }) => ResolvedStationData;
}
