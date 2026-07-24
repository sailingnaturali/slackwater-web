import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { StationList } from "./StationList";
import { resolvedStations, matchStation } from "./tides";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";
import type { NearbyStation } from "./nearby";
import type { ResolvedStation } from "./tides";
import type { ChsStation } from "./chsStations";

// The hook is IndexedDB/network-backed and SSR renders only its initial
// "loading" state — hand any gate a ready reading so the card path is testable.
vi.mock("./useChsCurrent", () => ({
  useChsCurrent: (station: ChsStation | null) =>
    station
      ? {
          state: {
            signed: 2.1,
            speed: 2.1,
            phase: "flood",
            setDegrees: 45,
            floodDirection: 45,
            ebbDirection: 225,
            nextSlack: { time: new Date("2026-07-20T22:42:00Z"), kind: "slack" },
            following: null,
            events: [{ time: new Date("2026-07-20T22:42:00Z"), kind: "slack" }],
            timeline: [
              { time: new Date("2026-07-20T18:00:00Z"), signed: 2.1 },
              { time: new Date("2026-07-20T20:00:00Z"), signed: 2.1 },
            ],
          },
          status: "ready",
        }
      : { state: null, status: "loading" },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = new Date("2026-07-20T19:00:00Z");

const fridayHarbor = resolvedStations.find((s) => s.slug === "friday-harbor")!;
const everett = resolvedStations.find((s) => s.slug === "everett")!;
const cherryPoint = resolvedStations.find((s) => s.slug === "cherry-point")!;
const blaine = resolvedStations.find((s) => s.slug === "blaine")!;
const seattle = resolvedStations.find((s) => s.slug === "seattle")!;
const tacoma = resolvedStations.find((s) => s.slug === "tacoma")!;
const portAngeles = resolvedStations.find((s) => s.slug === "port-angeles")!;

const located = { station: fridayHarbor, match: matchStation(fridayHarbor)! };

// Prefix match, not `>${label}<` — the Current location eyebrow carries coords
// after the label text.
function labelIndex(html: string, label: string): number {
  return html.indexOf(`>${label}`);
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root && container) {
    act(() => root!.unmount());
    container.remove();
  }
  root = null;
  container = null;
});

describe("StationList grouping", () => {
  it("renders the groups in order: current location, starred, recent, nearby", () => {
    const html = renderToStaticMarkup(
      <StationList
        located={located}
        starred={[everett]}
        recent={[cherryPoint]}
        nearby={[{ station: blaine, km: 8 }]}
        origin={fridayHarbor}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    const order = ["Current location", "Starred", "Recent", "Nearby"].map((label) =>
      labelIndex(html, label),
    );
    for (const i of order) expect(i).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    // The eyebrow carries the rough position; the card below carries identity.
    expect(html).toMatch(/Current location · \d+°N, \d+°W/);
  });

  it("does not render a header over an empty group", () => {
    const html = renderToStaticMarkup(
      <StationList
        located={located}
        starred={[]}
        recent={[]}
        nearby={[]}
        origin={fridayHarbor}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(html).not.toContain(">Starred<");
    expect(html).not.toContain(">Recent<");
    expect(html).not.toContain(">Nearby<");
  });

  it("offers 'All' only once a group holds more than its limit", () => {
    const atLimit = [everett, cherryPoint, blaine, seattle, tacoma, fridayHarbor, portAngeles];
    const overLimit: NearbyStation<ResolvedStation>[] = [
      everett,
      cherryPoint,
      blaine,
      seattle,
    ].map((station) => ({ station, km: 1 }));

    const htmlAtLimit = renderToStaticMarkup(
      <StationList
        located={null}
        starred={[]}
        recent={atLimit}
        nearby={[]}
        origin={null}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(htmlAtLimit).not.toContain("all-toggle");

    const htmlOverNearbyLimit = renderToStaticMarkup(
      <StationList
        located={null}
        starred={[]}
        recent={[]}
        nearby={overLimit}
        origin={null}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(htmlOverNearbyLimit).toContain("all-toggle");
  });

  it("offers 'All' for starred only once it holds more than the 50 cap", () => {
    // Component-level invariant. Storage (savedStations.ts) is unbounded —
    // a user can star well past 50 — so the render bound has to hold here,
    // not upstream.
    const many = Array.from({ length: 51 }, (_, i) => ({
      ...everett,
      id: `starred-${i}`,
      slug: `starred-${i}`,
    }));

    const htmlOver = renderToStaticMarkup(
      <StationList
        located={null}
        starred={many}
        recent={[]}
        nearby={[]}
        origin={null}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(htmlOver).toContain("all-toggle");

    const htmlAt = renderToStaticMarkup(
      <StationList
        located={null}
        starred={many.slice(0, 50)}
        recent={[]}
        nearby={[]}
        origin={null}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(htmlAt).not.toContain("all-toggle");
  });

  it("caps starred's 'All' at 50 even with 60 stored stars", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...everett,
      id: `starred-${i}`,
      slug: `starred-${i}`,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <StationList
          located={null}
          starred={many}
          recent={[]}
          nearby={[]}
          origin={null}
          selectedId={fridayHarbor.id}
          units="imperial"
          now={now}
          onSelect={() => {}}
        />,
      );
    });
    act(() => {
      container!.querySelector(".all-toggle")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container!.querySelectorAll(".station-card").length).toBe(50);
  });

  it("caps nearby's 'All' at 20 even when more stations are handed to it", () => {
    // Defensive: the real caller (App.tsx) only ever fetches 20, but the
    // component must not trust that — it enforces its own ceiling.
    const many: NearbyStation<ResolvedStation>[] = Array.from({ length: 25 }, (_, i) => ({
      station: { ...everett, id: `nearby-${i}`, slug: `nearby-${i}` },
      km: i,
    }));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <StationList
          located={null}
          starred={[]}
          recent={[]}
          nearby={many}
          origin={null}
          selectedId={fridayHarbor.id}
          units="imperial"
          now={now}
          onSelect={() => {}}
        />,
      );
    });
    act(() => {
      container!.querySelector(".all-toggle")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container!.querySelectorAll(".station-card").length).toBe(20);
  });

  it("shows a located current gate's reading — same card path as the list groups", () => {
    const gate: ChsStation = {
      kind: "chs",
      series: "current",
      provider: "chs",
      id: "chs-malibu",
      slug: "chs-malibu",
      name: "Malibu Rapids",
      context: "Princess Louisa Inlet",
      latitude: 50.2,
      longitude: -123.8,
      aliases: [],
      timezone: "America/Vancouver",
    };
    const html = renderToStaticMarkup(
      <StationList
        located={{ station: gate, match: { station: gate, distanceKm: 0.4, quality: "good" } }}
        starred={[]}
        recent={[]}
        nearby={[]}
        origin={{ latitude: 50.2, longitude: -123.8 }}
        selectedId={gate.id}
        units="metric"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("compass-arrow flood"); // arrow toward the set, like the group cards
    expect(html).toContain("2.1");
  });

  it("renders the location card inviting an ask when there is no location", () => {
    const html = renderToStaticMarkup(
      <StationList
        located={null}
        starred={[]}
        recent={[]}
        nearby={[]}
        origin={null}
        selectedId={fridayHarbor.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("See stations near you");
  });

  it("a NOAA current station's card carries a current reading, not a tide", () => {
    const station = resolvedNoaaCurrentStations[0];
    const html = renderToStaticMarkup(
      <StationList
        located={null}
        starred={[station]}
        recent={[]}
        nearby={[]}
        origin={null}
        selectedId={station.id}
        units="imperial"
        now={now}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain(station.name);
    // Should show a current reading (Slack, Max flood, or Max ebb)
    expect(html).toMatch(/Slack|Max flood|Max ebb/);
    // Should NOT show a tide reading (High or Low)
    expect(html).not.toMatch(/\bHigh\b|\bLow\b/);
  });
});
