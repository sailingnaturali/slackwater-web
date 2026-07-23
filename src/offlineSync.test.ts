import { describe, it, expect } from "vitest";
import { createOfflineSync, horizonAnchors, HORIZON_DAYS, type Loader } from "./offlineSync";
import { candidates } from "./place";
import { isChs, type ChsStation } from "./chsStations";

function fixture(id: string, series: "tide" | "current"): ChsStation {
  return {
    kind: "chs", series, provider: "chs", id, slug: id, name: id,
    context: "", latitude: 48, longitude: -123, aliases: [], timezone: "America/Vancouver",
  };
}
const okLoad: Loader = async () => ({});
const anchor0 = new Date("2026-07-23T12:00:00Z");
const stations = [fixture("chs-a", "tide"), fixture("chs-b", "current")];

describe("horizonAnchors", () => {
  it("steps every 2 days across the horizon (7 days → 4 anchors at 0,2,4,6)", () => {
    const a = horizonAnchors(anchor0);
    expect(a).toHaveLength(4);
    const dayMs = 24 * 60 * 60 * 1000;
    expect(a.map((d) => (d.getTime() - anchor0.getTime()) / dayMs)).toEqual([0, 2, 4, 6]);
    expect(HORIZON_DAYS).toBe(7);
  });
});

describe("prioritize", () => {
  it("orders jobs closest-first by distance to origin", () => {
    const at = (id: string, latitude: number, longitude: number) => ({
      ...fixture(id, "tide"),
      latitude,
      longitude,
    });
    const sync = createOfflineSync({
      load: okLoad,
      stations: [at("far", 60, -140), at("near", 48.5, -123.3), at("mid", 49.5, -124)],
    });
    sync.prioritize({ latitude: 48.5, longitude: -123.3 });
    expect(sync.snapshot().jobs.map((j) => j.station.id)).toEqual(["near", "mid", "far"]);
  });
});

describe("createOfflineSync", () => {
  it("enumerates exactly the isChs candidates by default", () => {
    const sync = createOfflineSync({ load: okLoad });
    const expected = candidates.filter(isChs).length;
    expect(sync.snapshot().total).toBe(expected);
    expect(sync.snapshot().jobs.every((j) => isChs(j.station))).toBe(true);
  });

  it("marks every station ready after a successful run", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    const s = sync.snapshot();
    expect(s.ready).toBe(2);
    expect(s.jobs.map((j) => j.status)).toEqual(["ready", "ready"]);
  });

  it("marks a station failed when its loader throws, others still complete", async () => {
    const load: Loader = async (station) => {
      if (station.id === "chs-a") throw new Error("offline");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    const byId = Object.fromEntries(sync.snapshot().jobs.map((j) => [j.station.id, j.status]));
    expect(byId["chs-a"]).toBe("failed");
    expect(byId["chs-b"]).toBe("ready");
  });

  it("pauseAll before start is a no-op run; jobs stay pending and paused is true", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    sync.pauseAll();
    await sync.start();
    expect(sync.snapshot().paused).toBe(true);
    expect(sync.snapshot().jobs.every((j) => j.status === "pending")).toBe(true);
  });

  it("pause(id) skips that station on run", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    sync.pause("chs-a");
    await sync.start();
    const byId = Object.fromEntries(sync.snapshot().jobs.map((j) => [j.station.id, j.status]));
    expect(byId["chs-a"]).toBe("paused");
    expect(byId["chs-b"]).toBe("ready");
  });

  it("restart(id) drives a failed station to ready", async () => {
    let fail = true;
    const load: Loader = async (station) => {
      if (station.id === "chs-a" && fail) throw new Error("x");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    expect(sync.snapshot().jobs.find((j) => j.station.id === "chs-a")!.status).toBe("failed");
    fail = false;
    await sync.restart("chs-a");
    expect(sync.snapshot().jobs.find((j) => j.station.id === "chs-a")!.status).toBe("ready");
  });

  it("resumeIncomplete re-runs only failed jobs", async () => {
    let fail = true;
    const load: Loader = async (station) => {
      if (station.id === "chs-b" && fail) throw new Error("x");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    fail = false;
    await sync.resumeIncomplete();
    expect(sync.snapshot().ready).toBe(2);
  });

  it("snapshot reference is stable between emits", async () => {
    const sync = createOfflineSync({ load: okLoad, now: () => anchor0, paceMs: 0, stations });
    const before = sync.snapshot();
    expect(sync.snapshot()).toBe(before);
    await sync.start();
    expect(sync.snapshot()).not.toBe(before);
  });

  it("restartAll retries failed jobs but skips ready ones (no wasted re-download)", async () => {
    let fail = true;
    let calls = 0;
    const load: Loader = async (station) => {
      calls++;
      if (station.id === "chs-a" && fail) throw new Error("x");
      return {};
    };
    const sync = createOfflineSync({ load, now: () => anchor0, paceMs: 0, stations });
    await sync.start();
    expect(sync.snapshot().jobs.find((j) => j.station.id === "chs-b")!.status).toBe("ready");
    fail = false;
    calls = 0;
    await sync.restartAll();
    // Only chs-a (failed) re-runs: 1 station × 4 horizon anchors = 4. chs-b (ready) is left alone.
    expect(calls).toBe(4);
    expect(sync.snapshot().ready).toBe(2);
  });

  it("resetAll re-queues every job, ready included (for clearCache after a wipe)", async () => {
    let reran = 0;
    const sync = createOfflineSync({
      load: async () => { reran++; return {}; },
      now: () => anchor0, paceMs: 0, stations,
    });
    await sync.start();
    reran = 0;
    await sync.resetAll();
    // 2 stations × 4 horizon anchors = 8 loader calls on a full re-queue.
    expect(reran).toBe(8);
  });
});
