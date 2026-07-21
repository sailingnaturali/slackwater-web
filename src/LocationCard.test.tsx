import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocationCard } from "./LocationCard";
import type { Match, ResolvedStation, TideState } from "./tides";

const station: ResolvedStation = {
  id: "noaa-1",
  name: "Roche Harbor",
  latitude: 48.423,
  longitude: -123.371,
  timezone: "America/Los_Angeles",
  chartDatum: "MLLW",
  datumOffset: 0,
  source: "National Oceanic and Atmospheric Administration",
  sourceUrl: "https://example.com",
  constituents: [],
  context: "San Juan Island",
  slug: "roche-harbor",
  aliases: ["roche-harbor"],
};

const match: Match = { station, distanceKm: 1.2, quality: "good" };

const state: TideState = {
  level: 1,
  rising: true,
  next: { time: new Date("2026-07-20T20:42:00Z"), level: 1.2, high: true },
  extremes: [],
  timeline: [],
};

describe("LocationCard", () => {
  it("renders the matched station's coordinates in mono and its match quality", () => {
    const html = renderToStaticMarkup(
      <LocationCard
        match={match}
        station={station}
        state={state}
        units="imperial"
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("48.423°N, 123.371°W");
    expect(html).toContain("good match");
    expect(html).toContain("Roche Harbor");
  });

  it("renders the amber unavailable state without pretending to be a settings deep link", () => {
    const html = renderToStaticMarkup(
      <LocationCard
        match={null}
        station={null}
        state={null}
        units="imperial"
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("Location unavailable");
    expect(html).toContain("Turn on location for Slackwater to see stations near you");
    // The action explains the manual step; it must not read as a button that
    // claims to open a settings screen the web has no API to reach.
    expect(html.toLowerCase()).not.toContain("open settings");
    expect(html).toContain("unavailable");
  });
});
