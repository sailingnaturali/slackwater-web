import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationList } from "./StationList";
import { resolvedStations, matchStation } from "./tides";
import type { NearbyStation } from "./nearby";
import type { ResolvedStation } from "./tides";

const now = new Date("2026-07-20T19:00:00Z");

const fridayHarbor = resolvedStations.find((s) => s.slug === "friday-harbor")!;
const everett = resolvedStations.find((s) => s.slug === "everett")!;
const cherryPoint = resolvedStations.find((s) => s.slug === "cherry-point")!;
const blaine = resolvedStations.find((s) => s.slug === "blaine")!;
const seattle = resolvedStations.find((s) => s.slug === "seattle")!;
const tacoma = resolvedStations.find((s) => s.slug === "tacoma")!;
const portAngeles = resolvedStations.find((s) => s.slug === "port-angeles")!;

const located = { station: fridayHarbor, match: matchStation(fridayHarbor)! };

function labelIndex(html: string, label: string): number {
  return html.indexOf(`>${label}<`);
}

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

  it("renders the unavailable location card when there is no location", () => {
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
    expect(html).toContain("Location unavailable");
  });
});
