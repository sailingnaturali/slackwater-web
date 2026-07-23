import { useEffect, useState, type PointerEvent } from "react";

export interface ScrubGeometry {
  plotLeft: number;
  plotWidth: number;
  svgWidth: number;
  t0: number;
  t1: number;
}

export interface Scrub {
  scrub: Date | null;
  dragging: boolean;
  reset: () => void;
  handlers: {
    onPointerDown: (e: PointerEvent<SVGRectElement>) => void;
    onPointerMove: (e: PointerEvent<SVGRectElement>) => void;
    onPointerUp: (e: PointerEvent<SVGRectElement>) => void;
    onPointerLeave: () => void;
  };
}

export function timeFromClientX(target: Element, clientX: number, g: ScrubGeometry): Date {
  const rect = target.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / rect.width) * g.svgWidth;
  const clamped = Math.min(Math.max(svgX, g.plotLeft), g.plotLeft + g.plotWidth);
  const frac = (clamped - g.plotLeft) / g.plotWidth;
  return new Date(g.t0 + frac * (g.t1 - g.t0));
}

/**
 * Pointer-driven scrub/preview machinery, lifted out of TideChart so
 * CurrentChart can reuse it verbatim: local per-pixel preview state distinct
 * from the parent's `now` (which updates only on release), parameterised by
 * plot geometry and a caller-supplied turn-snap.
 */
export function useScrub(geometry: ScrubGeometry, snap: (raw: Date) => Date, onCommit: (t: Date) => void): Scrub {
  const [scrub, setScrub] = useState<Date | null>(null);
  const [dragging, setDragging] = useState(false);
  const reset = () => setScrub(null);

  return {
    scrub, dragging, reset,
    handlers: {
      onPointerDown(e) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setScrub(timeFromClientX(e.currentTarget, e.clientX, geometry));
      },
      onPointerMove(e) {
        // Touch has no hover, so an untouched pointermove there is a no-op
        // anyway; the check just keeps that explicit for a mouse, which does.
        if (!dragging && e.pointerType !== "mouse") return;
        setScrub(timeFromClientX(e.currentTarget, e.clientX, geometry));
      },
      onPointerUp(e) {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
        const snapped = snap(timeFromClientX(e.currentTarget, e.clientX, geometry));
        setScrub(snapped);
        onCommit(snapped);
      },
      onPointerLeave() {
        // A hover that never pressed is just a preview; only a completed
        // drag (onPointerUp, above) commits anything.
        if (!dragging) setScrub(null);
      },
    },
  };
}

// A convenience for the "clear the preview when the station changes" effect both charts run.
export function useResetScrubOnChange(reset: () => void, key: string): void {
  useEffect(() => reset(), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
