import { describe, it, expect, vi } from "vitest";
import { resolveStationId, RESOLVE_TOLERANCE_KM } from "./resolve";
import list from "./fixtures/stations-sample.json";
import type { IwlsStationMeta } from "./client";

const stations = list as IwlsStationMeta[];

describe("resolveStationId", () => {
  it("resolves a registry port to the nearest same-series station", () => {
    const id = resolveStationId(
      { latitude: 48.424, longitude: -123.371, name: "Victoria" }, stations, "wlp",
    );
    expect(id).toBe("5cebf1df3d0f4a073c4bbd1e");
  });

  it("ignores stations lacking the requested series", () => {
    // Active Pass is nearest here, but a wlp query must never resolve to a
    // current-only station: nearest wlp station is Victoria Harbour, ~48 km
    // away → beyond tolerance → throw, not a silent bind.
    expect(() =>
      resolveStationId({ latitude: 48.86, longitude: -123.31, name: "x" }, stations, "wlp"),
    ).toThrow();
  });

  it("throws when the nearest same-series station is beyond tolerance", () => {
    expect(() =>
      resolveStationId({ latitude: 49.5, longitude: -124.5, name: "nowhere" }, stations, "wlp"),
    ).toThrow(/tolerance/i);
  });

  it("a shortened name that is a substring does not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveStationId(
      { latitude: 48.424, longitude: -123.371, name: "Victoria" }, stations, "wlp",
    );
    expect(id).toBe("5cebf1df3d0f4a073c4bbd1e");
    expect(warn).not.toHaveBeenCalled(); // "Victoria" is a deliberate shortening of "Victoria Harbour"
    warn.mockRestore();
  });

  it("a genuinely unrelated name warns but still resolves by position", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = resolveStationId(
      { latitude: 48.424, longitude: -123.371, name: "Sidney" }, stations, "wlp",
    );
    expect(id).toBe("5cebf1df3d0f4a073c4bbd1e"); // position wins
    expect(warn).toHaveBeenCalled(); // "Sidney" is unrelated to "Victoria Harbour"
    warn.mockRestore();
  });
});
