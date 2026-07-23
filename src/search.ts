import type { Candidate } from "./place";

/**
 * Name, context, then alias — in that order because a name match is what
 * the user typed on purpose; context and aliases (the corrections layer's
 * "port gardner" / "everett marina") are how you find a station when you
 * only know the water, not its proper name.
 */
export function searchStations(query: string, stations: Candidate[]): Candidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return stations
    .map((station) => ({ station, rank: matchRank(q, station) }))
    .filter((entry): entry is { station: Candidate; rank: number } => entry.rank != null)
    .sort((a, b) => a.rank - b.rank || a.station.name.localeCompare(b.station.name))
    .map((entry) => entry.station);
}

function matchRank(q: string, station: Candidate): number | null {
  if (station.name.toLowerCase().includes(q)) return 0;
  if (station.context.toLowerCase().includes(q)) return 1;
  if (station.aliases.some((alias) => alias.toLowerCase().includes(q))) return 2;
  return null;
}
