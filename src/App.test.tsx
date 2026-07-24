import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { heldWhileLoading, heroMatchFor, App } from "./App";
import { distanceKm, type Match } from "./tides";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";

// react-dom/client's createRoot renders outside React's own act() batching
// unless told this is a test environment — mirrors SearchScreen.test.tsx.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no WebGL; MapScreen's own module test (MapScreen.test.tsx) covers
// the maplibre wiring. Here we only need a stand-in that proves the lazy
// chunk mounted and can signal back onClose.
vi.mock("./MapScreen", () => ({
  default: ({ onClose }: { onClose: () => void }) =>
    createElement(
      "div",
      { "data-testid": "map-screen" },
      createElement("button", { onClick: onClose }, "close-map"),
    ),
}));

// The date-nav hold: paging a CHS day refetches, and without this the whole view
// blanks to "Loading" for the fetch. heldWhileLoading keeps the previous day on
// screen while the next one loads — but must NOT hold across a station switch
// (a real reload) or a failed fetch (show the honest offline copy).
describe("heldWhileLoading", () => {
  const t0 = new Date("2026-07-23T12:00:00Z");
  const t1 = new Date("2026-07-24T12:00:00Z");

  it("passes a present state straight through and remembers it", () => {
    const ref = { current: null };
    expect(heldWhileLoading(ref, "today", t0, "chs-victoria", false)).toEqual({ state: "today", now: t0 });
    expect(ref.current).toEqual({ state: "today", now: t0, stationId: "chs-victoria" });
  });

  it("holds the previous day while the paged-to day loads", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "today", t0, "chs-victoria", false); // seed
    // Now loading the next day (state null) — keep showing the previous day.
    expect(heldWhileLoading(ref, null, t1, "chs-victoria", true)).toMatchObject({ state: "today", now: t0 });
  });

  it("drops the hold when the fetch fails (not loading) so the offline copy shows", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "today", t0, "chs-victoria", false); // seed
    expect(heldWhileLoading(ref, null, t1, "chs-victoria", false)).toBeNull();
  });

  it("does not hold across a station switch — that's a real reload, not a page", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "victoria-day", t0, "chs-victoria", false); // seed
    // A different station is loading: must not flash Victoria's chart under it.
    expect(heldWhileLoading(ref, null, t1, "chs-nanaimo", true)).toBeNull();
  });
});

// A bundled NOAA current station (Task 6): its detail view must render fully
// offline — chart, schedule and provenance — with no loading state, since the
// prediction is synchronous like a bundled tide station's. renderToStaticMarkup
// (see OfflineManager.test.tsx) sidesteps useOfflineSync/useLocation's effects
// (IndexedDB, geolocation, live network) entirely — this only needs the render
// output, not the app's connectivity plumbing.
describe("App: NOAA current station detail view", () => {
  it("renders a NOAA current station offline: chart, events, provenance", () => {
    const station = resolvedNoaaCurrentStations[0];
    window.history.pushState({}, "", `/tide/${station.slug}`);
    const html = renderToStaticMarkup(<App />);
    // Scope to <main> — the always-mounted Settings dialog carries its own
    // static "served live from the Canadian Hydrographic Service" BC-data
    // disclosure regardless of which station is viewed, so a whole-document
    // check for CHS copy would false-positive on unrelated chrome.
    const main = html.slice(html.indexOf("<main"));
    // Synchronous prediction: the current-reading hero renders directly, no
    // "Loading Canadian current data…" placeholder.
    expect(main).toContain(station.name);
    expect(main).toMatch(/computed on your device/i);
    expect(main).not.toContain("Canadian Hydrographic Service");
    expect(main).not.toContain("Loading Canadian");
    // The hero's phase word ("Flooding"/"Ebbing"/"Slack" via currentPhaseWord)
    // also matches /Slack|Flood|Ebb/, so a bare whole-<main> regex check
    // passes even if EventList's schedule silently renders empty — scope to
    // the schedule's own markup (a pill class) so this actually guards the
    // EventList routing fix, not just the hero reading.
    const schedule = main.slice(main.indexOf('class="event-rows"'));
    expect(schedule).toMatch(/pill (slack|flood|ebb)/);
  });
});

describe("heroMatchFor", () => {
  const place = { name: "Test", region: "Salish", latitude: 48.5, longitude: -123.0 };
  const station = { latitude: 48.6, longitude: -123.1 };
  const match = { distanceKm: 3.2, quality: "good" } as unknown as Match;

  it("hides the badge for a deliberate pick even while geolocation is active", () => {
    // The bug: with live.place set but `match` cleared by choose(), the old
    // code still rendered "N nm away · good match" — describing the nearest
    // station under whatever you'd navigated to. No match ⇒ no badge.
    expect(heroMatchFor(place, null, station)).toBeNull();
  });

  it("measures the VIEWED station against your place, not live.place's nearest", () => {
    const r = heroMatchFor(place, match, station)!;
    expect(r.km).toBeCloseTo(distanceKm(place, station), 5);
  });

  it("falls back to the raw match before a place resolves", () => {
    expect(heroMatchFor(null, match, station)).toEqual({ km: 3.2, quality: "good" });
  });
});

describe("App map route", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    if (container) container.remove();
    container = null;
    root = null;
    window.history.pushState({}, "", "/");
    localStorage.clear();
  });

  it("opens the map from the sidebar and deep-links at /map", async () => {
    window.history.pushState({}, "", "/map");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(App));
    });
    expect(container.querySelector('[data-testid="map-screen"]')).not.toBeNull();
  });

  // Spec §1: closing the map (without picking a station) returns to the
  // station list, not the detail view it happened to be opened from.
  it("closing the map returns to the station list", async () => {
    // Resolve the location gate ahead of time (as a returning visitor would
    // have it) so closing the map falls through to the list, not the gate —
    // "slackwater.gate" mirrors App.tsx's own SEEN_GATE constant/key.
    localStorage.setItem("slackwater.gate", "1");
    window.history.pushState({}, "", "/map");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(App));
    });

    const closeButton = container.querySelector('[data-testid="map-screen"] button');
    expect(closeButton).not.toBeNull();
    await act(async () => {
      (closeButton as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="map-screen"]')).toBeNull();
    // The sidebar is always mounted (shown/hidden via the "open" class), so
    // asserting on it alone wouldn't distinguish listOpen from closed. The
    // scrim only renders when listOpen is true — that's the precise signal.
    expect(container.querySelector(".sidebar.open")).not.toBeNull();
    expect(container.querySelector(".scrim")).not.toBeNull();
  });
});
