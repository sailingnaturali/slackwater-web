import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  matchStation,
  matchQuality,
  m2SpreadMinutes,
  distanceKm,
  predict,
  resolvedStations,
  stations,
  type Match,
  type Station,
  type TideState,
} from "./tides";
import { TideChart } from "./TideChart";
import { EventList } from "./EventList";
import { StationList, type LocatedStation } from "./StationList";
import { nearestStations } from "./nearby";
import { LocationGate, type GateResult } from "./LocationGate";
import { Search } from "./SearchScreen";
import { Settings } from "./Settings";
import { useOfflineSync } from "./useOfflineSync";
import { OfflineStatus } from "./OfflineStatus";
import { OfflineManager } from "./OfflineManager";
import { StationChooser } from "./StationChooser";
import { usePreferences } from "./usePreferences";
import { stationsNear, candidates, locateStation, type Candidate } from "./place";
import { isChs, isChsCurrent, companionOf, type ChsStation } from "./chsStations";
import { useChsTide } from "./useChsTide";
import { useChsCurrent } from "./useChsCurrent";
import { withNow } from "./chs/tide";
import { withNowCurrent, compass16, currentPhaseWord, type CurrentState } from "./chs/current";
import { CurrentChart } from "./CurrentChart";
import { useLocation } from "./useLocation";
import {
  formatHeight,
  heightUnit,
  formatDistance,
  distanceUnit,
  formatSpeed,
  speedUnitLabel,
} from "./units";
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

// Lazy: keeps MapLibre (and its WASM/tile machinery) out of the entry chunk —
// most visits never open the map.
const MapScreen = lazy(() => import("./MapScreen"));

const SEEN_GATE = "slackwater.gate";

const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but a long way off",
};

type Held<T> = { state: T; now: Date; stationId: string };

/**
 * Keep the last good (state, now) pair on screen while a newly-paged CHS day
 * loads, so paging holds the previous day instead of blanking the whole view to
 * "Loading" for the fetch. The hold is dropped when the fetch fails (fall through
 * to the offline copy) or the station changes (a real reload, not a page). NOAA
 * is synchronous — `state` is never null — so this just passes it through.
 */
export function heldWhileLoading<T>(
  ref: { current: Held<T> | null },
  state: T | null,
  now: Date,
  stationId: string,
  loading: boolean,
): { state: T; now: Date } | null {
  if (state) {
    ref.current = { state, now, stationId };
    return { state, now };
  }
  if (loading && ref.current?.stationId === stationId) return ref.current;
  return null;
}

