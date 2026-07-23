import { extremesOn, snapToTurn, type TideState } from "./tides";
import { formatHeight, heightUnit, type Units } from "./units";
import { useScrub, useResetScrubOnChange, type ScrubGeometry } from "./useScrub";
import { hourTicks } from "./chartTicks";

/** Spoken aloud by a screen reader, so the unit is spelled out rather than abbreviated. */
const unitName = (units: Units) => (units === "imperial" ? "feet" : "metres");

const WIDTH = 720;
const HEIGHT = 260;
// Top band is the readout's row; bottom band holds two rows — turn times just
// under the curve, hour ticks on the floor.
const PAD = { top: 32, right: 16, bottom: 48, left: 44 };

/** An event label this close (px) to the readout line yields — the readout carries the time. */
const LABEL_CLEARANCE = 60;

/** Release within half an hour of a turn and the line snaps onto it. */
const SNAP_WINDOW_MINUTES = 30;

/** Height at `time`, linearly interpolated between the two bracketing timeline points. */
function levelAt(time: Date, points: { time: Date; level: number }[]): number {
  const t = time.getTime();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.time.getTime()) {
      const span = b.time.getTime() - a.time.getTime();
      const frac = span > 0 ? (t - a.time.getTime()) / span : 0;
      return a.level + (b.level - a.level) * frac;
    }
  }
  return points[points.length - 1].level;
}

/**
 * The day's curve, hand-drawn in SVG.
 *
 * No chart library: this is one path, one marker and two axes, and a charting
 * dependency would be larger than the whole prediction engine it plots.
 */
export function TideChart({
  station,
  state,
  now,
  units,
  onScrub,
}: {
  // Only identity is read (id for the scrub reset, timezone for formatting);
  // all tide data rides on `state`, so this renders identically for a bundled
  // or a CHS station — provenance-blind by construction (spec §7).
  station: { id: string; timezone: string };
  state: TideState;
  now: Date;
  units: Units;
  /** Fired once, on release, with the (already turn-snapped) time to make current. */
  onScrub: (t: Date) => void;
}) {
  const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: station.timezone });
  const day = localDay(now);
  const points = state.timeline.filter((p) => localDay(p.time) === day);

  // t0/t1/plotW don't depend on there being a full day of points, so the
  // geometry - and the hooks it feeds - can be built before the early
  // return below, keeping every render's hook calls unconditional.
  const t0 = points[0]?.time.getTime() ?? now.getTime();
  const t1 = points[points.length - 1]?.time.getTime() ?? now.getTime();
  const plotW = WIDTH - PAD.left - PAD.right;

  // The day's own turns - what the released line snaps onto, and what the
  // markers below plot. Filtered from the same prediction as the curve
  // rather than a second call, so the two can never disagree.
  const extremes = extremesOn(state, now, station.timezone);

  const geometry: ScrubGeometry = { plotLeft: PAD.left, plotWidth: plotW, svgWidth: WIDTH, t0, t1 };
  const { scrub, reset, handlers } = useScrub(
    geometry,
    (raw) => snapToTurn(raw, extremes, SNAP_WINDOW_MINUTES),
    onScrub,
  );
  useResetScrubOnChange(reset, station.id);

  if (points.length < 2) return null;

  const levels = points.map((p) => p.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const range = max - min || 1;

  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - t0) / (t1 - t0)) * plotW;
  const y = (level: number) => PAD.top + (1 - (level - min) / range) * plotH;

  const line = points.map((p) => `${x(p.time.getTime())},${y(p.level)}`).join(" ");
  const area = `${PAD.left},${PAD.top + plotH} ${line} ${PAD.left + plotW},${PAD.top + plotH}`;

  const effective = scrub ?? now;
  const effectiveX = x(Math.min(Math.max(effective.getTime(), t0), t1));
  const effectiveLevel = scrub ? levelAt(effective, points) : state.level;
  const anchor =
    effectiveX < PAD.left + 60 ? "start" : effectiveX > WIDTH - PAD.right - 60 ? "end" : "middle";

  const hour = (date: Date) =>
    date.toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: station.timezone,
    });

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Tide curve. Currently ${formatHeight(state.level, units)} ${unitName(units)} and ${
        state.rising ? "rising" : "falling"
      }.`}
    >
      <defs>
        {/* Water, not accent: the fill under the curve is the sea, so it takes
            the top of the brand's water ramp rather than the green. */}
        <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--sn-steel)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="var(--sn-sky)" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {[min, (min + max) / 2, max].map((level) => (
        <g key={level}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(level)}
            y2={y(level)}
            className="grid"
          />
          <text x={PAD.left - 8} y={y(level) + 4} className="axis" textAnchor="end">
            {level.toFixed(1)}
          </text>
        </g>
      ))}

      <polyline points={area} className="area" fill="url(#fill)" />
      <polyline points={line} className="curve" />

      {hourTicks(t0, t1, station.timezone).map(({ t, label }) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.top + plotH} y2={PAD.top + plotH + 5} className="grid" />
          <text x={x(t)} y={HEIGHT - 10} className="axis" textAnchor="middle">
            {label}
          </text>
        </g>
      ))}

      {extremes.map((extreme) => {
        const cx = x(extreme.time.getTime());
        return (
          <g key={extreme.time.toISOString()}>
            <circle
              cx={cx}
              cy={y(extreme.level)}
              r="3.5"
              className={extreme.high ? "dot high" : "dot low"}
            />
            {Math.abs(cx - effectiveX) >= LABEL_CLEARANCE && (
              <text
                x={cx}
                y={y(extreme.level) + (extreme.high ? -16 : 20)}
                className="axis"
                textAnchor="middle"
              >
                {hour(extreme.time)}
              </text>
            )}
          </g>
        );
      })}

      <line x1={effectiveX} x2={effectiveX} y1={PAD.top} y2={PAD.top + plotH} className="nowline" />
      <circle cx={effectiveX} cy={y(effectiveLevel)} r="5" className="nowdot" />
      <text x={effectiveX} y={PAD.top - 12} className="axis readout" textAnchor={anchor}>
        {formatHeight(effectiveLevel, units)} {heightUnit(units)} · {hour(effective)}
      </text>

      {/* Invisible hit target, wider than the curve itself so a finger or an
          imprecise mouse can still grab the line. */}
      <rect
        x={PAD.left}
        y={PAD.top}
        width={plotW}
        height={plotH}
        fill="transparent"
        className="scrub-target"
        {...handlers}
      />
    </svg>
  );
}
