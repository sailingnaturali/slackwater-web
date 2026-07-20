import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The manifest promises icons; if they are missing the browser silently refuses
 * to offer "install to home screen", which is the entire point of this build.
 * That shipped once — hence a test rather than a note.
 */
describe("PWA assets", () => {
  const config = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
  const declared = [...config.matchAll(/src:\s*"([^"]+\.png)"/g)].map((m) => m[1]);

  it("declares icons", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("ships every icon the manifest declares", () => {
    for (const icon of new Set(declared)) {
      expect(existsSync(join(process.cwd(), "public", icon)), `missing public/${icon}`).toBe(true);
    }
  });
});
