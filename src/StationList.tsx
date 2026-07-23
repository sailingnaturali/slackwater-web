import { useState } from "react";
import { distanceKm, predict, type Match, type ResolvedStation } from "./tides";
import { isChs, isChsCurrent, type ChsStation } from "./chsStations";
import { withNowCurrent } from "./chs/current";
import { useChsCurrent } from "./useChsCurrent";
import type { Candidate } from "./place";
import type { SpeedUnit, Units } from "./units";
import type { NearbyStation } from "./nearby";
import { StationCard } from "./StationCard";
import { LocationCard } from "./LocationCard";
import { RECENT_LIMIT, STARRED_LIMIT, NEARBY_ALL_LIMIT } from "./savedStations";

/**
 * One card in a group. Its own component so a current gate can load its reading
 * via `useChsCurrent` (a hook — can't run inside the group's `.map`). A bundled
 * tide station predicts synchronously; a CHS tide port still renders on identity
 * until its own list-loading lands (see StationCard's `state` doc).
 */
function GroupCard({
  station,
  km,
  units,
  speedUnit,
  now,
  selected,
  starred,
  onSelect,
  onToggleStar,
}: {
  station: Candidate;
  km: number | null;
  units: Units;
  speedUnit: SpeedUnit;
  now: Date;
  selected: boolean;
  starred: boolean;
  onSelect: () => void;
  onToggleStar?: () => void;
}) {
  // Cache-first (IndexedDB): free for a gate whose day is already cached, one
  // fetch on first sight. `null` for any non-current station → the hook no-ops.
  const chsCur = useChsCurrent(isChsCurrent(station) ? station : null, now);
  const current = chsCur.state ? withNowCurrent(chsCur.state, now) : undefined;

  return (
    <StationCard
      station={station}
      km={km ?? undefined}
      // A bundled tide station predicts offline; a CHS tide port renders on
      // identity (undefined); a current gate carries its loaded reading.
      state={isChs(station) ? undefined : predict(station, now)}
      current={current}
      units={units}
      speedUnit={speedUnit}
      selected={selected}
      starred={starred}
      onSelect={onSelect}
      onToggleStar={onToggleStar}
    />
  );
}

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

/** Whole degrees only — the station card carries identity; this is just "roughly where". */
function wholeDegrees({ latitude, longitude }: { latitude: number; longitude: number }): string {
  const lat = `${Math.round(Math.abs(latitude))}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.round(Math.abs(longitude))}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
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
  speedUnit = "kn",
  now,
  onSelect,
  onToggleStar,
  onRequestLocation,
}: {
  located: LocatedStation | null;
  starred: Candidate[];
  recent: Candidate[];
  nearby: NearbyStation<Candidate>[];
  origin: { latitude: number; longitude: number } | null;
  selectedId: string;
  units: Units;
  speedUnit?: SpeedUnit;
  now: Date;
  onSelect: (station: ResolvedStation | ChsStation) => void;
  onToggleStar?: (station: ResolvedStation | ChsStation) => void;
  onRequestLocation?: () => void;
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
        <p className="eyebrow">Current location{origin ? ` · ${wholeDegrees(origin)}` : ""}</p>
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
          onRequestLocation={onRequestLocation}
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
                  <GroupCard
                    station={station}
                    km={km}
                    units={units}
                    speedUnit={speedUnit}
                    now={now}
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
