import { useMemo, useState } from "react";
import {
  dayEvents,
  dayEventsFromState,
  type DayEvent,
  type DayEventKind,
  type Station,
  type TideState,
} from "./tides";
import { isChs, type ChsStation } from "./chsStations";
import { formatHeight, heightUnit, type Units } from "./units";

const DAY = 86_400_000;

const PILLS: Record<DayEventKind, { label: string; className: string }> = {
  high: { label: "↑ High", className: "high" },
  low: { label: "↓ Low", className: "low" },
  sunrise: { label: "✳ Rise", className: "sun" },
  sunset: { label: "☾ Set", className: "sun" },
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
  units,
  state,
}: {
  // Full station for the bundled path (paging recomputes from constituents);
  // a CHS port carries no harmonics, so its `state` is passed in and the day's
  // turns are read off that instead.
  station: Station | ChsStation;
  now: Date;
  units: Units;
  /** Present only for a CHS port — the day's turns come from here, not `predictRange`. */
  state?: TideState;
}) {
  const [dayOffset, setDayOffset] = useState(0);

  const day = useMemo(() => new Date(now.getTime() + dayOffset * DAY), [now, dayOffset]);
  const events = useMemo(() => {
    if (isChs(station)) return state ? dayEventsFromState(state, station, day) : [];
    return dayEvents(station, day);
  }, [station, day, state]);
  const nearest = useMemo(() => nearestEvent(events, now), [events, now]);

  const dayLabel = day.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: station.timezone,
  });

  const relative =
    dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : dayOffset === -1 ? "Yesterday" : null;

  return (
    <section className="panel events">
      <header className="events-head">
        <div>
          <h2>{relative ?? "Schedule"}</h2>
          <p className="events-date">{dayLabel}</p>
        </div>
        <div className="pager">
          <button onClick={() => setDayOffset((d) => d - 1)} aria-label="Previous day">
            ‹
          </button>
          <button
            onClick={() => setDayOffset(0)}
            disabled={dayOffset === 0}
            className="today"
          >
            Today
          </button>
          <button onClick={() => setDayOffset((d) => d + 1)} aria-label="Next day">
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
