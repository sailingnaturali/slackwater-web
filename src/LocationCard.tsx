import { StationCard } from "./StationCard";
import type { Match, ResolvedStation, TideState } from "./tides";
import type { Units } from "./units";

export const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but a long way off",
};

function formatCoords(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(3)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lon}`;
}

/**
 * CURRENT LOCATION — always present, in one of two states.
 *
 * Located: the matched station's card, plus the coordinates that produced
 * the match and how much to trust it (the gradient-check quality from
 * `matchStation`).
 *
 * Unavailable: on iOS this deep-links into Settings. The web has no API to
 * open its own settings — there is no `window.open("browser://settings")` —
 * so a button pretending to do that would go nowhere. Saying so and
 * explaining the manual step is worse cosmetically but honest, which is the
 * point.
 */
export function LocationCard({
  match,
  station,
  state,
  units,
  selected,
  onSelect,
}: {
  match: Match | null;
  station: ResolvedStation | null;
  state: TideState | null;
  units: Units;
  selected: boolean;
  onSelect: () => void;
}) {
  if (match && station && state) {
    return (
      <div className="location-card">
        <StationCard
          station={station}
          state={state}
          units={units}
          selected={selected}
          onSelect={onSelect}
        />
        <p className="location-meta">
          <span className="mono">{formatCoords(station.latitude, station.longitude)}</span>
          {" · "}
          {QUALITY_COPY[match.quality]}
        </p>
      </div>
    );
  }

  return (
    <div className="location-card unavailable">
      <span className="pin-off" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12Z" />
          <circle cx="12" cy="9" r="2.4" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      </span>
      <p className="location-title">Location unavailable</p>
      <p className="location-body">Turn on location for Slackwater to see stations near you</p>
      <p className="location-action">
        Allow location for this site from your browser's address-bar or site-settings menu, then
        reload — there is no in-page control that can open those settings for you.
      </p>
    </div>
  );
}
