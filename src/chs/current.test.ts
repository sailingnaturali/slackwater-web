import { describe, it, expect, vi } from "vitest";
import {
  compass16, toCurrentState, withNowCurrent, chsCurrentDay, SLACK_KN,
} from "./current";
import { memoryCache } from "./cache";
import events from "./fixtures/active-pass-events.json";
import speeds from "./fixtures/active-pass-wcsp1.json";
import dirs from "./fixtures/active-pass-wcdp1.json";
import meta from "./fixtures/active-pass-metadata.json";
import type { IwlsSample, IwlsStationMeta } from "./client";
import type { ChsStation } from "../chsStations";

const FLOOD = 45, EBB = 225;
const ev = events as IwlsSample[], sp = speeds as IwlsSample[], di = dirs as IwlsSample[];

describe("compass16", () => {
  it("names the 16-point set for a bearing", () => {
    expect(compass16(45)).toBe("NE");
    expect(compass16(225)).toBe("SW");
    expect(compass16(0)).toBe("N");
    expect(compass16(360)).toBe("N");
  });
});

describe("toCurrentState", () => {
  const now = new Date("2026-07-23T05:00:00Z"); // mid-flood at Active Pass
  const state = toCurrentState(ev, sp, di, FLOOD, EBB, now);

  it("signs the curve so flood is positive and ebb negative", () => {
    // The day's peak flood is positive, its peak ebb negative — CHS's own extrema.
    expect(Math.max(...state.timeline.map((p) => p.signed))).toBeGreaterThan(3); // ~3.42 kn flood
    expect(Math.min(...state.timeline.map((p) => p.signed))).toBeLessThan(-3);   // ~−4.03 kn ebb
  });

  it("labels events slack / max-flood / max-ebb with speeds", () => {
    const kinds = new Set(state.events.map((e) => e.kind));
    expect(kinds).toEqual(new Set(["slack", "max-flood", "max-ebb"]));
    const slack = state.events.find((e) => e.kind === "slack")!;
    expect(slack.speed).toBe(0);
    const flood = state.events.find((e) => e.kind === "max-flood")!;
    expect(flood.speed).toBeGreaterThan(0);
  });

  it("reads flood at 05:00Z with the set toward NE", () => {
    expect(state.phase).toBe("flood");
    expect(state.signed).toBeGreaterThan(SLACK_KN);
    expect(compass16(state.setDegrees)).toBe("NE");
  });

  it("points nextSlack at the first slack after now, and following at the peak after it", () => {
    expect(state.nextSlack).not.toBeNull();
    expect(state.nextSlack!.time.getTime()).toBeGreaterThan(now.getTime());
    // 05:00Z → next slack 06:03Z, then the following peak is a max-ebb.
    expect(state.following?.kind).toBe("max-ebb");
  });
});

describe("withNowCurrent", () => {
  it("re-anchors the now-relative fields without refetching", () => {
    const base = toCurrentState(ev, sp, di, FLOOD, EBB, new Date("2026-07-23T05:00:00Z"));
    const later = withNowCurrent(base, new Date("2026-07-23T10:20:00Z")); // just past a max-ebb
    expect(later.timeline).toBe(base.timeline);            // fixed fields shared, not recomputed
    expect(later.nextSlack).not.toEqual(base.nextSlack);   // countdown target advanced
  });
});

describe("chsCurrentDay", () => {
  it("resolves by wcsp1, fetches events+speed+direction+meta, adapts to CurrentState", async () => {
    const stationList: IwlsStationMeta[] = [
      { id: "63aef09f84e5432cd3b6c509", officialName: "Active Pass",
        latitude: 48.8604, longitude: -123.3128, timeSeries: [{ code: "wcsp1" }, { code: "wcdp1" }] },
    ];
    const fetchFn = vi.fn(async (url: string) => {
      const body = url.includes("metadata") ? meta
        : url.includes("wcp1-events") ? ev
        : url.includes("wcdp1") ? di
        : sp;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const station: ChsStation = { kind: "chs", series: "current", provider: "chs", id: "chs-active-pass",
      slug: "chs-active-pass", name: "Active Pass", context: "", latitude: 48.8604,
      longitude: -123.3128, aliases: [], timezone: "America/Vancouver" };

    const now = new Date("2026-07-23T05:00:00Z");
    const state = await chsCurrentDay(station, now, { cache: memoryCache(), fetchFn, stationList });
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.floodDirection).toBe(45);
    expect(state.phase).toBe("flood");
  });
});
