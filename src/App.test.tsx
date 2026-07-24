import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { heldWhileLoading, App } from "./App";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";

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
    expect(main).toMatch(/Slack|Flood|Ebb/);
    expect(main).toMatch(/computed on your device/i);
    expect(main).not.toContain("Canadian Hydrographic Service");
    expect(main).not.toContain("Loading Canadian");
  });
});
