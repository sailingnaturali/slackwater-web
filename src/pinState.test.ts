import { describe, it, expect } from "vitest";
import { syncTone, resolvePinStates } from "./pinState";
import { memoryCache } from "./chs/cache";
import { resolvedStations } from "./tides";
import { resolvedNoaaCurrentStations } from "./noaaCurrents";
import { candidates } from "./place";
import { isChs } from "./chsStations";

const NOW = new Date("2026-08-01T12:00:00Z");

/** Offline by construction: no test may touch the network. */
const offline: typeof fetch = () => Promise.reject(new Error("offline"));

describe("syncTone", () => {
  it("resolves a bundled NOAA tide station to rising or falling", () => {
    const tone = syncTone(resolvedStations[0], NOW);
    expect(["rising", "falling"]).toContain(tone);
  });

  it("resolves a bundled NOAA current station to flood, ebb or slack", () => {
    const tone = syncTone(resolvedNoaaCurrentStations[0], NOW);
    expect(["flood", "ebb", "slack"]).toContain(tone);
  });

  it("returns unknown for a CHS station — its reading is not on-device", () => {
    const chs = candidates.find(isChs)!;
    expect(syncTone(chs, NOW)).toBe("unknown");
  });
});

describe("resolvePinStates", () => {
  it("resolves every bundled station and omits none silently", async () => {
    const bundled = [resolvedStations[0], resolvedNoaaCurrentStations[0]];
    const states = await resolvePinStates(bundled, NOW, { cache: memoryCache(), fetchFn: offline });
    expect(Object.keys(states).sort()).toEqual(bundled.map((s) => s.slug).sort());
    for (const tone of Object.values(states)) expect(tone).not.toBe("unknown");
  });

  it("reports unknown rather than guessing when the CHS cache misses", async () => {
    const chs = candidates.find(isChs)!;
    // Empty cache, no network: the adapter cannot serve a reading.
    const states = await resolvePinStates([chs], NOW, { cache: memoryCache(), fetchFn: offline });
    expect(states[chs.slug]).toBe("unknown");
  });

  it("never rejects — one station's failure must not blank the whole map", async () => {
    const chs = candidates.find(isChs)!;
    const mixed = [resolvedStations[0], chs];
    const states = await resolvePinStates(mixed, NOW, { cache: memoryCache(), fetchFn: offline });
    expect(Object.keys(states)).toHaveLength(2);
    // The bundled station still resolved despite its neighbour failing.
    expect(states[resolvedStations[0].slug]).not.toBe("unknown");
  });
});
