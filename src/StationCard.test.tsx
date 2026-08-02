import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationCard } from "./StationCard";
import type { ResolvedStation, TideState } from "./tides";
import type { ChsStation } from "./chsStations";
import type { CurrentState } from "./chs/current";

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

  it("shows distance with the identity, not as a pill", () => {
    const withKm = renderToStaticMarkup(
      <StationCard station={station} km={12} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withKm).toContain("station-card-dist");
    expect(withKm).not.toContain('class="pill"');

    const withoutKm = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    expect(withoutKm).not.toContain("station-card-dist");
  });

  it("renders a kind glyph whose colour tracks state, not kind", () => {
    const rising = renderToStaticMarkup(
      <StationCard station={station} state={state} units="imperial" onSelect={() => {}} />,
    );
    const falling = renderToStaticMarkup(
      <StationCard station={station} state={{ ...state, rising: false }} units="imperial" onSelect={() => {}} />,
    );
    expect(rising).toContain("station-glyph rising");
    expect(falling).toContain("station-glyph falling");
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

const flooding: CurrentState = {
  signed: 2.1,
  speed: 2.1,
  phase: "flood",
  setDegrees: 45,
  floodDirection: 45,
  ebbDirection: 225,
  nextSlack: { time: new Date("2026-07-20T22:42:00Z"), kind: "slack" },
  following: null,
  events: [],
  timeline: [],
};

describe("StationCard — currents", () => {
  it("renders speed, a compass arrow toward the set, and the next slack time", () => {
    const html = renderToStaticMarkup(
      <StationCard station={gate} current={flooding} units="metric" onSelect={() => {}} />,
    );
    expect(html).toContain("Slack ·");
    expect(html).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
    expect(html).toContain("2.1"); // speed in knots
    expect(html).toContain("compass-arrow flood"); // arrow, tinted like a flood
    expect(html).toContain("rotate(45deg)"); // pointing NE, toward the set
    expect(html).toContain('aria-label="toward NE"');
  });

  it("tags the phase in a pill and shows no arrow at slack", () => {
    const slack = renderToStaticMarkup(
      <StationCard
        station={gate}
        current={{ ...flooding, phase: "slack", speed: 0.05, signed: 0.05 }}
        units="metric"
        onSelect={() => {}}
      />,
    );
    expect(slack).toContain('phase-pill slack');
    expect(slack).not.toContain("dir rising");
    expect(slack).not.toContain("dir falling");
  });

  it("tags the phase in a pill, no knots, for a derived gate", () => {
    const derived = renderToStaticMarkup(
      <StationCard
        station={gate}
        current={{ ...flooding, derived: true }}
        units="metric"
        onSelect={() => {}}
      />,
    );
    expect(derived).toContain('phase-pill flood');
    // No display-size value: the derived gate has no speed to render.
    expect(derived).not.toContain("2.1");
    expect(derived).not.toContain("station-card-value");
  });

  // The glyph's FORM is identity. It used to be `current ? "current" : "tide"`,
  // so a gate whose reading had not arrived — every search result, and any gate
  // before useChsCurrent resolved, i.e. forever offline — drew the tide dome.
  it("draws the current glyph with no reading at all, and tones it unknown", () => {
    const html = renderToStaticMarkup(
      <StationCard station={gate} units="metric" onSelect={() => {}} />,
    );
    expect(html).toContain("station-glyph unknown");
    // The dome is the tide form; a gate must never render it.
    expect(html).toContain('aria-label="Current station"');
    expect(html).not.toContain('aria-label="Tide station"');
  });

  it("a gate with a companion tide keeps the current as the only reading, tide as a next-line", () => {
    const html = renderToStaticMarkup(
      <StationCard
        station={gate}
        state={state}
        current={flooding}
        units="imperial"
        onSelect={() => {}}
      />,
    );
    // Tide merges as text — the next high/low line, not a second big number.
    expect(html).toContain("High");
    expect(html).toContain("8.0");
    // Current is the reading; the big tide level is suppressed, so there is
    // exactly one reading block (two would be the layout regression this fixes).
    expect(html).toContain("2.1"); // current speed
    expect((html.match(/station-card-reading/g) ?? []).length).toBe(1);
  });
});
