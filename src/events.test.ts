import { describe, it, expect } from "vitest";
import { currentDayEventsFromState, dayEvents, resolvedStations } from "./tides";
import { toCurrentState } from "./chs/current";
import cEvents from "./chs/fixtures/active-pass-events.json";
import cSpeeds from "./chs/fixtures/active-pass-wcsp1.json";
import cDirs from "./chs/fixtures/active-pass-wcdp1.json";
import type { IwlsSample } from "./chs/client";

const station = resolvedStations.find((s) => s.slug === "friday-harbor")!;
const day = new Date("2026-07-20T12:00:00Z");

describe("dayEvents", () => {
  it("interleaves tides and sun events in time order", () => {
    const events = dayEvents(station, day);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].time.getTime()).toBeGreaterThanOrEqual(events[i - 1].time.getTime());
    }
    expect(events.some((e) => e.kind === "sunrise")).toBe(true);
    expect(events.some((e) => e.kind === "sunset")).toBe(true);
  });

  it("gives tide events a level and sun events none", () => {
    for (const event of dayEvents(station, day)) {
      const isTide = event.kind === "high" || event.kind === "low";
      expect(typeof event.level === "number").toBe(isTide);
    }
  });

  it("puts sunrise before sunset", () => {
    const events = dayEvents(station, day);
    const rise = events.find((e) => e.kind === "sunrise")!;
    const set = events.find((e) => e.kind === "sunset")!;
    expect(rise.time.getTime()).toBeLessThan(set.time.getTime());
  });

  it("keeps everything inside the requested local day", () => {
    const events = dayEvents(station, day);
    const local = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: station.timezone });
    for (const event of events) expect(local(event.time)).toBe(local(day));
  });
});

describe("currentDayEventsFromState", () => {
  const state = toCurrentState(
    cEvents as IwlsSample[], cSpeeds as IwlsSample[], cDirs as IwlsSample[],
    45, 225, new Date("2026-07-23T05:00:00Z"),
  );
  const gate = { latitude: 48.8604, longitude: -123.3128, timezone: "America/Vancouver" };
  const day = new Date("2026-07-23T12:00:00Z");
  const rows = currentDayEventsFromState(state, gate, day);

  it("emits slack / max-flood / max-ebb rows with speeds and sun rows", () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has("slack")).toBe(true);
    expect([...kinds].some((k) => k === "max-flood" || k === "max-ebb")).toBe(true);
    expect(kinds.has("sunrise") || kinds.has("sunset")).toBe(true);
    const peak = rows.find((r) => r.kind === "max-flood" || r.kind === "max-ebb")!;
    expect(peak.speed).toBeGreaterThan(0);
    expect(peak.level).toBeUndefined(); // currents carry speed, not height
  });

  it("orders rows by time", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].time.getTime()).toBeGreaterThanOrEqual(rows[i - 1].time.getTime());
    }
  });
});
