import { useEffect, useMemo, useState } from "react";
import { matchStation, predict, resolvedStations, stations, type Match, type Station } from "./tides";
import { TideChart } from "./TideChart";
import { EventList } from "./EventList";
import { StationList } from "./StationList";
import { LocationGate, type GateResult } from "./LocationGate";
import { Settings } from "./Settings";
import { usePreferences } from "./usePreferences";
import { formatHeight, heightUnit } from "./units";

/** Friday Harbor: central, well-measured, and inside the bundled coverage. */
const FALLBACK = stations.find((s) => /friday harbor/i.test(s.name)) ?? stations[0];

const SEEN_GATE = "slackwater.gate";

const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but a long way off",
};

export function App() {
  // Returning visitors skip the ask; the browser remembers the grant anyway.
  const [gated, setGated] = useState(() => !localStorage.getItem(SEEN_GATE));
  const [station, setStation] = useState<Station>(FALLBACK);
  const [match, setMatch] = useState<Match | null>(null);
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { units, setUnits } = usePreferences();

  // The readout is a clock, not a snapshot.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function resolveGate(result: GateResult) {
    localStorage.setItem(SEEN_GATE, "1");
    if (result.kind === "located") {
      setOrigin(result);
      const found = matchStation(result);
      if (found) {
        setStation(found.station);
        setMatch(found);
      }
    } else {
      // Declined: the list is the answer, not an empty screen.
      setListOpen(true);
    }
    setGated(false);
  }

  const state = useMemo(() => predict(station, now), [station, now]);
  const resolved = useMemo(
    () => resolvedStations.find((s) => s.id === station.id)!,
    [station],
  );

  if (gated) return <LocationGate onResolve={resolveGate} />;

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

  function choose(next: Station) {
    setStation(next);
    // The badge describes how well an automatic snap fits. A deliberate pick
    // needs no hedging — the user said which station they meant.
    setMatch(null);
    setListOpen(false);
  }

  return (
    <div className="shell">
      <aside className={listOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-head">
          <p className="eyebrow">Slackwater</p>
          <button className="close" onClick={() => setListOpen(false)} aria-label="Close list">
            ✕
          </button>
        </div>
        <StationList selected={station} origin={origin} units={units} onSelect={choose} />
        <div className="sidebar-foot">
          <button className="settings-entry" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </aside>

      <Settings
        open={settingsOpen}
        units={units}
        onUnitsChange={setUnits}
        onClose={() => setSettingsOpen(false)}
      />

      {listOpen && <div className="scrim" onClick={() => setListOpen(false)} />}

      <main className="content">
        <header className="topbar">
          <button className="picker" onClick={() => setListOpen(true)}>
            <span className="eyebrow">Station</span>
            <span className="picker-name">{resolved.name}</span>
            <span className="picker-caret">▾</span>
          </button>
        </header>

        <section className="panel hero rise">
          <div className="place">
            <h1>{resolved.name}</h1>
            {resolved.context && <p className="context">{resolved.context}</p>}
            {match && (
              <p className={`match ${match.quality}`}>
                {match.distanceKm.toFixed(1)} km away · {QUALITY_COPY[match.quality]}
              </p>
            )}
          </div>

          <p className="reading">
            <span className={state.rising ? "dir rising" : "dir falling"}>
              {state.rising ? "▲ Rising" : "▼ Falling"}
            </span>
            <span className="value">
              {formatHeight(state.level, units)}
              <abbr>{heightUnit(units)}</abbr>
            </span>
          </p>

          {state.next && untilNext !== null && (
            <p className="next">
              Next {state.next.high ? "high" : "low"} of{" "}
              <strong>
                {formatHeight(state.next.level, units)} {heightUnit(units)}
              </strong>{" "}
              at {time(state.next.time)}
              <span className="muted">
                {" "}
                · in {Math.floor(untilNext / 60)}h {untilNext % 60}m
              </span>
            </p>
          )}
        </section>

        <section className="panel chart-panel">
          <TideChart state={state} now={now} timezone={station.timezone} />
        </section>

        <EventList station={station} now={now} />

        <footer>
          <p className="warn">
            Astronomical prediction only — <strong>not for navigation</strong>.
          </p>
          <p className="muted">
            Heights above {station.chartDatum}, times local to the station. {stations.length}{" "}
            public-domain stations from{" "}
            <a href="https://github.com/openwatersio/tide-database">NOAA via tide-database</a>,
            computed on your device. Canadian stations are not bundled — their published
            harmonics carry a licence that does not permit redistribution, so BC water is
            coming from CHS online at lower confidence.
          </p>
          <p className="muted">
            <a href="https://github.com/sailingnaturali/slackwater-web">Source</a> · GPL-3.0 ·{" "}
            <a href="https://sailingnaturali.com">Sailing Naturali</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
