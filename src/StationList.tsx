import { useState } from "react";
import { distanceKm, predict, type Match } from "./tides";
import { isChs, isChsCurrent, companionOf } from "./chsStations";
import { isNoaaCurrent, noaaCurrentState } from "./noaaCurrents";
import { withNowCurrent } from "./chs/current";
import { withNow } from "./chs/tide";
import { useChsCurrent } from "./useChsCurrent";
import { useChsTide } from "./useChsTide";
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
 *
 * A gate paired with a tide port (e.g. Malibu Rapids) shows BOTH readings on
 * one card — the same merge the detail view does — so the list can't drift from
 * the page it links to. The companion tide rides a second hook here, since a
 * gate's `useChsCurrent` reading carries only current/slack, never tide height.
 */
function GroupCard({
  station,
  km,
  units,
  speedUnit,
  now,
  selected,
  onSelect,
}: {
  station: Candidate;
  km: number | null;
  units: Units;
  speedUnit: SpeedUnit;
  now: Date;
  selected: boolean;
  onSelect: () => void;
}) {
  // Cache-first (IndexedDB): free for a gate whose day is already cached, one
  // fetch on first sight. `null` for any non-current station → the hook no-ops.
  const gate = isChsCurrent(station) ? station : null;
  const chsCur = useChsCurrent(gate, now);
  const current = isNoaaCurrent(station)
    ? noaaCurrentState(station, now)
    : chsCur.state
      ? withNowCurrent(chsCur.state, now)
      : undefined;

  // Tide reading. A gate borrows its companion tide port (Malibu Rapids → Point
  // Atkinson); a standalone CHS tide port (e.g. Victoria as the current location)
  // loads its OWN tide; a bundled NOAA station needs neither (predict is
  // synchronous below). Cache-first, and a no-op when there's nothing to load.
  const tidePort = gate ? companionOf(gate) : isChs(station) ? station : null;
  const chsTide = useChsTide(tidePort, now);
  const tide = chsTide.state ? withNow(chsTide.state, now) : undefined;

  return (
    <StationCard
      station={station}
      km={km ?? undefined}
      // A CHS station (gate's companion, or a tide port's own) shows its loaded
      // tide; a bundled NOAA station predicts synchronously. A NOAA current
      // station has no height prediction to make — this guard only keeps
      // predict() from ever seeing one.
      state={isChs(station) ? tide : isNoaaCurrent(station) ? undefined : predict(station, now)}
      current={current}
      units={units}
      speedUnit={speedUnit}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

export interface LocatedStation {
  /** Union: the located station can be a CHS port (e.g. Victoria) or a NOAA current station. */
  station: Candidate;
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
  onSelect: (station: Candidate) => void;
  onRequestLocation?: () => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // A station already shown above is noise if it is shown again below —
  // the located station takes precedence, then starred, then recent.
  const used = new Set<string>();
  if (located) used.add(located.station.id);

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
        {located ? (
          // The same card path as the groups below — so a located current gate
          // (or, later, a CHS tide port) loads its reading exactly like a
          // listed one, instead of a second path that has to re-grow each hook.
          <GroupCard
            station={located.station}
            km={null}
            units={units}
            speedUnit={speedUnit}
            now={now}
            selected={located.station.id === selectedId}
            onSelect={() => onSelect(located.station)}
          />
        ) : (
          <LocationCard onRequestLocation={onRequestLocation} />
        )}
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
                    onSelect={() => onSelect(station)}
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
