import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// jsdom has no WebGL; the real render is exercised by scripts/smoke.mjs (M5).
// What CAN be pinned here: the module lazy-loads without touching maplibre at
// import time (the whole point of the dynamic import), and the escape hatch
// works without a map ever mounting.
vi.mock("maplibre-gl", () => ({
  default: { Map: vi.fn(), addProtocol: vi.fn(), AttributionControl: vi.fn(), NavigationControl: vi.fn() },
}));
vi.mock("pmtiles", () => ({ Protocol: vi.fn(() => ({ tile: vi.fn() })) }));

describe("MapScreen module", () => {
  it("exports a component as default", async () => {
    const mod = await import("./MapScreen");
    expect(typeof mod.default).toBe("function");
  });

  it("resolves pin states cache-only — never fetching", () => {
    // Guarded by source text because nothing else can catch it: jsdom has no
    // WebGL so the map never mounts, and dropping the fetchFn leaves tsc, the
    // suite, the build and the smoke test all green while every map open fires
    // one live request per unsynced CHS station at a third-party API.
    // import.meta.url resolves against jsdom's location under this repo's test
    // environment — read via __dirname instead (see tokens.test.ts).
    const src = readFileSync(join(__dirname, "MapScreen.tsx"), "utf8");
    const call = src.match(/resolvePinStates\([\s\S]*?\)\s*\n\s*\.then/);
    expect(call, "resolvePinStates call site not found").toBeTruthy();
    expect(call![0]).toContain("fetchFn");
  });
});
