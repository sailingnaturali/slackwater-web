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
});
