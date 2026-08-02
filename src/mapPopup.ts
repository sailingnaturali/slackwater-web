import type { Tone } from "./StationGlyph";
import { isCurrentStation, type Candidate } from "./place";
import { isChs } from "./chsStations";
import { isNoaaCurrent, noaaCurrentState } from "./noaaCurrents";
import { predict } from "./tides";
import { syncTone } from "./pinState";
import {
  formatHeight,
  heightUnit,
  formatSpeed,
  speedUnitLabel,
  type SpeedUnit,
  type Units,
} from "./units";

/** Station data is bundled/trusted, but the popup builds raw HTML — escape anyway. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * The quantity half of the station's current reading — height or speed, no
 * state word (the word is `syncTone` + `TONE_WORD` below; keeping the two
 * apart is what stops the popup line from saying "Rising Rising 3.2 ft").
 * Only bundled stations predict synchronously on the device: CHS ports and
 * gates fetch their reading online, so a hover preview has no number to show
 * (returns null — the state line still names the state, just with no
 * quantity after it).
 */
export function pinReading(
  station: Candidate,
  now: Date,
  units: Units,
  speedUnit: SpeedUnit,
): string | null {
  if (isChs(station)) return null;
  if (isNoaaCurrent(station)) {
    const s = noaaCurrentState(station, now);
    return s.phase === "slack" ? null : `${formatSpeed(s.speed, speedUnit)} ${speedUnitLabel(speedUnit)}`;
  }
  // Narrowed to a bundled NOAA tide station (has constituents) — predicts synchronously.
  const t = predict(station, now);
  return `${formatHeight(t.level, units)} ${heightUnit(units)}`;
}

/** `Tone` spelled out for prose. `syncTone` is the single source of truth for
 * the value; this only maps it to words. "unknown" — CHS, or anything the
 * synchronous path can't resolve — gets an honest label rather than silence. */
const TONE_WORD: Record<Tone, string> = {
  rising: "Rising",
  falling: "Falling",
  flood: "Flooding",
  ebb: "Ebbing",
  slack: "Slack",
  unknown: "Unknown",
};

/**
 * The hover-popup body: the header card's identity (name + context), the
 * station's kind in plain language, and the live state spelled out — colour
 * is the map's primary signal and a colour with no legend is a puzzle, so the
 * popup carries the reading in words (spec §2a). Deliberately WITHOUT the
 * "N nm away · <quality>" match line — that line is per-viewer and currently
 * renders on every station regardless of fit, so it would be misleading on a
 * browse map.
 */
export function previewHtml(
  station: Candidate,
  now: Date,
  units: Units,
  speedUnit: SpeedUnit,
): string {
  const kind = isCurrentStation(station) ? "Current gate" : "Tide station";
  const context = [station.context, kind].filter(Boolean).join(" · ");
  const word = TONE_WORD[syncTone(station, now)];
  const quantity = pinReading(station, now, units, speedUnit);
  const stateLine = quantity ? `${word} ${quantity}` : word;
  return (
    `<strong class="map-popup-name">${escapeHtml(station.name)}</strong>` +
    `<div class="map-popup-context">${escapeHtml(context)}</div>` +
    `<div class="map-popup-reading">● ${escapeHtml(stateLine)}</div>`
  );
}
