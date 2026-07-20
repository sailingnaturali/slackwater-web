import { useMemo, useState } from "react";
import { predictRange, type Station } from "./tides";

const DAY = 86_400_000;

/**
 * The schedule (spec §5a) — where "when" lives.
 *
 * Paging forward is free because the engine is deterministic: next weekend's
 * tides cost the same as today's and need no network. That is the difference
 * between this and every app that gates a date range behind a subscription.
 */
export function EventList({ station, now }: { station: Station; now: Date }) {
  const [dayOffset, setDayOffset] = useState(0);

  const day = useMemo(() => new Date(now.getTime() + dayOffset * DAY), [now, dayOffset]);
  const events = useMemo(() => predictRange(station, day, 1), [station, day]);

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
          return (
            <li key={event.time.toISOString()} className={past ? "event past" : "event"}>
              <span className={event.high ? "swatch high" : "swatch low"} aria-hidden="true" />
              <span className="kind">{event.high ? "High" : "Low"}</span>
              <time dateTime={event.time.toISOString()}>
                {event.time.toLocaleTimeString("en-CA", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                  timeZone: station.timezone,
                })}
              </time>
              <span className="height">{event.level.toFixed(2)}<abbr>m</abbr></span>
            </li>
          );
        })}
        {!events.length && <li className="event empty">No turns on this day.</li>}
      </ol>
    </section>
  );
}
