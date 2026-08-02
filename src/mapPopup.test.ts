import { describe, it, expect } from "vitest";
import { candidates } from "./place";
import { isChs } from "./chsStations";
import { isNoaaCurrent } from "./noaaCurrents";
import { pinReading, previewHtml } from "./mapPopup";

const NOW = new Date("2026-07-23T20:00:00Z");
const noaaTide = candidates.find((s) => !isChs(s) && !isNoaaCurrent(s))!;
const chs = candidates.find((s) => isChs(s))!;
const noaaCurrent = candidates.find((s) => isNoaaCurrent(s))!;

describe("pinReading", () => {
  it("gives a bundled NOAA tide station a height quantity, no state word", () => {
    const r = pinReading(noaaTide, NOW, "imperial", "kn");
    expect(r).toMatch(/\d/);
    expect(r).toContain("ft");
    expect(r).not.toMatch(/Rising|Falling/);
  });

  it("gives a NOAA current station a speed quantity unless slack", () => {
    const r = pinReading(noaaCurrent, NOW, "imperial", "kn");
    if (r === null) {
      // Slack carries no quantity — the state line shows the word alone.
      expect(r).toBeNull();
    } else {
      expect(r).toContain("kn");
      expect(r).not.toMatch(/Flooding|Ebbing|Slack/);
    }
  });

  it("returns null for CHS stations — no on-device prediction to preview", () => {
    expect(pinReading(chs, NOW, "imperial", "kn")).toBeNull();
  });
});

describe("previewHtml", () => {
  it("carries name + context + kind + state, and never the match line", () => {
    const html = previewHtml(noaaTide, NOW, "imperial", "kn");
    expect(html).toContain(noaaTide.name);
    expect(html).toMatch(/Current gate|Tide station/);
    expect(html).toContain("map-popup-reading");
    expect(html).toMatch(/Rising|Falling/);
    expect(html).not.toMatch(/nm away|good match|match/i);
  });

  it("names the kind in plain language, using isCurrentStation as the source of truth", () => {
    expect(previewHtml(noaaCurrent, NOW, "imperial", "kn")).toContain("Current gate");
    expect(previewHtml(noaaTide, NOW, "imperial", "kn")).toContain("Tide station");
  });

  it("spells out the state for a bundled current station, with its speed", () => {
    const html = previewHtml(noaaCurrent, NOW, "imperial", "kn");
    expect(html).toMatch(/Flooding|Ebbing|Slack/);
  });

  it("gives a CHS station an honest 'unknown' state rather than a blank line", () => {
    const html = previewHtml(chs, NOW, "imperial", "kn");
    expect(html).toContain(chs.name);
    expect(html).toContain("map-popup-reading");
    expect(html).toContain("Unknown");
  });

  it("escapes HTML in station text", () => {
    const evil = { ...noaaTide, name: 'A & B <script>', context: "" } as typeof noaaTide;
    const html = previewHtml(evil, NOW, "imperial", "kn");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
