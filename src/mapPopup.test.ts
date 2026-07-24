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
  it("gives a bundled NOAA tide station a rising/falling height", () => {
    const r = pinReading(noaaTide, NOW, "imperial", "kn");
    expect(r).toMatch(/(Rising|Falling)/);
    expect(r).toMatch(/\d/);
    expect(r).toContain("ft");
  });

  it("gives a NOAA current station a phase (and speed unless slack)", () => {
    const r = pinReading(noaaCurrent, NOW, "imperial", "kn")!;
    expect(r).toMatch(/Flooding|Ebbing|Slack/);
    if (!r.includes("Slack")) expect(r).toContain("kn");
  });

  it("returns null for CHS stations — no on-device prediction to preview", () => {
    expect(pinReading(chs, NOW, "imperial", "kn")).toBeNull();
  });
});

describe("previewHtml", () => {
  it("carries name + context + reading, and never the match line", () => {
    const html = previewHtml(noaaTide, NOW, "imperial", "kn");
    expect(html).toContain(noaaTide.name);
    expect(html).toContain("map-popup-reading");
    expect(html).not.toMatch(/nm away|good match|match/i);
  });

  it("omits the reading block for a CHS station (name still shown)", () => {
    const html = previewHtml(chs, NOW, "imperial", "kn");
    expect(html).toContain(chs.name);
    expect(html).not.toContain("map-popup-reading");
  });

  it("escapes HTML in station text", () => {
    const evil = { ...noaaTide, name: 'A & B <script>', context: "" } as typeof noaaTide;
    const html = previewHtml(evil, NOW, "imperial", "kn");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
