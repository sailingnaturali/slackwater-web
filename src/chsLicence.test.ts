import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { chsCurrentStations } from "./chsStations";

describe("no CHS data is bundled", () => {
  it("src/data holds no CHS-provider records", () => {
    for (const f of readdirSync("src/data")) {
      const text = readFileSync(`src/data/${f}`, "utf8");
      // The bundled tide set is NOAA public-domain only; a CHS provider tag here
      // would mean CHS predictions leaked into the shipped bundle.
      expect(text).not.toMatch(/"provider"\s*:\s*"chs"/);
    }
  });

  it("chsStations carry no predictions — identity only", async () => {
    const { chsStations } = await import("./chsStations");
    for (const s of chsStations) {
      expect(s).not.toHaveProperty("constituents");
    }
  });
});

describe("current gates are identity only", () => {
  it("carry no constituents, no predictions, no provider id", () => {
    for (const g of chsCurrentStations) {
      expect(g).not.toHaveProperty("constituents");
      expect(g).not.toHaveProperty("floodDirection"); // that comes from IWLS at runtime, never bundled
      expect(g.provider).toBe("chs");
    }
  });
});
