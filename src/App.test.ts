import { describe, it, expect } from "vitest";
import { heldWhileLoading } from "./App";

// The date-nav hold: paging a CHS day refetches, and without this the whole view
// blanks to "Loading" for the fetch. heldWhileLoading keeps the previous day on
// screen while the next one loads — but must NOT hold across a station switch
// (a real reload) or a failed fetch (show the honest offline copy).
describe("heldWhileLoading", () => {
  const t0 = new Date("2026-07-23T12:00:00Z");
  const t1 = new Date("2026-07-24T12:00:00Z");

  it("passes a present state straight through and remembers it", () => {
    const ref = { current: null };
    expect(heldWhileLoading(ref, "today", t0, "chs-victoria", false)).toEqual({ state: "today", now: t0 });
    expect(ref.current).toEqual({ state: "today", now: t0, stationId: "chs-victoria" });
  });

  it("holds the previous day while the paged-to day loads", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "today", t0, "chs-victoria", false); // seed
    // Now loading the next day (state null) — keep showing the previous day.
    expect(heldWhileLoading(ref, null, t1, "chs-victoria", true)).toMatchObject({ state: "today", now: t0 });
  });

  it("drops the hold when the fetch fails (not loading) so the offline copy shows", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "today", t0, "chs-victoria", false); // seed
    expect(heldWhileLoading(ref, null, t1, "chs-victoria", false)).toBeNull();
  });

  it("does not hold across a station switch — that's a real reload, not a page", () => {
    const ref = { current: null };
    heldWhileLoading(ref, "victoria-day", t0, "chs-victoria", false); // seed
    // A different station is loading: must not flash Victoria's chart under it.
    expect(heldWhileLoading(ref, null, t1, "chs-nanaimo", true)).toBeNull();
  });
});
