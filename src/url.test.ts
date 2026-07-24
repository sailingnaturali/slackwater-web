import { describe, it, expect } from "vitest";
import { parseUrl, buildUrl } from "./url";
import { resolvedStations } from "./tides";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";
import { candidates } from "./place";

const parse = (p: string) => parseUrl(p, resolvedStations);
const everett = resolvedStations.find((s) => s.slug === "everett")!;

describe("parseUrl", () => {
  it("reads a bare station as now", () => {
    const got = parse("/tide/everett")!;
    expect(got.station.slug).toBe("everett");
    expect(got.t).toBeNull();
  });

  it("reads a station and a moment", () => {
    const got = parse("/tide/everett/2026-07-20T14:35-07:00")!;
    expect(got.station.slug).toBe("everett");
    expect(got.t!.toISOString()).toBe("2026-07-20T21:35:00.000Z");
  });

  it("resolves a provider id to its station", () => {
    // Links made before a name was corrected must keep working.
    const got = parse("/tide/noaa-9447659")!;
    expect(got.station.slug).toBe("everett");
  });

  it("returns null for an unknown station", () => {
    expect(parse("/tide/atlantis")).toBeNull();
  });

  it("ignores an unparseable time rather than failing the whole route", () => {
    const got = parse("/tide/everett/not-a-time")!;
    expect(got.station.slug).toBe("everett");
    expect(got.t).toBeNull();
  });

  it("ignores a time absurdly far out", () => {
    // Beyond any useful prediction; fall back to now rather than error.
    const got = parse("/tide/everett/2150-01-01T00:00-07:00")!;
    expect(got.t).toBeNull();
  });
});

describe("buildUrl", () => {
  it("omits the time for now", () => {
    expect(buildUrl(everett, null)).toBe("/tide/everett");
  });

  it("writes the time with the station's own offset", () => {
    const url = buildUrl(everett, new Date("2026-07-20T21:35:00Z"));
    expect(url).toBe("/tide/everett/2026-07-20T14:35-07:00");
  });

  it("round-trips through parseUrl", () => {
    const t = new Date("2026-07-20T21:35:00Z");
    const parsed = parseUrl(buildUrl(everett, t), resolvedStations)!;
    expect(parsed.t!.getTime()).toBe(t.getTime());
  });

  it("writes a winter offset, not a hardcoded PDT one", () => {
    // January is PST (-08:00); a hardcoded "-07:00" would pass the summer
    // test above and still be wrong here.
    const url = buildUrl(everett, new Date("2026-01-15T20:00:00Z"));
    expect(url).toBe("/tide/everett/2026-01-15T12:00-08:00");
  });
});

it("routes a NOAA current station by slug and by provider id", () => {
  const station = resolvedNoaaCurrentStations[0];
  expect(parseUrl(`/tide/${station.slug}`, candidates)?.station.id).toBe(station.id);
  const byId = parseUrl(`/tide/${station.id.replace(/\//g, "-")}`, candidates);
  expect(byId?.station.id).toBe(station.id);
  expect(byId?.canonical).toBe(false);
});
