import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationCard } from "./StationCard";
import type { ResolvedStation, TideState } from "./tides";

const station: ResolvedStation = {
  id: "noaa-1",
  name: "Everett",
  latitude: 47.99,
  longitude: -122.22,
  timezone: "America/Los_Angeles",
  chartDatum: "MLLW",
  datumOffset: 0,
  source: "National Oceanic and Atmospheric Administration",
  sourceUrl: "https://example.com",
  constituents: [],
  context: "Puget Sound",
  slug: "everett",
  aliases: ["everett"],
};

const state: TideState = {
  level: 2.4384, // 8.0 ft
  rising: true,
  next: { time: new Date("2026-07-20T20:42:00Z"), level: 2.4384, high: true },
  extremes: [],
  timeline: [],
};

describe("StationCard", () => {
  it("renders the next turn as 'High 8.0 ft · <time>'", () => {
    const html = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(html).toContain("High");
    expect(html).toContain("8.0");
    expect(html).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  it("shows a distance pill only when km is given", () => {
    const withKm = renderToStaticMarkup(
      <StationCard station={station} km={12} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withKm).toContain("pill");

    const withoutKm = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withoutKm).not.toContain("pill");
  });

  it("marks the falling direction when the tide is dropping", () => {
    const falling = renderToStaticMarkup(
      <StationCard
        station={station}
        state={{ ...state, rising: false }}
        units="imperial"
        onSelect={() => {}}
      />,
    );
    expect(falling).toContain("dir falling");
  });
});
