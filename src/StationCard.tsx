import type { ResolvedStation, TideState } from "./tides";
import { distanceUnit, formatDistance, formatHeight, heightUnit, type Units } from "./units";

// en-US, not the app's usual en-CA: the card wants "1:42 PM", and en-CA's
// hour12 format renders "1:42 p.m." instead.
function cardTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  });
}

/**
 * One station, everywhere it appears — the sidebar groups today, search
 * results once Task 5 lands. Same card, so the two views can never drift.
 *
 * The gradient below is one fixed value for every card, deliberately. The
 * prototype tints each card differently but never defines what a tint means
 * (height? range? rising vs falling?) — inventing a semantic here would be
 * worse than plain texture, because a user would read meaning into a colour
 * that carries none. Revisit once there is an actual signal worth encoding.
 */
export function StationCard({
  station,
  km,
  state,
  units,
  selected,
  onSelect,
}: {
  station: ResolvedStation;
  km?: number;
  state: TideState;
  units: Units;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={selected ? "station-card current" : "station-card"}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <div className="station-card-main">
        <p className="station-card-title">
          <span className="station-card-name">{station.name}</span>
          {km != null && (
            <span className="pill">
              {formatDistance(km, units)} {distanceUnit(units)}
            </span>
          )}
        </p>
        {station.context && <p className="station-card-context">{station.context}</p>}
        {state.next && (
          <p className="station-card-next">
            {state.next.high ? "High" : "Low"} {formatHeight(state.next.level, units)}{" "}
            {heightUnit(units)} · {cardTime(state.next.time, station.timezone)}
          </p>
        )}
      </div>
      <div className="station-card-reading">
        <span className="station-card-value">
          {formatHeight(state.level, units)}
          <abbr>{heightUnit(units)}</abbr>
        </span>
        <span className={state.rising ? "dir rising" : "dir falling"}>
          {state.rising ? "▲" : "▼"}
        </span>
      </div>
    </button>
  );
}
