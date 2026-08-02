/**
 * The map pins, as signed distance fields.
 *
 * Shape is station KIND — a wave for a current station, a dome over a datum
 * line for a tide station. That is the same language the list uses
 * (StationGlyph), redrawn for pin size: one wave instead of two, heavier
 * strokes, because the list glyph's 50%-opacity second stroke reads as a
 * smudge over bathymetry contours at 22px.
 *
 * Colour is not baked in. These are SDF images, so maplibre tints them with
 * `icon-color` (live state) and rings them with `icon-halo-color` — both of
 * which work on SDF icons only, which is why this file exists at all.
 *
 * The field is computed analytically: exact distance from each pixel to the
 * stroke centreline, minus half the stroke width. A canvas-rasterised path
 * would give a 1px alpha ramp — enough to tint, not enough to halo.
 */

export type PinKind = "current" | "tide";

export const PIN_IMAGE_ID: Record<PinKind, string> = {
  current: "pin-current",
  tide: "pin-tide",
};

/** Drawn at 2x so the 22px pin stays crisp on retina. */
export const PIN_PIXEL_RATIO = 2;

const SIZE = 22 * PIN_PIXEL_RATIO; // field is SIZE x SIZE
/** Distance spread, in field pixels, over which alpha ramps 255 -> 0. */
const SPREAD = 8;

type Pt = { x: number; y: number };
type Stroke = { points: Pt[]; width: number };

/** Sample a parametric curve into a polyline. */
function sample(n: number, f: (t: number) => Pt): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => f(i / n));
}

/**
 * One full sine period across the box — the current glyph. Same idea as the
 * app icon's signed-current curve, at pin scale.
 */
function currentStrokes(): Stroke[] {
  const S = SIZE;
  return [
    {
      width: 0.14 * S,
      points: sample(48, (t) => ({
        x: 0.1 * S + 0.8 * S * t,
        y: 0.5 * S - 0.26 * S * Math.sin(2 * Math.PI * t),
      })),
    },
  ];
}

/** A dome over a datum line — the tide glyph. The line is chart datum. */
function tideStrokes(): Stroke[] {
  const S = SIZE;
  return [
    {
      width: 0.14 * S,
      points: sample(48, (t) => ({
        x: 0.1 * S + 0.8 * S * t,
        y: 0.66 * S - 0.34 * S * Math.sin(Math.PI * t),
      })),
    },
    {
      width: 0.1 * S,
      points: [
        { x: 0.14 * S, y: 0.82 * S },
        { x: 0.86 * S, y: 0.82 * S },
      ],
    },
  ];
}

/** Shortest distance from p to segment ab. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment: fall back to point distance.
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Signed distance to the union of strokes: negative inside, positive outside. */
function signedDistance(p: Pt, strokes: Stroke[]): number {
  let best = Infinity;
  for (const s of strokes) {
    const half = s.width / 2;
    for (let i = 0; i < s.points.length - 1; i++) {
      const d = distToSegment(p, s.points[i], s.points[i + 1]) - half;
      if (d < best) best = d;
    }
  }
  return best;
}

export function pinGlyphImage(kind: PinKind): { width: number; height: number; data: Uint8Array } {
  const strokes = kind === "current" ? currentStrokes() : tideStrokes();
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = signedDistance({ x: x + 0.5, y: y + 0.5 }, strokes);
      // maplibre's SDF convention: 128 is the edge, higher is inside.
      const a = Math.round(255 * Math.max(0, Math.min(1, 0.5 - d / (2 * SPREAD))));
      const i = (y * SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
  }
  return { width: SIZE, height: SIZE, data };
}
