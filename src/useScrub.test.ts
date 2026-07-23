import { describe, it, expect } from "vitest";
import { timeFromClientX, type ScrubGeometry } from "./useScrub";

const g: ScrubGeometry = { plotLeft: 44, plotWidth: 660, svgWidth: 720,
  t0: new Date("2026-07-23T00:00:00Z").getTime(), t1: new Date("2026-07-23T24:00:00Z").getTime() };

// A 720-wide SVG rendered into a 720px-wide element: client x maps 1:1 to svg x.
const rect = { left: 0, width: 720 } as DOMRect;
const target = { getBoundingClientRect: () => rect } as unknown as Element;

describe("timeFromClientX", () => {
  it("maps the left plot edge to t0 and the right edge to t1", () => {
    expect(timeFromClientX(target, g.plotLeft, g).getTime()).toBe(g.t0);
    expect(timeFromClientX(target, g.svgWidth - 16, g).getTime()).toBe(g.t1);
  });
  it("clamps clicks left of the plot to t0", () => {
    expect(timeFromClientX(target, 0, g).getTime()).toBe(g.t0);
  });
});
