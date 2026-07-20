import { describe, it, expect } from "vitest";
import { stationName, fixCase } from "./stationName";
import { stations } from "./tides";

describe("fixCase", () => {
  it("calms names that shout", () => {
    expect(fixCase("CHERRY POINT")).toBe("Cherry Point");
    expect(fixCase("PORT TOWNSEND")).toBe("Port Townsend");
  });

  it("leaves human-cased names alone", () => {
    // These carry capitalisation we could not reconstruct if we flattened them.
    expect(fixCase("Spee-Bi-Dah")).toBe("Spee-Bi-Dah");
    expect(fixCase("La Push, Quillayute River")).toBe("La Push, Quillayute River");
    expect(fixCase("Friday Harbor")).toBe("Friday Harbor");
  });

  it("keeps acronyms that are not shouting", () => {
    expect(fixCase("NAS Whidbey Island")).toBe("NAS Whidbey Island");
  });

  it("re-cases hyphenated shouting correctly", () => {
    expect(fixCase("SPEE-BI-DAH")).toBe("Spee-Bi-Dah");
  });
});

describe("stationName", () => {
  it("splits the place from its context", () => {
    const name = stationName("Friday Harbor, San Juan Island");
    expect(name.primary).toBe("Friday Harbor");
    expect(name.context).toBe("San Juan Island");
  });

  it("keeps a bare name bare", () => {
    expect(stationName("Everett")).toEqual({ primary: "Everett", context: "", full: "Everett" });
  });

  it("drops the qualifier that says nothing", () => {
    // Almost everything here is in Puget Sound; saying so is not context.
    const name = stationName("WALDRON ISLAND, PUGET SOUND");
    expect(name.primary).toBe("Waldron Island");
    expect(name.context).toBe("");
  });

  it("expands the abbreviations that read badly", () => {
    expect(stationName("Swinomish Channel ent., Padilla Bay").primary).toBe(
      "Swinomish Channel Entrance",
    );
    expect(stationName("Hanbury Point, Mosquito Pass, San Juan I.").context).toBe(
      "Mosquito Pass · San Juan Island",
    );
    expect(stationName("Deception Pass St. Park, Bowman Bay, Fidalgo I.").primary).toBe(
      "Deception Pass State Park",
    );
  });

  it("handles the worst real name we ship", () => {
    const name = stationName("SEATTLE (Madison St.), Elliott Bay");
    expect(name.primary).toBe("Seattle (Madison St.)");
    expect(name.context).toBe("Elliott Bay");
  });

  it("leaves no station shouting or empty", () => {
    for (const station of stations) {
      const name = stationName(station.name);
      expect(name.primary.length).toBeGreaterThan(1);
      const letters = name.primary.replace(/[^A-Za-z]/g, "");
      expect(letters).not.toBe(letters.toUpperCase());
    }
  });
});
