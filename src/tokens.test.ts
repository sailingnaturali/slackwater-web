import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// import.meta.url resolves against jsdom's location (not file:) under this
// repo's default test environment, so read via __dirname like the other
// filesystem-guard tests (landArtifact.test.ts, pwa.test.ts) do.
const css = readFileSync(join(__dirname, "styles.css"), "utf8");

describe("design tokens", () => {
  it("defines the diverging direction axis and the go colour", () => {
    expect(css).toContain("--flood: #4a9fd8");
    expect(css).toContain("--ebb: #e8a33d");
    expect(css).toContain("--go: #88b868");
    expect(css).toContain("--rising: var(--flood)");
    expect(css).toContain("--falling: var(--ebb)");
  });

  it("has no display serif left to apply inconsistently", () => {
    expect(css).not.toContain("--font-display");
    expect(css).not.toContain("Fraunces");
  });

  it("uses the system stack", () => {
    expect(css).toContain("--font-sans: system-ui");
    expect(css).toContain("--font-mono: ui-monospace");
    expect(css).not.toContain("@fontsource");
  });

  it("raises faint ink to a 4.5:1 contrast", () => {
    expect(css).toContain("--ink-faint: #7d9cb8");
    // --sn-steel keeps its #5888a8 value — it is still the hover-border tone.
    // What must change is --ink-faint no longer pointing at it.
    expect(css).not.toContain("--ink-faint: var(--sn-steel)");
  });

  it("keeps no font size below the 14px floor except the 12px eyebrow", () => {
    // Sizes below 14px are the bug Brandon reported. Checks px as well as rem,
    // and collapses duplicates — several selectors legitimately share a size.
    const rem = [...css.matchAll(/font-size:\s*(\d*\.?\d+)rem/g)].map((m) => Number(m[1]));
    const px = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]) / 16);
    const belowFloor = [...new Set([...rem, ...px].filter((v) => v < 0.875))];
    expect(belowFloor).toEqual([0.75]); // the single .eyebrow exception, 12px
  });
});
