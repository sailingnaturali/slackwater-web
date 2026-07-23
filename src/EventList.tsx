import { useMemo } from "react";
import {
  currentDayEventsFromState,
  dayEvents,
  dayEventsFromState,
  type DayEvent,
  type DayEventKind,
  type Station,
  type TideState,
} from "./tides";
import { isChs, isChsCurrent, type ChsStation } from "./chsStations";
import type { CurrentState } from "./chs/current";
import { formatHeight, formatSpeed, heightUnit, speedUnitLabel, type SpeedUnit, type Units } from "./units";

const DAY = 86_400_000;

/** Calendar days between `a` and `b` in `tz` — DST-safe: both sides are date-only midnights. */
function dayDiff(a: Date, b: Date, tz: string): number {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  return Math.round((Date.parse(day(a)) - Date.parse(day(b))) / DAY);
}

const PILLS: Record<DayEventKind, { label: string; className: string }> = {
  high: { label: "↑ High", className: "high" },
  low: { label: "↓ Low", className: "low" },
  sunrise: { label: "✳ Rise", className: "sun" },
  sunset: { label: "☾ Set", className: "sun" },
  slack: { label: "● Slack", className: "slack" },
  "max-flood": { label: "▲ Flood", className: "flood" },
  "max-ebb": { label: "▼ Ebb", className: "ebb" },
};

/** The event whose time sits closest to `t` — the row the scrub line is on. */
function nearestEvent(events: DayEvent[], t: Date): DayEvent | null {
  if (!events.length) return null;
  return events.reduce((closest, event) =>
    Math.abs(event.time.getTime() - t.getTime()) < Math.abs(closest.time.getTime() - t.getTime())
      ? event
      : closest,
  );
}

/**
 * The schedule (spec §5a) — where "when" lives.
 *
 * Paging forward is free because the engine is deterministic: next weekend's
 * tides cost the same as today's and need no network. That is the difference
 * between this and every app that gates a date range behind a subscription.
 */
export function EventList({
  station,
  now,
  today,
  units,
  state,
  currentState,
  speedUnit,
  onPageDay,
  onToday,
}: {
  // Full station for the bundled path (paging recomputes from constituents);
  // a CHS port carries no harmonics, so its `state` is passed in and the day's
  // turns are read off that instead.
  station: Station | ChsStation;
  // The shared scrub instant: the day the chart and hero are on. Paging moves
  // it (via onPageDay) rather than tracking a private offset, so this list and
  // the scrubber viz can never drift onto different days.
  now: Date;
  /** The live clock, for the Today/Tomorrow/Yesterday label — `now` may be scrubbed away from it. */
  today: Date;
  units: Units;
  /** Present only for a CHS port — the day's turns come from here, not `predictRange`. */
  state?: TideState;
  /** Present only for a CHS current gate — the day's slacks/peaks come from here. */
  currentState?: CurrentState;
  speedUnit?: SpeedUnit;
  /** Shift the shared instant by whole days (paging the schedule). */
  onPageDay: (delta: number) => void;
  /** Snap the shared instant back to the live clock. */
  onToday: () => void;
}) {
  const day = now;
  const offset = dayDiff(now, today, station.timezone);
  const events = useMemo(() => {
    if (isChsCurrent(station)) return currentState ? currentDayEventsFromState(currentState, station, day) : [];
    if (isChs(station)) return state ? dayEventsFromState(state, station, day) : [];
    return dayEvents(station, day);
  }, [station, day, state, currentState]);
  const nearest = useMemo(() => nearestEvent(events, now), [events, now]);

  const dayLabel = day.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: station.timezone,
  });

  const relative =
    offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday" : null;

  return (
    <section className="panel events">
      <header className="events-head">
        <div>
          <h2>{relative ?? "Schedule"}</h2>
          <p className="events-date">{dayLabel}</p>
        </div>
        <div className="pager">
          <button onClick={() => onPageDay(-1)} aria-label="Previous day">
            ‹
          </button>
          <button onClick={onToday} disabled={offset === 0} className="today">
            Today
          </button>
          <button onClick={() => onPageDay(1)} aria-label="Next day">
            ›
          </button>
        </div>
      </header>

      <ol className="event-rows">
        {events.map((event) => {
          const past = event.time < now;
          const pill = PILLS[event.kind];
          const classes = ["event"];
          if (past) classes.push("past");
          if (event === nearest) classes.push("nearest");
          return (
            <li key={event.time.toISOString() + event.kind} className={classes.join(" ")}>
              <span className={`pill ${pill.className}`}>{pill.label}</span>
              <time dateTime={event.time.toISOString()}>
                {event.time.toLocaleTimeString("en-CA", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: station.timezone,
                })}
              </time>
              <span className="height">
                {event.level != null ? (
                  <>
                    {formatHeight(event.level, units)}
                    <abbr>{heightUnit(units)}</abbr>
                  </>
                ) : event.speed != null ? (
                  <>
                    {formatSpeed(event.speed, speedUnit ?? "kn")}
                    <abbr>{speedUnitLabel(speedUnit ?? "kn")}</abbr>
                  </>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </span>
            </li>
          );
        })}
        {!events.length && <li className="event empty">Nothing on this day.</li>}
      </ol>
    </section>
  );
}
