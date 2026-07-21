import { describe, it, expect } from "vitest";
import { dayEvents, resolvedStations } from "./tides";

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
