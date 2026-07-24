import type { Candidate } from "./place";
import { isChs } from "./chsStations";
import { isNoaaCurrent, noaaCurrentState } from "./noaaCurrents";
import { predict } from "./tides";
import { currentPhaseWord } from "./chs/current";
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
 * The station's current reading, mirroring the header card's hero line — but
 * only for bundled stations, which predict synchronously on the device. CHS
 * ports and gates fetch their reading online, so a hover preview can't show it
 * (returns null → the popup shows name + context alone, the honest offline
 * posture). NOAA tide → rising/falling + height; NOAA current → phase + speed.
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
    return s.phase === "slack"
      ? "Slack"
      : `${currentPhaseWord(s.phase)} ${formatSpeed(s.speed, speedUnit)} ${speedUnitLabel(speedUnit)}`;
  }
  // Narrowed to a bundled NOAA tide station (has constituents) — predicts synchronously.
  const t = predict(station, now);
  return `${t.rising ? "▲ Rising" : "▼ Falling"} ${formatHeight(t.level, units)} ${heightUnit(units)}`;
}

/**
 * The hover-popup body: the header card's identity (name + context) plus the
 * live reading, deliberately WITHOUT the "N nm away · <quality>" match line —
 * that line is per-viewer and currently renders on every station regardless of
 * fit, so it would be misleading on a browse map.
 */
export function previewHtml(
  station: Candidate,
  now: Date,
  units: Units,
  speedUnit: SpeedUnit,
): string {
  const reading = pinReading(station, now, units, speedUnit);
  return (
    `<strong class="map-popup-name">${escapeHtml(station.name)}</strong>` +
    (station.context ? `<div class="map-popup-context">${escapeHtml(station.context)}</div>` : "") +
    (reading ? `<div class="map-popup-reading">${escapeHtml(reading)}</div>` : "")
  );
}