export function App() {
  // Parsed once, at mount, from whatever URL the page loaded with — a shared
  // deep link. Later navigation goes through `history.replaceState` below,
  // not another read of `window.location`.
  const [urlMatch] = useState(() => parseUrl(window.location.pathname, candidates));

  // Returning visitors skip the ask; the browser remembers the grant anyway.
  const [gated, setGated] = useState(() => !localStorage.getItem(SEEN_GATE));
  // Either a bundled NOAA station or a CHS port — the viewed station drives the
  // whole detail view, and CHS ports are named stations too (spec §7).
  const [station, setStation] = useState<Station | ChsStation>(() => urlMatch?.station ?? FALLBACK);
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
  // `t` is the shared scrub instant (§ Task 7): null until the readout line is
  // released somewhere, and from a deep link before that. `liveNow` is the
  // ticking clock underneath - every pane reads `t ?? liveNow`, never `t` or
  // `liveNow` alone, so a scrub sticks exactly where it landed instead of
  // being overwritten by the next tick.
  const [t, setT] = useState<Date | null>(() => urlMatch?.t ?? null);
  const [liveNow, setLiveNow] = useState(() => new Date());
  const now = t ?? liveNow;
  const [listOpen, setListOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // A cold load of /map (sidebar "Map" button, or a shared link) should open
  // straight into the map, same deal as urlMatch below for a station link.
  const [mapOpen, setMapOpen] = useState(() => window.location.pathname === "/map");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const offline = useOfflineSync(origin);
  const { units, setUnits, speedUnit, setSpeedUnit } = usePreferences();

  // The readout is a clock, not a snapshot - but only while nothing has
  // pinned it (see `t` above).
  useEffect(() => {
    const timer = setInterval(() => setLiveNow(new Date()), 30_000);
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
    const found = locateStation(live.position);
    if (!found || located?.station.slug === found.station.slug) return;
    setStation(found.station);
    setMatch(found);
    setLocated({ station: found.station, match: found });
    setSaved(rememberLocation(found.station.slug));
    // `located` isn't a dep: it's this effect's own output, and listing it
    // would just re-run the effect (harmlessly, since the slug check above
    // no-ops) every time it fires.
  }, [live.position, live.place, live.unavailable]);

  function resolveGate(result: GateResult) {
    localStorage.setItem(SEEN_GATE, "1");
    if (result.kind === "located") {
      setOrigin(result);
      const found = locateStation(result);
      if (found) {
        setStation(found.station);
        setMatch(found);
        setLocated({ station: found.station, match: found });
        setSaved(rememberLocation(found.station.slug));
      }
    } else {
      // Declined: the list is the answer, not an empty screen.
      setListOpen(true);
    }
    setGated(false);
  }

  // Two engines, one shape. A bundled station predicts synchronously from its
  // constituents; a CHS port has none, so its identical `TideState` arrives
  // from the online adapter via `useChsTide`. The hook is called every render
  // (rules of hooks) but handed `null` — and left idle — while a NOAA station
  // is in view. Once a `TideState` exists, everything below is provenance-blind.
  // A third arm alongside the tide one: a current gate has no level, only a
  // signed velocity. Hoisted above the tide hook so a gate's companion tide
  // port (companionOf) can ride the otherwise-idle useChsTide call below.
  const currentGate = isChsCurrent(station) ? station : null;
  const companion = currentGate ? companionOf(currentGate) : null;
  // Two engines, one shape (see useChsTide): a bundled station predicts
  // synchronously; a CHS port fetches. When a gate is viewed this hook — which
  // would otherwise sit idle — fetches the gate's companion tide port instead.
  const chsStation = isChs(station) && !isChsCurrent(station) ? station : companion;
  const chs = useChsTide(chsStation, now);
  const noaaState = useMemo(
    () => (isChs(station) ? null : predict(station, now)),
    [station, now],
  );
  // The hook's `state` carries the fetched day's extremes/timeline (day-based,
  // correct) but its now-relative fields (level/rising/next) are frozen at fetch
  // time. Re-anchor them to the ticking `now` so the CHS hero tracks the clock
  // like NOAA — without this, `next` counts into a negative "in -1h" once passed.
  const chsState = useMemo(
    () => (chs.state ? withNow(chs.state, now) : null),
    [chs.state, now],
  );
  const state = chsStation ? chsState : noaaState;
  // NOAA is always "ready" (synchronous); CHS carries loading/offline through.
  const status = chsStation ? chs.status : "ready";

  // Same rules-of-hooks discipline — called every render, idle (`null`)
  // unless the viewed station is a gate.
  const chsCur = useChsCurrent(currentGate, now);
  const currentState = useMemo(
    () => (chsCur.state ? withNowCurrent(chsCur.state, now) : null),
    [chsCur.state, now],
  );

  // Paging a CHS day refetches; without a hold the whole view blanks to
  // "Loading" for the fetch. These keep the previous day on screen until the new
  // one lands (see heldWhileLoading). NOAA passes straight through.
  const tideHold = useRef<Held<TideState> | null>(null);
  const curHold = useRef<Held<CurrentState> | null>(null);
  const tideView = heldWhileLoading(tideHold, state, now, station.id, status === "loading");
  const curView = heldWhileLoading(curHold, currentState, now, station.id, chsCur.status === "loading");

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
  // The display identity for the viewed station: a CHS port already carries its
  // own name/context/position; a bundled station maps to its resolved record.
  // The `!` is sound — every NOAA station has a 1:1 resolved entry.
  const resolved: Candidate = useMemo(
    () => (isChs(station) ? station : resolvedStations.find((s) => s.id === station.id)!),
    [station],
  );

  // Saved state stores slugs, not stations — looked up here so a renamed or
  // removed station can never leave a stale object sitting in the list.
  // Resolve against the full pool (NOAA + CHS), not resolvedStations alone —
  // otherwise a starred/visited CHS port (e.g. chs-victoria) is filtered out of
  // Starred/Recent and its star never fills.
  const bySlug = (slug: string) => candidates.find((s) => s.slug === slug);
  const starredStations = useMemo(
    () => saved.starred.map(bySlug).filter((s): s is Candidate => s != null),
    [saved.starred],
  );
  const recentStations = useMemo(
    () => saved.recent.map(bySlug).filter((s): s is Candidate => s != null),
    [saved.recent],
  );

  // A shared link skips the explain-first screen, first visit or not — the
  // whole point of a deep link is that it opens the station (or the map) it
  // names, not a gate standing in front of it. `gated` itself stays true
  // underneath (not shown, but not resolved either), so `useLocation(!gated)`
  // — disabled until the gate resolves — still never fires a silent
  // permission prompt.
  if (gated && !urlMatch && !mapOpen) return <LocationGate onResolve={resolveGate} />;

  if (mapOpen) {
    return (
      <Suspense fallback={<div className="map-loading muted">Loading map…</div>}>
        <MapScreen
          stations={candidates}
          units={units}
          selectedId={station.id}
          onSelect={(next) => {
            choose(next); // choose() already replaces the URL with the station's
            setMapOpen(false);
          }}
          onClose={() => {
            // Spec §1: Back returns to the list, not the station detail view
            // the map happened to be opened from.
            setMapOpen(false);
            setListOpen(true);
            history.replaceState(null, "", buildUrl(resolved, t));
          }}
        />
      </Suspense>
    );
  }

  if (searchOpen) {
    return (
      <Search
        stations={candidates}
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

  // The tide/current view holds the previous day while a paged-to day loads, so
  // its readings are relative to the instant that view is *for* (tideView.now),
  // which lags the live `now` for the duration of the fetch.
  const untilNext = tideView?.state.next
    ? Math.round((tideView.state.next.time.getTime() - tideView.now.getTime()) / 60_000)
    : null;
  const untilSlack = curView?.state.nextSlack
    ? Math.round((curView.state.nextSlack.time.getTime() - curView.now.getTime()) / 60_000)
    : null;

  function choose(next: Candidate) {
    setStation(next);
    // The badge describes how well an automatic snap fits. A deliberate pick
    // needs no hedging — the user said which station they meant.
    setMatch(null);
    setListOpen(false);
    setSaved(visit(next.slug));
    // A deliberate pick is "now" for that station — any scrub held against
    // the previous one doesn't carry across.
    setT(null);
    history.replaceState(null, "", buildUrl(next, null));
  }

  // Fired once, on release, by the chart's readout line (already snapped
  // onto a nearby turn) — writes the URL here rather than per pixel, so
  // dragging doesn't hammer history with a replaceState per frame.
  function scrub(next: Date) {
    setT(next);
    history.replaceState(null, "", buildUrl(resolved, next));
  }

  // Paging the schedule moves the one shared instant the chart and hero already
  // read, so the list can never drift onto a different day than the scrubber.
  const DAY = 86_400_000;
  const pageDay = (delta: number) => scrub(new Date(now.getTime() + delta * DAY));
  function backToToday() {
    setT(null);
    history.replaceState(null, "", buildUrl(resolved, null));
  }

  function toggleStar(target: Candidate) {
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
        <button
          className="search-entry"
          onClick={() => {
            setMapOpen(true);
            setListOpen(false);
            history.replaceState(null, "", "/map");
          }}
        >
          <span aria-hidden="true">◍</span> Map
        </button>
        <StationList
          located={located}
          starred={starredStations}
          recent={recentStations}
          nearby={origin ? nearestStations(origin, candidates, NEARBY_ALL_LIMIT) : []}
          origin={origin}
          selectedId={station.id}
          units={units}
          speedUnit={speedUnit}
          now={now}
          onSelect={choose}
          // A deep link bypasses the gate, so useLocation stays disabled and the
          // ask never fires. Resolving the gate here turns it on — its first fix
          // is the browser prompt this visitor never got.
          onRequestLocation={() => {
            localStorage.setItem(SEEN_GATE, "1");
            setGated(false);
          }}
        />
        <div className="sidebar-foot">
          <button className="settings-entry" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <OfflineStatus view={offline} onOpen={() => setOfflineOpen(true)} />
        </div>
      </aside>

      <Settings
        open={settingsOpen}
        units={units}
        onUnitsChange={setUnits}
        speedUnit={speedUnit}
        onSpeedUnitChange={setSpeedUnit}
        onClose={() => setSettingsOpen(false)}
      />
      <OfflineManager open={offlineOpen} view={offline} onClose={() => setOfflineOpen(false)} />

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
            <button
              className={saved.starred.includes(resolved.slug) ? "place-star starred" : "place-star"}
              onClick={() => toggleStar(resolved)}
              aria-pressed={saved.starred.includes(resolved.slug)}
              aria-label={
                saved.starred.includes(resolved.slug) ? `Unstar ${resolved.name}` : `Star ${resolved.name}`
              }
            >
              {saved.starred.includes(resolved.slug) ? "★" : "☆"}
            </button>
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
                  setT(null);
                  history.replaceState(null, "", buildUrl(next, null));
                }}
              />
            )}
          </div>

          {/* Provenance-blind once `state` exists. A CHS port with no reading
              yet shows an honest line, never an empty chart or a dead spinner
              (spec §7c). A gate is the same discipline, third arm: never an
              empty chart, just the honest chs-signal/chs-loading copy. */}
          {currentGate ? (
            curView ? (
              <>
                <p className="reading current">
                  <span className={`dir ${curView.state.phase}`}>
                    {curView.state.phase === "slack"
                      ? "Slack"
                      : curView.state.derived
                        ? currentPhaseWord(curView.state.phase)
                        : `${currentPhaseWord(curView.state.phase)} toward ${compass16(curView.state.setDegrees)}`}
                  </span>
                  {/* A derived gate has no CHS-predicted speed — never show a number. */}
                  {!curView.state.derived && (
                    <span className="value">
                      {formatSpeed(curView.state.speed, speedUnit)}
                      <abbr>{speedUnitLabel(speedUnit)}</abbr>
                    </span>
                  )}
                </p>

                {curView.state.nextSlack && untilSlack !== null && (
                  <p className="next">
                    Next slack at {time(curView.state.nextSlack.time)}
                    <strong>
                      {" "}
                      · in {Math.floor(untilSlack / 60)}h {untilSlack % 60}m
                    </strong>
                    {curView.state.following && (
                      <span className="muted">
                        {" "}
                        · then {curView.state.following.kind === "max-flood" ? "Flood" : "Ebb"}{" "}
                        {/* peaks always carry a speed; derived gates have no `following` */}
                        {formatSpeed(curView.state.following.speed!, speedUnit)}{" "}
                        {speedUnitLabel(speedUnit)}
                      </span>
                    )}
                  </p>
                )}
              </>
            ) : chsCur.status === "offline" ? (
              <p className="reading chs-signal">
                <span className="dir">Canadian current data needs a moment of signal.</span>
                <span className="muted">Reconnect and {resolved.name} will load.</span>
              </p>
            ) : (
              <p className="reading chs-loading">
                <span className="muted">Loading Canadian current data…</span>
              </p>
            )
          ) : tideView ? (
            <>
              <p className="reading">
                <span className={tideView.state.rising ? "dir rising" : "dir falling"}>
                  {tideView.state.rising ? "▲ Rising" : "▼ Falling"}
                </span>
                <span className="value">
                  {formatHeight(tideView.state.level, units)}
                  <abbr>{heightUnit(units)}</abbr>
                </span>
              </p>

              {tideView.state.next && untilNext !== null && (
                <p className="next">
                  Next {tideView.state.next.high ? "high" : "low"} of{" "}
                  <strong>
                    {formatHeight(tideView.state.next.level, units)} {heightUnit(units)}
                  </strong>{" "}
                  at {time(tideView.state.next.time)}
                  <span className="muted">
                    {" "}
                    · in {Math.floor(untilNext / 60)}h {untilNext % 60}m
                  </span>
                </p>
              )}
            </>
          ) : status === "offline" ? (
            <p className="reading chs-signal">
              <span className="dir">Canadian data needs a moment of signal.</span>
              <span className="muted">Reconnect and Victoria will load.</span>
            </p>
          ) : (
            <p className="reading chs-loading">
              <span className="muted">Loading Canadian tide data…</span>
            </p>
          )}
        </section>

        {currentGate ? (
          curView && (
            <>
              <section className="panel chart-panel">
                <CurrentChart
                  station={resolved}
                  state={curView.state}
                  now={curView.now}
                  speedUnit={speedUnit}
                  onScrub={scrub}
                />
                {/* The derived curve is a shape, not a speed — say so under it. */}
                {curView.state.derived && (
                  <p className="muted chart-note">
                    Shape only — slack times are derived from high and low water at
                    Point Atkinson (+25 min at high, +35 at low). Floods on the rising
                    tide, ebbs on the falling one; <strong>speeds are not predicted</strong>{" "}
                    (it runs to about 9 knots).
                  </p>
                )}
              </section>

              {companion && tideView && (
                <section className="panel chart-panel">
                  <p className="eyebrow">Tide at {companion.name}</p>
                  <TideChart
                    station={companion}
                    state={tideView.state}
                    now={tideView.now}
                    units={units}
                    onScrub={scrub}
                  />
                </section>
              )}

              <EventList
                station={station}
                now={curView.now}
                today={liveNow}
                units={units}
                // The companion tide's high/low turns join the gate's slacks in
                // the schedule, matching the tide chart shown above (undefined
                // until it loads, or when the gate has no paired tide port).
                state={companion && tideView ? tideView.state : undefined}
                currentState={curView.state}
                speedUnit={speedUnit}
                onPageDay={pageDay}
                onToday={backToToday}
                onScrub={scrub}
              />
            </>
          )
        ) : (
          <>
            {tideView && (
              <section className="panel chart-panel">
                <TideChart station={resolved} state={tideView.state} now={tideView.now} units={units} onScrub={scrub} />
              </section>
            )}

            {tideView && (
              <EventList
                station={station}
                now={tideView.now}
                today={liveNow}
                units={units}
                state={isChs(station) ? tideView.state : undefined}
                onPageDay={pageDay}
                onToday={backToToday}
                onScrub={scrub}
              />
            )}
          </>
        )}

        <footer>
          <p className="warn">
            Astronomical prediction only — <strong>not for navigation</strong>.
          </p>
          {currentGate?.derived ? (
            <p className="muted">
              Slack times for {resolved.name} are derived on your device from Point Atkinson
              high and low water, served live from the{" "}
              <a href="https://tides.gc.ca/">Canadian Hydrographic Service</a> (CHS) under licence.
              CHS publishes no current prediction here. Not to be used for navigation (CHS clause 10).
            </p>
          ) : isChs(station) ? (
            <p className="muted">
              {isChsCurrent(station)
                ? companion
                  ? `Current data for ${resolved.name} and tide data for ${companion.name} are`
                  : `Current data for ${resolved.name} is`
                : `Tide data for ${resolved.name} is`}{" "}
              served live from the <a href="https://tides.gc.ca/">Canadian Hydrographic Service</a>{" "}
              (CHS) under licence —{" "}
              {isChsCurrent(station)
                ? companion
                  ? "speeds, heights and times"
                  : "speeds and times"
                : "heights and times"}{" "}
              as published by CHS, not computed on your device. Not to be used for navigation (CHS
              clause 10).
            </p>
          ) : (
            <p className="muted">
              Heights above {station.chartDatum}, times local to the station. {stations.length}{" "}
              public-domain stations from{" "}
              <a href="https://github.com/openwatersio/tide-database">NOAA via tide-database</a>,
              computed on your device. Canadian stations are not bundled — their published
              harmonics carry a licence that does not permit redistribution, so BC water is
              coming from CHS online at lower confidence.
            </p>
          )}
          <p className="muted">
            <a href="https://github.com/sailingnaturali/slackwater-web">Source</a> · GPL-3.0 ·{" "}
            <a href="https://sailingnaturali.com">Sailing Naturali</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
