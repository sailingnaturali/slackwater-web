import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist", "assets");

describe("built bundle", () => {
  it("has been built", () => {
    // Guard against a false pass: an absent dist would make every check below
    // vacuously true, which is exactly how a blank page ships.
    expect(existsSync(DIST), "run `npm run build` first").toBe(true);
  });

  it("never reaches for a Node builtin", () => {
    // This is the check that would have caught the fileURLToPath crash.
    // Node builtins only. createBundledResolver was on this list while it read
// files; since station-corrections 1.3.0 it imports compiled JSON and is
// browser-safe, so forbidding the name would now fail on correct code.
    const forbidden = ["fileURLToPath", "node:fs", "node:url", "node:path"];
    for (const file of readdirSync(DIST).filter((f) => f.endsWith(".js"))) {
      const source = readFileSync(join(DIST, file), "utf8");
      for (const token of forbidden) {
        expect(source.includes(token), `${file} references ${token}`).toBe(false);
      }
    }
  });
});
