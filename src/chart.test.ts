import { describe, it, expect } from "vitest";
import { snapToTurn, predictRange, resolvedStations } from "./tides";

const station = resolvedStations.find((s) => s.slug === "friday-harbor")!;
const day = new Date("2026-07-20T12:00:00Z");
const extremes = predictRange(station, day, 1);

describe("snapToTurn", () => {
  it("snaps onto a turn when released near one", () => {
    const turn = extremes[0].time;
    const near = new Date(turn.getTime() + 9 * 60_000);
    expect(snapToTurn(near, extremes, 15).getTime()).toBe(turn.getTime());
  });

  it("leaves the time alone when nothing is close", () => {
    const turn = extremes[0].time;
    const far = new Date(turn.getTime() + 90 * 60_000);
    expect(snapToTurn(far, extremes, 15).getTime()).toBe(far.getTime());
  });

  it("picks the nearest turn when two are in range", () => {
    const midpoint = new Date((extremes[0].time.getTime() + extremes[1].time.getTime()) / 2);
    const snapped = snapToTurn(midpoint, extremes, 10_000);
    const d0 = Math.abs(snapped.getTime() - extremes[0].time.getTime());
    const d1 = Math.abs(snapped.getTime() - extremes[1].time.getTime());
    expect(Math.min(d0, d1)).toBe(0);
  });

  it("returns the input unchanged when there are no turns", () => {
    expect(snapToTurn(day, [], 15).getTime()).toBe(day.getTime());
  });
});
