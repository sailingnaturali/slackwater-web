import type { Candidate } from "./place";

export interface ParsedUrl {
  station: Candidate;
  t: Date | null;
  /** False when the URL segment isn't the station's current slug — caller should redirect to the canonical form. */
  canonical: boolean;
}

/** Accept a shared time within this window of now; anything further out is treated as unparseable. */
const MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/**
 * `formerSlugs` isn't published by @sailingnaturali/station-corrections yet
 * (1.3.1 — filed upstream as issue #7). Resolving against an empty list here
 * means adopting it later is a data change (wiring the field through
 * resolvedStations in tides.ts), not a code change.
 */
function formerSlugs(station: Candidate): string[] {
  return (station as Candidate & { formerSlugs?: string[] }).formerSlugs ?? [];
}

/** A provider id like `noaa/9447659` as it appears in a URL. */
function providerSegment(station: Candidate): string {
  return station.id.replace(/\//g, "-");
}

/**
 * Resolves a URL segment to a station in three passes: current slug, then a
 * former slug, then the provider id. Slugs come from an external package and
 * end up in shared links, so when one changes, every link already out there
 * must still land on the right station.
 */
function findStation(
  segment: string,
  stations: Candidate[],
): { station: Candidate; canonical: boolean } | null {
  const bySlug = stations.find((s) => s.slug === segment);
  if (bySlug) return { station: bySlug, canonical: true };

  const byFormerSlug = stations.find((s) => formerSlugs(s).includes(segment));
  if (byFormerSlug) return { station: byFormerSlug, canonical: false };

  const byProviderId = stations.find((s) => providerSegment(s) === segment);
  if (byProviderId) return { station: byProviderId, canonical: false };

  return null;
}

/** An unparseable or out-of-range time yields null rather than failing the route — a bad timestamp should still show you the station. */
function parseTime(raw: string | undefined): Date | null {
  if (!raw) return null;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  if (Math.abs(t.getTime() - Date.now()) > MAX_AGE_MS) return null;
  return t;
}

/** Parses `/tide/<slug>[/<iso-instant>]`. */
export function parseUrl(pathname: string, stations: Candidate[]): ParsedUrl | null {
  const match = /^\/tide\/([^/]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return null;
  const [, segment, rawTime] = match;
  const found = findStation(segment, stations);
  if (!found) return null;
  return { station: found.station, t: parseTime(rawTime), canonical: found.canonical };
}

/**
 * The numeric UTC offset for `t` in `station`'s own timezone, e.g. "-07:00".
 * Derived from Intl rather than hardcoded — a literal "-07:00" is right for
 * PDT and wrong for the five months a year the Pacific coast runs PST.
 */
function offsetFor(station: Candidate, t: Date): string {
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: station.timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(t)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(tzName);
  if (!m) return "+00:00";
  const [, sign, hh, mm = "00"] = m;
  return `${sign}${hh.padStart(2, "0")}:${mm.padStart(2, "0")}`;
}

function localParts(station: Candidate, t: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: station.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Builds `/tide/<slug>[/<iso-instant>]`, writing the time in the station's own offset. */
export function buildUrl(station: Candidate, t: Date | null): string {
  const base = `/tide/${station.slug}`;
  if (!t) return base;
  const { year, month, day, hour, minute } = localParts(station, t);
  return `${base}/${year}-${month}-${day}T${hour}:${minute}${offsetFor(station, t)}`;
}
