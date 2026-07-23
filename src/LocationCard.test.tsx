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
  it("renders just the station card — coords live in the group eyebrow, quality in the detail header", () => {
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
    expect(html).toContain("Roche Harbor");
    expect(html).not.toContain("48.423");
    expect(html).not.toContain("good match");
  });

  // Default (permission unknown until the async Permissions query resolves —
  // which SSR never runs): the honest state is "we haven't asked yet", so offer
  // the ask inline rather than sending anyone to settings they may not need.
  it("offers an inline ask when not located, instead of a settings lecture", () => {
    const html = renderToStaticMarkup(
      <LocationCard
        match={null}
        station={null}
        state={null}
        units="imperial"
        selected={false}
        onSelect={() => {}}
        onRequestLocation={() => {}}
      />,
    );
    expect(html).toContain("See stations near you");
    expect(html).toContain("Use my location");
    // A real ask button that triggers a prompt — never a fake "open settings"
    // link to a screen the web has no API to reach.
    expect(html.toLowerCase()).not.toContain("open settings");
    // Without the ask handler there is nothing to offer, so no button.
    const noHandler = renderToStaticMarkup(
      <LocationCard match={null} station={null} state={null} units="imperial" selected={false} onSelect={() => {}} />,
    );
    expect(noHandler).not.toContain("Use my location");
  });
});
