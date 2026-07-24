import { describe, expect, it } from "vitest";
import { toSlug } from "@sailingnaturali/station-corrections";
import {
  assignSlug,
  isNoaaCurrent,
  noaaCurrentState,
  resolvedNoaaCurrentStations,
  type NoaaCurrentStation,
} from "./noaaCurrents";
import { resolvedStations } from "./tides";
import { chsStations, chsCurrentStations } from "./chsStations";

// A pure M2 station: signed velocity is a ~12h25m sinusoid, so slacks come
// every ~6h12m and floods/ebbs alternate between them. Everything below is
// checkable by construction.
const m2: NoaaCurrentStation = {
  kind: "noaa-current",
  id: "noaa/TEST001",
  name: "Test Pass",
  latitude: 48.4,
  longitude: -122.7,
  timezone: "America/Los_Angeles",
  floodDirection: 40,
  ebbDirection: 220,
  meanFlow: 0,
  constituents: [{ name: "M2", amplitude: 2, phase: 0 }],
};
const NOW = new Date("2026-07-23T12:00:00-07:00");

describe("noaaCurrentState", () => {
  it("emits a CurrentState with timeline, alternating events, and no derived flag", () => {
    const s = noaaCurrentState(m2, NOW);
    expect(s.derived).toBeUndefined();
    expect(s.timeline.length).toBeGreaterThan(300); // 60h at 600s
    const slacks = s.events.filter((e) => e.kind === "slack");
    expect(slacks.length).toBeGreaterThanOrEqual(8); // ~9-10 in 60h
    // Slack spacing for M2 is half its 12.42h period.
    for (let i = 1; i < slacks.length; i++) {
      const gapMin = (slacks[i].time.getTime() - slacks[i - 1].time.getTime()) / 60000;
      expect(Math.abs(gapMin - 372.7)).toBeLessThan(10);
    }
    // Between consecutive slacks sits exactly one max, alternating flood/ebb.
    const maxes = s.events.filter((e) => e.kind !== "slack");
    for (let i = 1; i < maxes.length; i++) expect(maxes[i].kind).not.toBe(maxes[i - 1].kind);
    // The predictor applies a real lunar-node (nodal) correction to M2 amplitude
    // (f_M2 = 1 - 0.037*cos(N), up to ~3.7% at this fixed NOW date) — a physical
    // effect, not a mapping bug, so the tolerance is widened past toBeCloseTo(2,1)'s
    // 0.05 to accommodate it while still catching a genuinely wrong magnitude.
    for (const m of maxes) expect(Math.abs(m.speed! - 2)).toBeLessThan(0.1);
  });

  it("derives phase and set from the signed velocity at now", () => {
    const s = noaaCurrentState(m2, NOW);
    expect(["flood", "ebb", "slack"]).toContain(s.phase);
    if (s.phase === "flood") expect(s.setDegrees).toBe(40);
    if (s.phase === "ebb") expect(s.setDegrees).toBe(220);
    expect(s.speed).toBeCloseTo(Math.abs(s.signed), 5);
  });

  it("a mean flow stronger than the harmonics never slacks and never floods", () => {
    const ebbing = { ...m2, meanFlow: -3, constituents: [{ name: "M2", amplitude: 1, phase: 0 }] };
    const s = noaaCurrentState(ebbing, NOW);
    expect(s.events.filter((e) => e.kind === "slack")).toHaveLength(0);
    expect(s.events.filter((e) => e.kind === "max-flood")).toHaveLength(0);
    // The signed curve's local highs are weakest-ebb wiggles, not floods —
    // they must be dropped, not mislabelled.
    expect(s.events.every((e) => e.kind === "max-ebb")).toBe(true);
    expect(s.phase).toBe("ebb");
  });
});

describe("resolvedNoaaCurrentStations", () => {
  it("resolves identity for every bundled station", () => {
    expect(resolvedNoaaCurrentStations.length).toBeGreaterThan(0);
    for (const s of resolvedNoaaCurrentStations) {
      expect(isNoaaCurrent(s)).toBe(true);
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("pins the real Alki Point ladder outcome (catches a re-sort silently reassigning public slugs)", () => {
    // Two real bundled stations share the "Alki Point" name, disambiguated
    // only by context (see assignSlug). Pinned to actual output from the
    // build pipeline, not constructed — a locale-dependent or otherwise
    // reordered sort in build-currents.mjs would flip which one gets the
    // bare slug without any other test catching it (currents.json is
    // gitignored, so there's no tracked diff to notice either).
    const oneMileWest = resolvedNoaaCurrentStations.find((s) => s.id === "noaa/PUG1502")!;
    const west = resolvedNoaaCurrentStations.find((s) => s.id === "noaa/PUG1516")!;
    expect(oneMileWest.slug).toBe("alki-point");
    expect(west.slug).toBe("alki-point-current");
  });

  it("never collides a slug with any other station the app can name", () => {
    const others = new Set([
      ...resolvedStations.map((s) => s.slug),
      ...chsStations.map((s) => s.slug),
      ...chsCurrentStations.map((s) => s.slug),
    ]);
    const seen = new Set<string>();
    for (const s of resolvedNoaaCurrentStations) {
      expect(others.has(s.slug)).toBe(false);
      expect(seen.has(s.slug)).toBe(false);
      seen.add(s.slug);
    }
  });
});

describe("assignSlug", () => {
  it("pins the ladder order: exact slug, then -current, then the qualifier folded in", () => {
    // Rung 2 (`${slug}-current`) is itself a single fixed string per base slug,
    // so it resolves a *second* colliding entry same as rung 1 resolves the
    // first — it takes a *third* same-slug entry to fall through to rung 3.
    // Three entries is what actually exercises rungs 1, 2, and 3 in order.
    const used = new Set<string>();
    const a = assignSlug(
      { slug: "alki-point", name: "Alki Point", context: "1 mile West of" },
      "noaa/PUG1502",
      used,
    );
    const b = assignSlug(
      { slug: "alki-point", name: "Alki Point", context: "West of" },
      "noaa/PUG1516",
      used,
    );
    const c = assignSlug(
      { slug: "alki-point", name: "Alki Point", context: "near the ferry dock" },
      "noaa/PUG1599",
      used,
    );
    expect(a).toBe("alki-point"); // rung 1: no collision yet
    expect(b).toBe("alki-point-current"); // rung 2: rung 1 taken
    expect(c).toBe(toSlug("Alki Point near the ferry dock")); // rung 3: rungs 1 and 2 taken
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("falls all the way to the id-suffixed slug when even the qualifier collides", () => {
    const used = new Set(["x", "x-current", toSlug("X same context")]);
    const d = assignSlug({ slug: "x", name: "X", context: "same context" }, "noaa/PUG9999", used);
    expect(d).toBe("x-pug9999");
  });
});
