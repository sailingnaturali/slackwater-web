import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { heldWhileLoading, App } from "./App";

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
