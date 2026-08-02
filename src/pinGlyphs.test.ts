import { describe, it, expect } from "vitest";
import { pinGlyphImage, PIN_IMAGE_ID, PIN_PIXEL_RATIO } from "./pinGlyphs";

const alphaAt = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3];

describe("pinGlyphImage", () => {
  it("produces a square RGBA buffer of the declared size", () => {
    const img = pinGlyphImage("current");
    expect(img.width).toBe(img.height);
    expect(img.data.length).toBe(img.width * img.height * 4);
  });

  it("encodes a signed distance field, not a coverage mask", () => {
    // A coverage mask is almost entirely 0 or 255. A distance field has a
    // broad ramp of intermediate values around the shape's edge.
    const { data } = pinGlyphImage("current");
    const alphas = [];
    for (let i = 3; i < data.length; i += 4) alphas.push(data[i]);
    const midtones = alphas.filter((a) => a > 40 && a < 215).length;
    expect(midtones).toBeGreaterThan(alphas.length * 0.15);
  });

  it("puts the shape edge at maplibre's 0.75 threshold, and saturates inside", () => {
    const img = pinGlyphImage("tide");
    const mid = Math.floor(img.width / 2);
    // maplibre's SDF shader thresholds the icon fill at 192/256 = 0.75
    // (verified in maplibre-gl 5.24.0 — an icon-only symbol layer runs
    // `symbolSDFFrag`: `inner_edge=(256.0-64.0)/256.0`), so the shape
    // edge must encode at ~191 and the interior must exceed it — reaching 255,
    // or the shape renders thin-to-invisible however correct the geometry is.
    expect(alphaAt(img, 0, 0)).toBe(0); // corner: far outside the shape
    const column = [];
    for (let y = 0; y < img.height; y++) column.push(alphaAt(img, mid, y));
    expect(Math.max(...column)).toBe(255);
    expect(column.some((a) => a > 180 && a < 205)).toBe(true); // the edge band
  });

  it("draws different shapes for the two kinds", () => {
    const a = pinGlyphImage("current");
    const b = pinGlyphImage("tide");
    expect(Buffer.from(a.data)).not.toEqual(Buffer.from(b.data));
  });

  it("gives the tide mark corners the current mark doesn't have", () => {
    // A square's corner reaches further from centre than a circle's radius
    // does at the same 45° angle, because the circle is inscribed inside the
    // square's silhouette. So a point on the diagonal, offset just past the
    // circle's radius/√2 but still short of the square's half-extent, sits
    // outside the circle but inside the square — the corner, made visible as
    // "one renders here, the other doesn't" at maplibre's fill threshold
    // (~191, per the test above) rather than merely "the two buffers differ".
    const current = pinGlyphImage("current");
    const tide = pinGlyphImage("tide");
    const mid = Math.floor(current.width / 2);
    const offset = Math.round(0.27 * current.width);
    const x = mid + offset;
    const y = mid + offset;
    expect(alphaAt(current, x, y)).toBeLessThan(191); // outside the circle: unfilled
    expect(alphaAt(tide, x, y)).toBeGreaterThan(191); // inside the square: filled
  });

  it("names one image id per kind", () => {
    expect(PIN_IMAGE_ID.current).toBe("pin-current");
    expect(PIN_IMAGE_ID.tide).toBe("pin-tide");
    expect(PIN_PIXEL_RATIO).toBe(2);
  });
});
