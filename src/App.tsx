import { useEffect, useMemo, useState } from "react";
import {
  extremesOn,
  matchStation,
  predict,
  stations,
  type Match,
  type Station,
  type TideState,
} from "./tides";
import { TideChart } from "./TideChart";

/** Friday Harbor: central, well-measured, and inside the bundled coverage. */
const DEFAULT_STATION =
  stations.find((s) => /friday harbor/i.test(s.name)) ?? stations[0];

const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but far off",
};

export function App() {
  const [station, setStation] = useState<Station>(DEFAULT_STATION);
  const [match, setMatch] = useState<Match | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [locating, setLocating] = useState(false);

  // The readout is a clock, not a snapshot.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const state: TideState = useMemo(() => predict(station, now), [station, now]);
  const today = useMemo(
    () => extremesOn(state, now, station.timezone),
    [state, now, station.timezone],
  );

  function locate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const found = matchStation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        if (found) {
          setStation(found.station);
          setMatch(found);
        }
        setLocating(false);
      },
      // Denied or unavailable is not an error state: the app already shows a
      // real station. Fall back silently rather than blocking behind a prompt.
      () => setLocating(false),
      { timeout: 8000, maximumAge: 300_000 },
    );
  }

  const time = (date: Date) =>
    date.toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: station.timezone,
    });

  const untilNext = state.next
    ? Math.round((state.next.time.getTime() - now.getTime()) / 60_000)
    : null;

  return (
    <main>
      <header>
        <h1>Slackwater</h1>
        <button onClick={locate} disabled={locating}>
          {locating ? "Locating…" : "Use my location"}
        </button>
      </header>

      <section className="hero">
        <div className="station">
          <select
            value={station.id}
            onChange={(event) => {
              const next = stations.find((s) => s.id === event.target.value);
              if (next) {
                setStation(next);
                setMatch(null);
              }
            }}
          >
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {match && (
            <p className={`match ${match.quality}`}>
              {match.distanceKm.toFixed(1)} km away · {QUALITY_COPY[match.quality]}
            </p>
          )}
        </div>

        <p className="state">
          <span className={state.rising ? "rising" : "falling"}>
            {state.rising ? "▲ Rising" : "▼ Falling"}
          </span>
          <strong>{state.level.toFixed(2)} m</strong>
          <span className="muted">now</span>
        </p>

        {state.next && untilNext !== null && (
          <p className="next">
            Next {state.next.high ? "high" : "low"} <strong>{state.next.level.toFixed(2)} m</strong>{" "}
            at {time(state.next.time)}{" "}
            <span className="muted">
              (in {Math.floor(untilNext / 60)}h {untilNext % 60}m)
            </span>
          </p>
        )}
      </section>

      <TideChart state={state} now={now} timezone={station.timezone} />

      <section className="table">
        <h2>Today</h2>
        {today.map((extreme) => (
          <div className="row" key={extreme.time.toISOString()}>
            <span className={extreme.high ? "tag high" : "tag low"}>
              {extreme.high ? "High" : "Low"}
            </span>
            <span className="when">{time(extreme.time)}</span>
            <span className="level">{extreme.level.toFixed(2)} m</span>
          </div>
        ))}
        <p className="muted datum">
          Heights above {station.chartDatum} · times in the station's local time
        </p>
      </section>

      <footer>
        <p>
          Astronomical tide prediction only — <strong>not for navigation</strong>.
        </p>
        <p className="muted">
          {stations.length} public-domain stations from{" "}
          <a href="https://github.com/openwatersio/tide-database">NOAA via tide-database</a>,
          computed on your device. Canadian stations are not bundled: their published
          harmonics carry a licence that does not permit redistribution, so BC water is
          coming from CHS online, marked as lower confidence.
        </p>
        <p className="muted">
          <a href="https://github.com/sailingnaturali/slackwater-web">Source</a> · GPL-3.0 ·{" "}
          <a href="https://sailingnaturali.com">Sailing Naturali</a>
        </p>
      </footer>
    </main>
  );
}
