import type { TideState } from "./tides";
import type { Candidate } from "./place";
import { type CurrentState } from "./chs/current";
import {
  distanceUnit,
  formatDistance,
  formatHeight,
  formatSpeed,
  heightUnit,
  speedUnitLabel,
  type SpeedUnit,
  type Units,
} from "./units";

// A current turn labelled for the card's next-line, mirroring "High"/"Low" for
// tides. nextSlack is a slack by name, but the kind is typed wider — label it.
const TURN_LABEL: Record<"slack" | "max-flood" | "max-ebb", string> = {
  slack: "Slack",
  "max-flood": "Max flood",
  "max-ebb": "Max ebb",
};

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
  current,
  units,
  speedUnit = "kn",
  selected,
  starred,
  onSelect,
  onToggleStar,
}: {
  station: Candidate;
  km?: number;
  /** Absent for a CHS port shown before its online reading has loaded — the card then shows identity only. */
  state?: TideState;
  /** A current gate's reading. Mutually exclusive with `state`; when present the card renders the current layout. */
  current?: CurrentState;
  units: Units;
  speedUnit?: SpeedUnit;
  selected?: boolean;
  starred?: boolean;
  onSelect: () => void;
  onToggleStar?: () => void;
}) {
  const card = (
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
        {state?.next && (
          <p className="station-card-next">
            {state.next.high ? "High" : "Low"} {formatHeight(state.next.level, units)}{" "}
            {heightUnit(units)} · {cardTime(state.next.time, station.timezone)}
          </p>
        )}
        {current?.nextSlack && (
          <p className="station-card-next">
            {TURN_LABEL[current.nextSlack.kind]} · {cardTime(current.nextSlack.time, station.timezone)}
          </p>
        )}
      </div>
      {state && (
        <div className="station-card-reading">
          <span className="station-card-value">
            {formatHeight(state.level, units)}
            <abbr>{heightUnit(units)}</abbr>
          </span>
          <span className={state.rising ? "dir rising" : "dir falling"}>
            {state.rising ? "▲" : "▼"}
          </span>
        </div>
      )}
      {current &&
        // A derived gate has no speed, and slack has no direction — neither has
        // a number to show. A compact phase pill instead of a display-size word
        // that widens the reading column and wraps the station name beside it.
        (current.derived || current.phase === "slack" ? (
          <div className="station-card-reading">
            <span className={`phase-pill ${current.phase}`}>{current.phase}</span>
          </div>
        ) : (
          <div className="station-card-reading">
            <span className="station-card-value">
              {formatSpeed(current.speed, speedUnit)}
              <abbr>{speedUnitLabel(speedUnit)}</abbr>
            </span>
            <span className={current.phase === "flood" ? "dir rising" : "dir falling"}>
              {current.phase === "flood" ? "▲" : "▼"}
            </span>
          </div>
        ))}
    </button>
  );

  // No onToggleStar means "not starrable here" (none currently), so the plain
  // card is returned rather than wrapping every card in an extra div. A
  // nested <button> inside the select button would be invalid HTML, hence
  // the star toggle sits beside it rather than inside.
  if (!onToggleStar) return card;

  return (
    <div className="station-card-row">
      {card}
      <button
        className={starred ? "star-toggle starred" : "star-toggle"}
        onClick={onToggleStar}
        aria-pressed={starred ? "true" : "false"}
        aria-label={starred ? `Unstar ${station.name}` : `Star ${station.name}`}
      >
        {starred ? "★" : "☆"}
      </button>
    </div>
  );
}
