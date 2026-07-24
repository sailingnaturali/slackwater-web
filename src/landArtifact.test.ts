import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The land layer is a committed artifact (the gdal/tippecanoe toolchain does
// not belong in CI for a file that changes ~never). This guards the two ways
// it can quietly rot: missing from the repo, or replaced by something that
// isn't a PMTiles archive.
describe("public/land.pmtiles", () => {
  it("exists and is a PMTiles v3 archive of plausible size", () => {
    const buf = readFileSync(join(__dirname, "..", "public", "land.pmtiles"));
    expect(buf.subarray(0, 7).toString("ascii")).toBe("PMTiles");
    expect(buf[7]).toBe(3); // spec version byte
    expect(buf.length).toBeGreaterThan(1_000_000);
    expect(buf.length).toBeLessThan(10_000_000);
  });
});
