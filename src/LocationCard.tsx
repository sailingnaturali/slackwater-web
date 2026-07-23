import { StationCard } from "./StationCard";
import type { Match, TideState } from "./tides";
import type { Candidate } from "./place";
import type { Units } from "./units";

/**
 * CURRENT LOCATION — always present, in one of two states.
 *
 * Located: the matched station's card. The coordinates live in the group
 * eyebrow (StationList), and the match quality belongs to the detail header
 * where "not right?" is asked — not repeated here.
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
  starred,
  onSelect,
  onToggleStar,
}: {
  match: Match | null;
  station: Candidate | null;
  state: TideState | null;
  units: Units;
  selected: boolean;
  starred?: boolean;
  onSelect: () => void;
  onToggleStar?: () => void;
}) {
  // A CHS port has no synchronous prediction (`state` is null until its online
  // reading loads in the detail view), but it is still a located station — show
  // the card on identity alone rather than the "unavailable" fallback.
  if (match && station) {
    return (
      <StationCard
        station={station}
        state={state ?? undefined}
        units={units}
        selected={selected}
        starred={starred}
        onSelect={onSelect}
        onToggleStar={onToggleStar}
      />
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
