import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

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
