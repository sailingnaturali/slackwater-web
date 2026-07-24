import { describe, it, expect } from "vitest";
import {
  stations,
  predict,
  extremesOn,
  matchStation,
  distanceKm,
  localDay,
  m2SpreadMinutes,
} from "./tides";

const fridayHarbor = stations.find((s) => /friday harbor/i.test(s.name))!;
const noon = new Date("2026-07-20T19:00:00Z");

describe("bundled data", () => {
  it("ships only redistributable stations", () => {
    // The licence filter lives in the build script; this is the guard that it
    // ran. A cc-by-4.0 (TICON-derived) station reaching the bundle would be a
    // redistribution problem, not a display bug.
    expect(stations.length).toBeGreaterThan(20);
    for (const station of stations) {
      expect(station.constituents.length).toBeGreaterThan(0);
      expect(station.source).toMatch(/National Oceanic/i);
    }
  });

  it("gives every station what it needs to be predicted", () => {
    for (const station of stations) {
      expect(station.constituents.some((c) => c.name === "M2")).toBe(true);
      expect(Number.isFinite(station.datumOffset)).toBe(true);
      expect(station.timezone).toBeTruthy();
    }
  });
});

describe("predict", () => {
  it("produces a plausible Friday Harbor tide", () => {
    const state = predict(fridayHarbor, noon);
    // Friday Harbor runs roughly -0.6 to 3.4 m above MLLW.
    expect(state.level).toBeGreaterThan(-1.5);
    expect(state.level).toBeLessThan(4.5);
    expect(state.next).not.toBeNull();
    expect(state.timeline.length).toBeGreaterThan(100);
  });

  it("alternates highs and lows", () => {
    const state = predict(fridayHarbor, noon);
    expect(state.extremes.length).toBeGreaterThan(4);
    for (let i = 1; i < state.extremes.length; i++) {
      expect(state.extremes[i].high).toBe(!state.extremes[i - 1].high);
    }
  });

  it("agrees with itself about direction", () => {
    // The arrow and the curve must never contradict: if it says rising, the
    // next extreme has to be a high.
    for (const hours of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const at = new Date(noon.getTime() + hours * 3_600_000);
      const state = predict(fridayHarbor, at);
      expect(state.next!.high).toBe(state.rising);
    }
  });

  it("reports the day's extremes in the station's own timezone", () => {
    const state = predict(fridayHarbor, noon);
    const today = extremesOn(state, noon, fridayHarbor.timezone);
    expect(today.length).toBeGreaterThanOrEqual(2);
    expect(today.length).toBeLessThanOrEqual(4);
  });

  it("puts each high above the lows on either side of it", () => {
    // Not "every high above every low": the Salish Sea is mixed semidiurnal, so
    // the day's lower high water routinely sits below its higher low water.
    // That is diurnal inequality, and it is the whole reason this coast needs
    // four numbers a day rather than two.
    const { extremes } = predict(fridayHarbor, noon);
    for (let i = 1; i < extremes.length; i++) {
      const [earlier, later] = [extremes[i - 1], extremes[i]];
      if (later.high) expect(later.level).toBeGreaterThan(earlier.level);
      else expect(later.level).toBeLessThan(earlier.level);
    }
  });

  it("spans the whole local day however late 'now' is", () => {
    // The chart's horizontal domain is the day's own timeline points. Anchoring
    // the window at now-18h clipped the morning once now passed ~18:00 local, so
    // the plotted curve rescaled (03:42→24:00 instead of 00:00→24:00) as you
    // scrubbed the readout line late. The day must stay whole regardless of now.
    const tz = fridayHarbor.timezone;
    const daySpanHours = (now: Date) => {
      const pts = predict(fridayHarbor, now).timeline.filter(
        (p) => localDay(p.time, tz) === localDay(now, tz),
      );
      return (pts[pts.length - 1].time.getTime() - pts[0].time.getTime()) / 3_600_000;
    };
    // Same local day (America/Vancouver, PDT = UTC-7 in July), morning vs night.
    const morning = new Date("2026-07-22T09:00:00Z"); // 02:00 local
    const night = new Date("2026-07-23T06:00:00Z"); // 23:00 local, same day
    expect(localDay(morning, tz)).toBe(localDay(night, tz));
    expect(daySpanHours(morning)).toBeGreaterThan(23);
    expect(daySpanHours(night)).toBeGreaterThan(23);
  });
});

describe("matchStation", () => {
  it("snaps to the station you are standing on", () => {
    const match = matchStation(fridayHarbor)!;
    expect(match.station.id).toBe(fridayHarbor.id);
    expect(match.distanceKm).toBeLessThan(0.5);
    expect(match.quality).toBe("good");
  });

  it("hedges when the position is far from any station", () => {
    // Mid-Pacific: the nearest bundled station is thousands of km away.
    const match = matchStation({ latitude: 30, longitude: -160 })!;
    expect(match.quality).toBe("nearest");
  });

  it("does not claim a good match where the tide varies across the area", () => {
    // Bellingham: the point of the gradient check. Stations around here differ
    // enough in M2 phase that a confident snap would be misleading.
    const match = matchStation({ latitude: 48.75, longitude: -122.48 })!;
    expect(match.quality).not.toBe("good");
  });
});

describe("m2SpreadMinutes", () => {
  it("ignores a NOAA current station's velocity-M2 phase", () => {
    // A current station's M2 phase describes the velocity zero-crossing, not
    // the tide-height turn — mixing it into a height-phase spread must not
    // move the number at all, same as if the entry were absent.
    const pool = stations.slice(0, 3);
    const withoutCurrent = m2SpreadMinutes(pool);
    const currentStation = {
      kind: "noaa-current",
      constituents: [{ name: "M2", phase: 300 }],
    };
    const withCurrent = m2SpreadMinutes([...pool, currentStation]);
    expect(withCurrent).toBe(withoutCurrent);
  });
});

describe("distanceKm", () => {
  it("measures a known separation", () => {
    // Friday Harbor to Bellingham is about 40 km.
    const distance = distanceKm(
      { latitude: 48.546, longitude: -123.013 },
      { latitude: 48.75, longitude: -122.48 },
    );
    expect(distance).toBeGreaterThan(35);
    expect(distance).toBeLessThan(50);
  });
});
