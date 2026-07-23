import { useEffect, useState } from "react";
import { StationCard } from "./StationCard";
import type { Match, TideState } from "./tides";
import type { Candidate } from "./place";
import type { Units } from "./units";

const PinOff = () => (
  <span className="pin-off" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  </span>
);

/**
 * CURRENT LOCATION — always present, in one of three states.
 *
 * Located: the matched station's card.
 *
 * Askable: we haven't been asked yet (a deep link bypasses the gate, so a
 * first-time deep-link visitor never saw the ask). The permission is still
 * "prompt", so offer the ask inline — no need to send anyone into settings.
 *
 * Blocked: the permission is "denied". Now settings really are the only path —
 * the web has no API to open its own (there is no `window.open("browser://…")`),
 * so a button pretending to would go nowhere. Say so instead.
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
  onRequestLocation,
}: {
  match: Match | null;
  station: Candidate | null;
  state: TideState | null;
  units: Units;
  selected: boolean;
  starred?: boolean;
  onSelect: () => void;
  onToggleStar?: () => void;
  /** Trigger the location ask inline (deep-link visitors never saw the gate). */
  onRequestLocation?: () => void;
}) {
  // Distinguish "never asked" from "actively blocked". The Permissions API is
  // the only way to know without firing a prompt; where it's unsupported
  // (older Safari) we stay "unknown" and offer the ask optimistically — the
  // worst case is a click that silently no-ops on an already-denied site.
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");
  useEffect(() => {
    if (!navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    navigator.permissions
      .query({ name: "geolocation" })
      .then((s) => {
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

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

  if (permission === "denied") {
    return (
      <div className="location-card unavailable">
        <PinOff />
        <p className="location-title">Location blocked</p>
        <p className="location-body">Turn on location for Slackwater to see stations near you</p>
        <p className="location-action">
          Allow location for this site from your browser's address-bar or site-settings menu, then
          reload — there is no in-page control that can open those settings for you.
        </p>
      </div>
    );
  }

  return (
    <div className="location-card askable">
      <PinOff />
      <p className="location-title">See stations near you</p>
      <p className="location-body">
        Slackwater opens on your nearest station. Your location stays on your device.
      </p>
      {onRequestLocation && (
        <button className="location-request" onClick={onRequestLocation}>
          Use my location
        </button>
      )}
    </div>
  );
}
