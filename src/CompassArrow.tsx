import { compass16 } from "./chs/current";

/**
 * An arrow pointing toward a compass bearing — 0° points up (North) and it
 * rotates clockwise, so it reads as "the current sets this way". The glyph
 * inherits colour from its parent (the flood/ebb `.dir` classes); pass the
 * phase as `className` to tint it directly on the list cards.
 */
export function CompassArrow({ deg, className }: { deg: number; className?: string }) {
  return (
    <span
      className={className ? `compass-arrow ${className}` : "compass-arrow"}
      style={{ transform: `rotate(${deg}deg)` }}
      role="img"
      aria-label={`toward ${compass16(deg)}`}
    >
      ↑
    </span>
  );
}
