import type { TideState } from "./tides";
import { formatHeight, type Units } from "./units";

/** Spoken aloud by a screen reader, so the unit is spelled out rather than abbreviated. */
const unitName = (units: Units) => (units === "imperial" ? "feet" : "metres");

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 24, right: 16, bottom: 28, left: 44 };

/**
 * The day's curve, hand-drawn in SVG.
 *
 * No chart library: this is one path, one marker and two axes, and a charting
 * dependency would be larger than the whole prediction engine it plots.
 */
export function TideChart({
  state,
  now,
  timezone,
  units,
}: {
  state: TideState;
  now: Date;
  timezone: string;
  units: Units;
}) {
  const points = state.timeline;
  if (points.length < 2) return null;

  const t0 = points[0].time.getTime();
  const t1 = points[points.length - 1].time.getTime();
  const levels = points.map((p) => p.level);
  const min = Math.min(...levels);
  const max = Math.max(...levels);
  const range = max - min || 1;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - t0) / (t1 - t0)) * plotW;
  const y = (level: number) => PAD.top + (1 - (level - min) / range) * plotH;

  const line = points.map((p) => `${x(p.time.getTime())},${y(p.level)}`).join(" ");
  const area = `${PAD.left},${PAD.top + plotH} ${line} ${PAD.left + plotW},${PAD.top + plotH}`;

  const nowX = x(now.getTime());
  const nowLevel = state.level;

  const hour = (date: Date) =>
    date.toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    });

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Tide curve. Currently ${formatHeight(nowLevel, units)} ${unitName(units)} and ${
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

      {state.extremes
        .filter((extreme) => extreme.time.getTime() >= t0 && extreme.time.getTime() <= t1)
        .map((extreme) => (
          <g key={extreme.time.toISOString()}>
            <circle
              cx={x(extreme.time.getTime())}
              cy={y(extreme.level)}
              r="3.5"
              className={extreme.high ? "dot high" : "dot low"}
            />
            <text
              x={x(extreme.time.getTime())}
              y={y(extreme.level) + (extreme.high ? -12 : 18)}
              className="axis"
              textAnchor="middle"
            >
              {hour(extreme.time)}
            </text>
          </g>
        ))}

      <line x1={nowX} x2={nowX} y1={PAD.top} y2={PAD.top + plotH} className="nowline" />
      <circle cx={nowX} cy={y(nowLevel)} r="5" className="nowdot" />
    </svg>
  );
}
