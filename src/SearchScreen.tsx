import { useMemo, useState } from "react";
import { predict, type ResolvedStation } from "./tides";
import type { Units } from "./units";
import { StationCard } from "./StationCard";
import { searchStations } from "./search";
import { POPULAR_SLUGS } from "./data/popular";

/**
 * Search, its own screen (spec: search does not belong inline in the
 * sidebar). This is also the escape hatch Task 4 left dangling — a user who
 * declines location has no starred/recent/nearby data, so this is the only
 * way to reach any of the other 40 stations.
 *
 * Empty query shows POPULAR, a curated shortlist rather than all 41
 * alphabetically — see data/popular.ts.
 */
export function Search({
  stations,
  units,
  now,
  selectedId,
  onSelect,
  onCancel,
}: {
  stations: ResolvedStation[];
  units: Units;
  now: Date;
  selectedId: string;
  onSelect: (station: ResolvedStation) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");

  const popular = useMemo(
    () =>
      POPULAR_SLUGS.map((slug) => stations.find((s) => s.slug === slug)).filter(
        (s): s is ResolvedStation => s != null,
      ),
    [stations],
  );

  const trimmed = query.trim();
  const results = trimmed ? searchStations(query, stations) : popular;

  return (
    <div className="search-screen">
      <div className="search-head">
        <h1>Search</h1>
        <button className="search-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <input
        className="search-input"
        type="search"
        inputMode="search"
        placeholder="Harbor, bay, or channel"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {!trimmed && <p className="eyebrow search-label">Popular</p>}

      {trimmed && results.length === 0 ? (
        <p className="search-empty">No stations match "{trimmed}".</p>
      ) : (
        <ol className="station-cards">
          {results.map((station) => (
            <li key={station.id}>
              <StationCard
                station={station}
                state={predict(station, now)}
                units={units}
                selected={station.id === selectedId}
                onSelect={() => onSelect(station)}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
