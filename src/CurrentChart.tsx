import { snapToTurn } from "./tides";
import { useScrub, useResetScrubOnChange, type ScrubGeometry } from "./useScrub";
import { currentPhaseWord, SLACK_KN, type CurrentState } from "./chs/current";
import { formatSpeed, speedUnitLabel, type SpeedUnit } from "./units";
import { hourTicks } from "./chartTicks";

const WIDTH = 720;
const HEIGHT = 260;
// Top band is the readout's row; bottom band holds two rows — event labels
// just under the curve, hour ticks on the floor. Mirrors TideChart.
const PAD = { top: 32, right: 16, bottom: 48, left: 44 };

/** An event label this close (px) to the readout line yields — the readout carries the value. */
const LABEL_CLEARANCE = 60;

/** Release within half an hour of a slack or peak and the line snaps onto it. */
const SNAP_WINDOW_MINUTES = 30;

/** Day-signed extremes, forced to bracket zero so the zero line is always drawn. */
export function signedDomain(timeline: { time: Date; signed: number }[]): { min: number; max: number } {
  const vals = timeline.map((p) => p.signed);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  // A hair of padding so a peak dot is not clipped at the frame.
  const pad = (max - min || 1) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Signed velocity at `time`, linearly interpolated between the two bracketing timeline points. */
function signedAt(time: Date, points: { time: Date; signed: number }[]): number {
  const t = time.getTime();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t <= b.time.getTime()) {
      const span = b.time.getTime() - a.time.getTime();
      const frac = span > 0 ? (t - a.time.getTime()) / span : 0;
      return a.signed + (b.signed - a.signed) * frac;
    }
  }
  return points[points.length - 1].signed;
}

/**
 * The day's signed current curve, hand-drawn in SVG — mirrors TideChart's
 * layout constants and one-path idiom, but the curve is signed rather than
 * absolute: above the zero line is flood, below is ebb, so no chart library
 * or per-segment path splitting is needed for the ribbon fill either.
 */
