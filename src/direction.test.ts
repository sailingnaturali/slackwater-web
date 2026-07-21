import { it, expect } from "vitest";
import { predict, predictRange, resolvedStations } from "./tides";

it("direction agrees with the next turn, even parked on an extreme", () => {
  const s = resolvedStations.find(x => x.slug === "friday-harbor")!;
  const extremes = predictRange(s, new Date("2026-07-21T12:00:00Z"), 1);
  for (const e of extremes) {
    // Stand exactly on the reported turn. The water is flat here, so a
    // sampled direction is a coin flip; the next turn is not.
    const state = predict(s, e.time);
    expect(state.next).not.toBeNull();
    expect(state.rising).toBe(state.next!.high);
  }
});
