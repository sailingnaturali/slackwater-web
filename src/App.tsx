import { useEffect, useMemo, useState } from "react";
import {
  matchStation,
  predict,
  resolvedStations,
  stations,
  type Match,
  type ResolvedStation,
  type Station,
} from "./tides";
import { TideChart } from "./TideChart";
import { EventList } from "./EventList";
import { StationList, type LocatedStation } from "./StationList";
import { nearestStations } from "./nearby";
import { LocationGate, type GateResult } from "./LocationGate";
import { Search } from "./SearchScreen";
import { Settings } from "./Settings";
import { usePreferences } from "./usePreferences";
import { formatHeight, heightUnit, formatDistance, distanceUnit } from "./units";
import { loadSaved, star, unstar, visit, rememberLocation, type Saved } from "./savedStations";

// NEARBY's "All" shows at most 20 (spec §4) — beyond that it stops being
// nearby and becomes the full list, which is what Search (a later task) is
// for. Capped here so StationList never has to know the number came from
// somewhere else.
const NEARBY_ALL_LIMIT = 20;

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
  const [saved, setSaved] = useState<Saved>(loadSaved);
  // Separate from `match`: CURRENT LOCATION keeps showing where you are even
  // after you pick a different station to look at, so it survives `choose()`
  // resetting `match` (which only hedges the hero's currently-viewed badge).
  //
  // A returning visitor never re-asks for geolocation (SEEN_GATE skips the
  // gate outright), so without this the card would sit empty every load
  // after the first. Seeding it from the persisted last-known station keeps
  // it populated; a live match from `resolveGate` overwrites it below.
  const [located, setLocated] = useState<LocatedStation | null>(() => {
    const slug = saved.lastLocationSlug;
    const resolved = slug ? resolvedStations.find((s) => s.slug === slug) : undefined;
    const match = resolved ? matchStation(resolved) : null;
    return resolved && match ? { station: resolved, match } : null;
  });
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [listOpen, setListOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
        const resolved = resolvedStations.find((s) => s.id === found.station.id);
        if (resolved) {
          setLocated({ station: resolved, match: found });
          setSaved(rememberLocation(resolved.slug));
        }
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

  // Saved state stores slugs, not stations — looked up here so a renamed or
  // removed station can never leave a stale object sitting in the list.
  const bySlug = (slug: string) => resolvedStations.find((s) => s.slug === slug);
  const starredStations = useMemo(
    () => saved.starred.map(bySlug).filter((s): s is ResolvedStation => s != null),
    [saved.starred],
  );
  const recentStations = useMemo(
    () => saved.recent.map(bySlug).filter((s): s is ResolvedStation => s != null),
    [saved.recent],
  );

  if (gated) return <LocationGate onResolve={resolveGate} />;

  if (searchOpen) {
    return (
      <Search
        stations={resolvedStations}
        units={units}
        now={now}
        selectedId={station.id}
        onSelect={(next) => {
          choose(next);
          setSearchOpen(false);
        }}
        onCancel={() => setSearchOpen(false)}
      />
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

  function choose(next: ResolvedStation) {
    setStation(next);
    // The badge describes how well an automatic snap fits. A deliberate pick
    // needs no hedging — the user said which station they meant.
    setMatch(null);
    setListOpen(false);
    setSaved(visit(next.slug));
  }

  function toggleStar(target: ResolvedStation) {
    setSaved(saved.starred.includes(target.slug) ? unstar(target.slug) : star(target.slug));
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
        <button className="search-entry" onClick={() => setSearchOpen(true)}>
          <span aria-hidden="true">⌕</span> Search stations
        </button>
        <StationList
          located={located}
          starred={starredStations}
          recent={recentStations}
          nearby={origin ? nearestStations(origin, resolvedStations, NEARBY_ALL_LIMIT) : []}
          origin={origin}
          selectedId={station.id}
          units={units}
          now={now}
          onSelect={choose}
          onToggleStar={toggleStar}
        />
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
                {formatDistance(match.distanceKm, units)} {distanceUnit(units)} away ·{" "}
                {QUALITY_COPY[match.quality]}
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
          <TideChart state={state} now={now} timezone={station.timezone} units={units} />
        </section>

        <EventList station={station} now={now} units={units} />

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