export function CurrentChart({
  station,
  state,
  now,
  speedUnit,
  onScrub,
}: {
  // Only identity is read (id for the scrub reset, timezone for formatting);
  // all current data rides on `state`.
  station: { id: string; timezone: string };
  state: CurrentState;
  now: Date;
  speedUnit: SpeedUnit;
  /** Fired once, on release, with the (already turn-snapped) time to make current. */
  onScrub: (t: Date) => void;
}) {
  const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: station.timezone });
  const day = localDay(now);
  const points = state.timeline.filter((p) => localDay(p.time) === day);
  const dayEvents = state.events.filter((e) => localDay(e.time) === day);

  // t0/t1/plotW don't depend on there being a full day of points, so the
  // geometry - and the hooks it feeds - can be built before the early
  // return below, keeping every render's hook calls unconditional.
  const t0 = points[0]?.time.getTime() ?? now.getTime();
  const t1 = points[points.length - 1]?.time.getTime() ?? now.getTime();
  const plotW = WIDTH - PAD.left - PAD.right;

  // The day's own slacks and peaks - what the released line snaps onto, and
  // what the markers below plot. Filtered from the same state as the curve
  // rather than a second call, so the two can never disagree.
  const geometry: ScrubGeometry = { plotLeft: PAD.left, plotWidth: plotW, svgWidth: WIDTH, t0, t1 };
  const { scrub, reset, handlers } = useScrub(
    geometry,
    (raw) => snapToTurn(raw, dayEvents, SNAP_WINDOW_MINUTES),
    onScrub,
  );
  useResetScrubOnChange(reset, station.id);

  if (points.length < 2) return null;

  const { min, max } = signedDomain(points);
  const range = max - min || 1;

  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - t0) / (t1 - t0)) * plotW;
  const y = (signed: number) => PAD.top + (1 - (signed - min) / range) * plotH;
  const yZero = y(0);
  const zeroFrac = (yZero - PAD.top) / plotH; // gradient hard-stop position

  const line = points.map((p) => `${x(p.time.getTime())},${y(p.signed)}`).join(" ");
  // Ribbon between the curve and the zero baseline: one polygon fills both
  // the flood lobe (above) and the ebb lobe (below) without splitting the path.
  const ribbon = `${PAD.left},${yZero} ${line} ${PAD.left + plotW},${yZero}`;

  const effective = scrub ?? now;
  const effectiveX = x(Math.min(Math.max(effective.getTime(), t0), t1));
  const effectiveSigned = scrub ? signedAt(effective, points) : state.signed;
  const effSpeed = Math.abs(effectiveSigned);
  const effPhase = effSpeed < SLACK_KN ? "slack" : effectiveSigned > 0 ? "flood" : "ebb";
  const anchor =
    effectiveX < PAD.left + 60 ? "start" : effectiveX > WIDTH - PAD.right - 60 ? "end" : "middle";

  const hour = (d: Date) =>
    d.toLocaleTimeString("en-CA", {
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
      aria-label={
        state.derived
          ? `Current shape, no predicted speed. Now ${currentPhaseWord(effPhase).toLowerCase()}.`
          : `Current curve. Now ${formatSpeed(effSpeed, speedUnit)} ${speedUnitLabel(speedUnit)}, ${currentPhaseWord(
              effPhase,
            ).toLowerCase()}.`
      }
    >
      <defs>
        {/* Flood above the zero line, ebb below - reuses the app's existing
            rising/falling semantic colours rather than a duplicate pair. */}
        <linearGradient id="currentfill" gradientUnits="userSpaceOnUse"
          x1="0" x2="0" y1={PAD.top} y2={PAD.top + plotH}>
          <stop offset="0%" stopColor="var(--rising)" stopOpacity="0.42" />
          <stop offset={`${zeroFrac * 100}%`} stopColor="var(--rising)" stopOpacity="0.08" />
          <stop offset={`${zeroFrac * 100}%`} stopColor="var(--falling)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--falling)" stopOpacity="0.42" />
        </linearGradient>
      </defs>

      {/* Zero line - the flood/ebb divide and the slack level. */}
      <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yZero} y2={yZero} className="grid zero" />

      <polygon points={ribbon} fill="url(#currentfill)" className="area" />
      <polyline points={line} className="curve" fill="none" />

      {hourTicks(t0, t1, station.timezone).map(({ t, label }) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={PAD.top + plotH} y2={PAD.top + plotH + 5} className="grid" />
          <text x={x(t)} y={HEIGHT - 10} className="axis" textAnchor="middle">
            {label}
          </text>
        </g>
      ))}

      {dayEvents.map((e) => {
        const cx = x(e.time.getTime());
        const labelled = Math.abs(cx - effectiveX) >= LABEL_CLEARANCE;
        if (e.kind === "slack") {
          return (
            <g key={e.time.toISOString()}>
              <circle cx={cx} cy={yZero} r="3.5" className="dot slack" />
              {labelled && (
                <text x={cx} y={yZero + 18} className="axis" textAnchor="middle">
                  {hour(e.time)}
                </text>
              )}
            </g>
          );
        }
        // Peak events (the only kind reaching here) always carry a speed; a
        // derived gate has none and never renders this chart.
        const signed = e.kind === "max-flood" ? e.speed! : -e.speed!;
        const up = e.kind === "max-flood";
        return (
          <g key={e.time.toISOString()}>
            <circle cx={cx} cy={y(signed)} r="3.5" className={up ? "dot flood" : "dot ebb"} />
            {labelled && (
              <text x={cx} y={y(signed) + (up ? -16 : 20)} className="axis" textAnchor="middle">
                {formatSpeed(e.speed!, speedUnit)}
              </text>
            )}
          </g>
        );
      })}

      <line x1={effectiveX} x2={effectiveX} y1={PAD.top} y2={PAD.top + plotH} className="nowline" />
      <circle cx={effectiveX} cy={y(effectiveSigned)} r="5" className="nowdot" />
      <text x={effectiveX} y={PAD.top - 12} className="axis readout" textAnchor={anchor}>
        {/* A derived gate has no speed — the readout names the phase, never knots. */}
        {state.derived
          ? currentPhaseWord(effPhase)
          : effPhase === "slack"
            ? "Slack"
            : `${formatSpeed(effSpeed, speedUnit)} ${speedUnitLabel(speedUnit)}`}{" "}
        · {hour(effective)}
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
