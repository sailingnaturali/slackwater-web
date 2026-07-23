import { useState } from "react";
import { distanceKm, predict, type Match, type ResolvedStation } from "./tides";
import { isChs, type ChsStation } from "./chsStations";
import type { Candidate } from "./place";
import type { Units } from "./units";
import type { NearbyStation } from "./nearby";
import { StationCard } from "./StationCard";
import { LocationCard } from "./LocationCard";
import { RECENT_LIMIT, STARRED_LIMIT, NEARBY_ALL_LIMIT } from "./savedStations";

export interface LocatedStation {
  /** Union: the located station can be a CHS port (e.g. Victoria). */
  station: ResolvedStation | ChsStation;
  match: Match;
}

interface Entry {
  // A group entry may be a CHS port (starred/recent/nearby now pool both) — its
  // card renders on identity, with no synchronous prediction.
  station: Candidate;
  km: number | null;
}

function withDistance(
  stations: Candidate[],
  origin: { latitude: number; longitude: number } | null,
): Entry[] {
  return stations
    .map((station) => ({ station, km: origin ? distanceKm(origin, station) : null }))
    .sort((a, b) =>
      a.km != null && b.km != null ? a.km - b.km : a.station.name.localeCompare(b.station.name),
    );
}

/**
 * The sidebar — grouped the way the iOS prototype groups it (spec §4), not a
 * flat searchable dump. Search moves to its own screen in a later task; until
 * that lands, reaching a station outside these four groups has no path from
 * here, which is a known gap of this step rather than an oversight.
 *
 * Groups and their data come in as props — starred, recent, nearby, and the
 * located station — so this renders and can be tested with no localStorage
 * involved. Wiring those to persistence is a separate task.
 */
export function StationList({
  located,
  starred,
  recent,
  nearby,
  origin,
  selectedId,
  units,
  now,
  onSelect,
  onToggleStar,
}: {
  located: LocatedStation | null;
  starred: Candidate[];
  recent: Candidate[];
  nearby: NearbyStation<Candidate>[];
  origin: { latitude: number; longitude: number } | null;
  selectedId: string;
  units: Units;
  now: Date;
  onSelect: (station: ResolvedStation | ChsStation) => void;
  onToggleStar?: (station: ResolvedStation | ChsStation) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // A station already shown above is noise if it is shown again below —
  // the located station takes precedence, then starred, then recent.
  const used = new Set<string>();
  if (located) used.add(located.station.id);

  const starredIds = new Set(starred.map((s) => s.id));

  const starredEntries = withDistance(starred, origin).filter((e) => !used.has(e.station.id));
  for (const e of starredEntries) used.add(e.station.id);

  const recentEntries = recent
    .filter((s) => !used.has(s.id))
    .map((station): Entry => ({ station, km: origin ? distanceKm(origin, station) : null }));
  for (const e of recentEntries) used.add(e.station.id);

  const nearbyEntries: Entry[] = nearby
    .filter((n) => !used.has(n.station.id))
    .map((n) => ({ station: n.station, km: n.km }));

  // `allLimit` bounds what "All" reveals, separate from the collapsed
  // `limit` — distinct only for NEARBY, where the fetch window (20) is
  // wider than the collapsed display (3). Enforced here rather than
  // trusted from the caller, since a prop is not a promise.
  const groups: {
    key: string;
    label: string;
    entries: Entry[];
    limit: number | null;
    allLimit?: number;
  }[] = [
    {
      key: "starred",
      label: "Starred",
      entries: starredEntries,
      limit: STARRED_LIMIT,
      allLimit: STARRED_LIMIT,
    },
    { key: "recent", label: "Recent", entries: recentEntries, limit: RECENT_LIMIT },
    { key: "nearby", label: "Nearby", entries: nearbyEntries, limit: 3, allLimit: NEARBY_ALL_LIMIT },
  ];

  return (
    <div className="stations">
      <section className="station-group">
        <p className="eyebrow">Current location</p>
        <LocationCard
          match={located?.match ?? null}
          station={located?.station ?? null}
          // A CHS port has no synchronous prediction — the card renders on
          // identity, and its reading loads in the detail view.
          state={located && !isChs(located.station) ? predict(located.station, now) : null}
          units={units}
          selected={located?.station.id === selectedId}
          starred={located ? starredIds.has(located.station.id) : false}
          onSelect={() => located && onSelect(located.station)}
          onToggleStar={onToggleStar && located ? () => onToggleStar(located.station) : undefined}
        />
      </section>

      {groups.map((group) => {
        if (!group.entries.length) return null;
        const isExpanded = expanded.has(group.key);
        const overLimit = group.limit != null && group.entries.length > group.limit;
        const visible =
          overLimit && !isExpanded
            ? group.entries.slice(0, group.limit!)
            : group.entries.slice(0, group.allLimit ?? group.entries.length);

        return (
          <section className="station-group" key={group.key}>
            <div className="station-group-head">
              <p className="eyebrow">{group.label}</p>
              {overLimit && !isExpanded && (
                <button
                  className="all-toggle"
                  onClick={() => setExpanded((prev) => new Set(prev).add(group.key))}
                >
                  All
                </button>
              )}
            </div>
            <ol className="station-cards">
              {visible.map(({ station, km }) => (
                <li key={station.id}>
                  <StationCard
                    station={station}
                    km={km ?? undefined}
                    // A CHS port has no synchronous prediction — render on
                    // identity, mirroring LocationCard for the located CHS port.
                    state={isChs(station) ? undefined : predict(station, now)}
                    units={units}
                    selected={station.id === selectedId}
                    starred={starredIds.has(station.id)}
                    onSelect={() => onSelect(station)}
                    onToggleStar={onToggleStar ? () => onToggleStar(station) : undefined}
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
