/**
 * The map pins, as signed distance fields.
 *
 * Shape is station KIND — a plain cartographic marker, one silhouette per
 * feature class: a filled circle for a current station, a filled square for
 * a tide station. Squares and circles differ in silhouette (corners vs none),
 * which is visible at any size and in peripheral vision — unlike the list's
 * wave/dome glyphs (`StationGlyph`), whose thin curved strokes read as clutter
 * over bathymetry contours at pin size on a dense chart. The two surfaces
 * deliberately no longer share a mark; see
 * `docs/superpowers/specs/2026-08-01-map-pin-glyphs-design.md` §1.
 *
 * Colour is not baked in. These are SDF images, so maplibre tints them with
 * `icon-color` (live state) and rings them with `icon-halo-color` — both of
 * which work on SDF icons only, which is why this file exists at all.
 *
 * The field is computed analytically: exact signed distance from each pixel
 * to the filled shape (negative inside, positive outside). A canvas-rasterised
 * path would give a 1px alpha ramp — enough to tint, not enough to halo.
 */

export type PinKind = "current" | "tide";

export const PIN_IMAGE_ID: Record<PinKind, string> = {
  current: "pin-current",
  tide: "pin-tide",
};

/** Drawn at 2x so the 22px pin stays crisp on retina. */
export const PIN_PIXEL_RATIO = 2;

const SIZE = 22 * PIN_PIXEL_RATIO; // field is SIZE x SIZE

/**
 * maplibre's SDF constants, not ours to choose. An icon-only symbol layer runs
 * `symbolSDFFrag`, which thresholds the icon fill at
 * `inner_edge = (256 - 64) / 256 = 0.75` over a field authored with
 * `SDF_PX = 8` texture pixels — so the shape edge encodes at 0.75 (~191), not
 * at the 0.5 an intuitive signed-distance encoding would use. Encode the edge
 * at 0.5 and the whole glyph sits below the shader's threshold and renders
 * invisible, however correct the geometry is. Matches `@mapbox/tiny-sdf`'s
 * `cutoff = 0.25`.
 */
const SDF_PX = 8;
const SDF_CUTOFF = 0.25;

type Pt = { x: number; y: number };

const CENTER: Pt = { x: SIZE / 2, y: SIZE / 2 };

/** Circle radius — the current-station mark. */
const CIRCLE_R = 0.34 * SIZE;

/**
 * Square half-extent — the tide-station mark. Sized so the square's AREA
 * matches the circle's, not its width: a square drawn to the circle's
 * diameter always looks heavier than the circle because of its corners, so
 * equal area (not equal width) is what reads as equal visual weight. Works
 * out to a side length ≈0.89× the circle's diameter — "slightly smaller",
 * as the spec calls for.
 */
const SQUARE_B = (CIRCLE_R * Math.sqrt(Math.PI)) / 2;

/** Signed distance to a filled circle: negative inside, positive outside. */
function circleDistance(p: Pt): number {
  return Math.hypot(p.x - CENTER.x, p.y - CENTER.y) - CIRCLE_R;
}

/** Signed distance to a filled axis-aligned square of half-extent SQUARE_B. */
function squareDistance(p: Pt): number {
  const dx = Math.abs(p.x - CENTER.x) - SQUARE_B;
  const dy = Math.abs(p.y - CENTER.y) - SQUARE_B;
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

export function pinGlyphImage(kind: PinKind): { width: number; height: number; data: Uint8Array } {
  const distance = kind === "current" ? circleDistance : squareDistance;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = distance({ x: x + 0.5, y: y + 0.5 });
      // 255 * (1 - cutoff - d/SDF_PX): edge (d=0) lands at ~191, the interior
      // saturates to 255, and the field reaches 0 at 6px outside the shape.
      const a = Math.round(255 * Math.max(0, Math.min(1, 1 - SDF_CUTOFF - d / SDF_PX)));
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  return { width: SIZE, height: SIZE, data };
}
