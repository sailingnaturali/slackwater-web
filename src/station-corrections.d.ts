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

  export interface RawStation {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }

  export interface GazetteerPlace {
    name: string;
    region: string;
    latitude: number;
    longitude: number;
  }

  export function loadCorrections(yamlText: string): Map<string, unknown>;

  export function createResolver(options: {
    corrections: Map<string, unknown>;
    gazetteer: GazetteerPlace[];
  }): (station: RawStation) => ResolvedStationData;

  /** Node only - reads bundled data with node:fs. Do not use in the browser. */
  export function createBundledResolver(): (station: RawStation) => ResolvedStationData;
}

declare module "@sailingnaturali/station-corrections/data/corrections.yaml?raw" {
  const content: string;
  export default content;
}

declare module "@sailingnaturali/station-corrections/data/gazetteer.json" {
  const places: { name: string; region: string; latitude: number; longitude: number }[];
  export default places;
}
