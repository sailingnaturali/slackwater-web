import { useMemo, useState } from "react";
import { distanceKm, resolvedStations, type Station } from "./tides";

/**
 * The station list — the fallback when location is declined, and the switcher
 * everywhere else.
 *
 * On desktop this is a permanent sidebar; on a phone it is a sheet you open.
 * Same component either way, so the two never drift apart.
 */
export function StationList({
  selected,
  origin,
  onSelect,
}: {
  selected: Station;
  origin: { latitude: number; longitude: number } | null;
  onSelect: (station: Station) => void;
}) {
  const [query, setQuery] = useState("");

  const listed = useMemo(() => {
    const named = resolvedStations.map((station) => ({
      station,
      km: origin ? distanceKm(origin, station) : null,
    }));

    const needle = query.trim().toLowerCase();
    const matched = needle
      ? named.filter(
          (entry) =>
            entry.station.name.toLowerCase().includes(needle) ||
            entry.station.context.toLowerCase().includes(needle),
        )
      : named;

    // Nearest-first is the useful order when we know where you are; otherwise
    // alphabetical, because a distance from nowhere is noise.
    return matched.sort((a, b) =>
      a.km != null && b.km != null ? a.km - b.km : a.station.name.localeCompare(b.station.name),
    );
  }, [query, origin]);

  return (
    <div className="stations">
      <div className="search">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search stations"
          aria-label="Search stations"
        />
      </div>

      <ol className="station-rows">
        {listed.map(({ station, km }) => (
          <li key={station.id}>
            <button
              className={station.id === selected.id ? "station current" : "station"}
              onClick={() => onSelect(station)}
              aria-current={station.id === selected.id ? "true" : undefined}
            >
              <span className="station-name">
                <span className="primary">{station.name}</span>
                {station.context && <span className="context">{station.context}</span>}
              </span>
              {km != null && <span className="km">{km < 10 ? km.toFixed(1) : Math.round(km)} km</span>}
            </button>
          </li>
        ))}
        {!listed.length && <li className="none">Nothing matches “{query}”.</li>}
      </ol>
    </div>
  );
}
