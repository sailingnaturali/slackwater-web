import { useEffect, useMemo, useState } from "react";
import {
  matchStation,
  matchQuality,
  m2SpreadMinutes,
  distanceKm,
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
import { StationChooser } from "./StationChooser";
import { usePreferences } from "./usePreferences";
import { stationsNear } from "./place";
import { useLocation } from "./useLocation";
import { formatHeight, heightUnit, formatDistance, distanceUnit } from "./units";
import { parseUrl, buildUrl } from "./url";
import {
  loadSaved,
  star,
  unstar,
  visit,
  rememberLocation,
  NEARBY_ALL_LIMIT,
  type Saved,
} from "./savedStations";

/** Friday Harbor: central, well-measured, and inside the bundled coverage. */
const FALLBACK = stations.find((s) => /friday harbor/i.test(s.name)) ?? stations[0];

const SEEN_GATE = "slackwater.gate";

const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but a long way off",
};

export function App() {
  // Parsed once, at mount, from whatever URL the page loaded with — a shared
  // deep link. Later navigation goes through `history.replaceState` below,
  // not another read of `window.location`.
  const [urlMatch] = useState(() => parseUrl(window.location.pathname, resolvedStations));

  // Returning visitors skip the ask; the browser remembers the grant anyway.
  const [gated, setGated] = useState(() => !localStorage.getItem(SEEN_GATE));
  const [station, setStation] = useState<Station>(() => urlMatch?.station ?? FALLBACK);
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
  const [now, setNow] = useState(() => urlMatch?.t ?? new Date());
  const [listOpen, setListOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { units, setUnits } = usePreferences();

  // The readout is a clock, not a snapshot.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A former-slug or provider-id URL still resolves (`findStation` in
  // src/url.ts) but isn't the link anyone should keep sharing — swap it for
  // the canonical slug without adding a history entry.
  useEffect(() => {
    if (urlMatch && !urlMatch.canonical) {
      history.replaceState(null, "", buildUrl(urlMatch.station, urlMatch.t));
    }
    // urlMatch is fixed at mount (see its useState above); this only ever
    // needs to run once.
  }, []);

  // Disabled until the gate resolves: the first-ever ask belongs to
  // LocationGate's explain-first screen, not a silent prompt fired the
  // moment this hook mounts. After that, this is what notices a user who
  // closed the app in Victoria and opened it again in Seattle.
  const live = useLocation(!gated);

  useEffect(() => {
    if (live.unavailable) {
      // Revoked between visits: a stale seeded card is worse than none.
      setLocated(null);
      setOrigin(null);
      return;
    }
    if (!live.position || !live.place) return;
    setOrigin(live.position);
    if (located?.station.slug === live.place.station.slug) return;
    const graded = matchStation(live.position);
    const found: Match = {
      station: live.place.station,
      distanceKm: distanceKm(live.position, live.place.station),
      quality: graded?.quality ?? "nearest",
    };
    setStation(live.place.station);
    setMatch(found);
    setLocated({ station: live.place.station, match: found });
    setSaved(rememberLocation(live.place.station.slug));
    // `located` isn't a dep: it's this effect's own output, and listing it
    // would just re-run the effect (harmlessly, since the slug check above
    // no-ops) every time it fires.
  }, [live.position, live.place, live.unavailable]);

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

  /**
   * The hero's distance and quality must describe the same thing the chooser
   * below it describes. Both ground on the named place: grading against raw
   * GPS while ranking against the place put two different numbers for one
   * station side by side on the same screen.
   */
  const heroMatch = useMemo(() => {
    if (live.place) {
      const { place, station: matched } = live.place;
      const neighbours = stationsNear(place, 3);
      return {
        km: distanceKm(place, matched),
        quality: matchQuality(distanceKm(place, matched), m2SpreadMinutes(neighbours)),
      };
    }
    return match ? { km: match.distanceKm, quality: match.quality } : null;
  }, [live.place, match]);
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

  // A shared link skips the explain-first screen, first visit or not — the
  // whole point of a deep link is that it opens the station it names, not a
  // gate standing in front of it. `gated` itself stays true underneath (not
  // shown, but not resolved either), so `useLocation(!gated)` — disabled
  // until the gate resolves — still never fires a silent permission prompt.
  if (gated && !urlMatch) return <LocationGate onResolve={resolveGate} />;

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
    // A deliberate pick is "now" for that station — no moment to carry yet
    // (the readout line, which will, is Task 7).
    history.replaceState(null, "", buildUrl(next, null));
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
            {heroMatch && (
              <p className={`match ${heroMatch.quality}`}>
                {formatDistance(heroMatch.km, units)} {distanceUnit(units)} away ·{" "}
                {QUALITY_COPY[heroMatch.quality]}
              </p>
            )}
            {match && live.place && (
              <StationChooser
                place={live.place.place}
                current={live.place.station}
                alternatives={live.place.alternatives}
                units={units}
                onChoose={(next) => {
                  setStation(next);
                  history.replaceState(null, "", buildUrl(next, null));
                }}
              />
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
