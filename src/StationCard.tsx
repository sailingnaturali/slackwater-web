import type { TideState } from "./tides";
import { isCurrentStation, type Candidate } from "./place";
import { type CurrentState } from "./chs/current";
import { CompassArrow } from "./CompassArrow";
import { StationGlyph, type Tone } from "./StationGlyph";
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
 * One station, everywhere it appears — the sidebar groups and search results.
 * Same card, so the two views can never drift.
 *
 * Layout A (spec §3): six facts in two columns of three. Identity left — name,
 * location, distance — because distance is station identity, not a reading, and
 * belongs with the location it qualifies. State right — value, phase, next
 * extreme. Scan left to find the station, right to read the water.
 *
 * The card used to carry a diagonal gradient, one fixed value on every card. It
 * encoded nothing but looked like it did, and the first outside reviewer duly
 * tried to decode it. Flat surface now; colour on this card means state.
 */
export function StationCard({
  station,
  km,
  state,
  current,
  units,
  speedUnit = "kn",
  selected,
  onSelect,
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
  onSelect: () => void;
}) {
  const tone: Tone = current
    ? (current.phase as Tone)
    : state
      ? (state.rising ? "rising" : "falling")
      : "unknown";

  const card = (
    <button
      className={selected ? "station-card current" : "station-card"}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      {/* Form from IDENTITY, tone from the reading. Kind used to be
          `current ? …` — a live reading, so a gate drew the tide dome until its
          fetch resolved, and every search result drew it forever (search passes
          no `current` at all). Tone stays reading-derived: `unknown` is the
          honest answer before anything has loaded. */}
      <StationGlyph kind={isCurrentStation(station) ? "current" : "tide"} tone={tone} />

      <div className="station-card-main">
        <p className="station-card-name">{station.name}</p>
        {station.context && <p className="station-card-context">{station.context}</p>}
        {km != null && (
          <p className="station-card-dist">
            {formatDistance(km, units)} {distanceUnit(units)}
          </p>
        )}
      </div>

      <div className="station-card-reading">
        {/* A gate's reading is its current — the tide rides along as the
            "High/Low · time" next-line below, not a second display-size number
            fighting the current for the same card. So the big tide level shows
            only for a pure tide station (no current); a gate with a companion
            tide skips it. */}
        {state && !current && (
          <>
            <span className="station-card-value">
              {formatHeight(state.level, units)}
              <abbr>{heightUnit(units)}</abbr>
            </span>
            <span className={state.rising ? "dir rising" : "dir falling"}>
              {state.rising ? "▲ Rising" : "▼ Falling"}
            </span>
          </>
        )}
        {current &&
          // A derived gate has no speed, and slack has no direction — neither has
          // a number to show. A compact phase pill instead of a display-size word
          // that widens the reading column and wraps the station name beside it.
          (current.derived || current.phase === "slack" ? (
            <span className={`phase-pill ${current.phase}`}>{current.phase}</span>
          ) : (
            <>
              <span className="station-card-value">
                {formatSpeed(current.speed, speedUnit)}
                <abbr>{speedUnitLabel(speedUnit)}</abbr>
              </span>
              <span className={`dir ${current.phase}`}>
                <CompassArrow deg={current.setDegrees} className={current.phase} />{" "}
                {current.phase === "flood" ? "Flood" : "Ebb"}
              </span>
            </>
          ))}
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
    </button>
  );

  // Starring lives in the detail view header now, not per list card — the list
  // just selects. So the plain card is returned, never wrapped with a toggle.
  return card;
}
