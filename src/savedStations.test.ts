import { describe, it, expect, beforeEach } from "vitest";
import {
  loadSaved,
  star,
  unstar,
  visit,
  forget,
  rememberLocation,
  setPlaceStation,
  getPlaceStation,
  RECENT_LIMIT,
  STARRED_LIMIT,
} from "./savedStations";

beforeEach(() => localStorage.clear());

describe("saved stations", () => {
  it("starts empty", () => {
    expect(loadSaved()).toEqual({ starred: [], recent: [], lastLocationSlug: null, placeStations: {} });
  });

  it("stars and un-stars", () => {
    expect(star("everett").starred).toEqual(["everett"]);
    expect(unstar("everett").starred).toEqual([]);
  });

  it("drops an un-starred station to recent rather than losing it", () => {
    star("everett");
    const after = unstar("everett");
    expect(after.starred).toEqual([]);
    expect(after.recent).toContain("everett");
  });

  it("removes from recent entirely - recent is the bottom of the chain", () => {
    visit("everett");
    expect(forget("everett").recent).toEqual([]);
  });

  it("orders recent by recency, most recent first", () => {
    visit("everett");
    visit("cherry-point");
    expect(visit("everett").recent[0]).toBe("everett");
  });

  it("never lists a station twice in recent", () => {
    visit("everett");
    const after = visit("everett");
    expect(after.recent.filter((s) => s === "everett").length).toBe(1);
  });

  it(`caps recent at ${RECENT_LIMIT}`, () => {
    for (let i = 0; i < RECENT_LIMIT + 3; i++) visit(`station-${i}`);
    const saved = loadSaved();
    expect(saved.recent.length).toBe(RECENT_LIMIT);
    // The oldest fell off, the newest is first.
    expect(saved.recent[0]).toBe(`station-${RECENT_LIMIT + 2}`);
    expect(saved.recent).not.toContain("station-0");
  });

  it("keeps a starred station out of recent", () => {
    // It is already shown above; listing it twice is noise.
    star("everett");
    expect(visit("everett").recent).not.toContain("everett");
  });

  it("drops the previous location to recent when location changes", () => {
    rememberLocation("everett");
    const after = rememberLocation("cherry-point");
    expect(after.lastLocationSlug).toBe("cherry-point");
    expect(after.recent).toContain("everett");
  });

  it("does not touch recent when the location has not changed", () => {
    rememberLocation("everett");
    expect(rememberLocation("everett").recent).toEqual([]);
  });

  it("survives a corrupted store rather than throwing", () => {
    localStorage.setItem("slackwater.saved", "{ not json");
    expect(loadSaved()).toEqual({ starred: [], recent: [], lastLocationSlug: null, placeStations: {} });
  });

  it("sets and gets a place's station choice", () => {
    expect(getPlaceStation("Victoria")).toBeNull();
    setPlaceStation("Victoria", "victoria-inner-harbour");
    expect(getPlaceStation("Victoria")).toBe("victoria-inner-harbour");
  });

  it("keeps one place's choice from leaking into another's", () => {
    setPlaceStation("Victoria", "victoria-inner-harbour");
    expect(getPlaceStation("Seattle")).toBeNull();
  });

  it("survives a corrupted placeStations value rather than throwing", () => {
    localStorage.setItem("slackwater.saved", JSON.stringify({ placeStations: ["not", "a", "map"] }));
    expect(loadSaved().placeStations).toEqual({});
  });

  it(`keeps every star past ${STARRED_LIMIT} — storage is unbounded, only display is capped`, () => {
    for (let i = 0; i < STARRED_LIMIT + 1; i++) star(`star-${i}`);
    const after = loadSaved();

    expect(after.starred.length).toBe(STARRED_LIMIT + 1);
    expect(after.starred).toContain("star-0");
    expect(after.starred).toContain(`star-${STARRED_LIMIT}`);
  });

  it("does not move anything to recent when starring past the display limit", () => {
    for (let i = 0; i < STARRED_LIMIT + 1; i++) star(`star-${i}`);
    expect(loadSaved().recent).toEqual([]);
  });

  it("still de-duplicates the starred list", () => {
    star("everett");
    const after = star("everett");
    expect(after.starred).toEqual(["everett"]);
  });
});
