import { useState } from "react";
import { distanceKm, m2SpreadMinutes, matchQuality, type Match } from "./tides";
import { distanceUnit, formatDistance, type Units } from "./units";
import { setPlaceStation } from "./savedStations";
import type { Place, Candidate } from "./place";

// Same three buckets as LocationCard/App — copied rather than exported and
// shared, matching how each of those already keeps its own local copy.
const QUALITY_COPY: Record<Match["quality"], string> = {
  good: "good match",
  approximate: "approximate — the tide varies across this area",
  nearest: "nearest station, but a long way off",
};

/**
 * Grades a candidate against `place`, not the raw GPS fix — `alternatives`
 * (nearest-first, from `stationsNear`) is itself place-grounded, so the
 * spread signal comes from the same neighbourhood the distance is measured
 * against. Grounding on raw position instead (as `matchStation` does
 * elsewhere) would let this control's distance and quality describe two
 * different reference points, which is the inconsistency this task exists to
 * resolve.
 */
function qualityNear(place: Place, station: Candidate, neighbours: Candidate[]) {
  return matchQuality(distanceKm(place, station), m2SpreadMinutes(neighbours));
}

/**
 * The multi-match chooser (design §"the multi-match chooser"): a link-styled
 * control, not a `<select>`, that says a place has more than one plausible
 * station and lets a pick stick via `setPlaceStation`.
 *
 * Renders nothing when there is only one plausible station — an affordance
 * offering a single option is noise, not a choice.
 */
export function StationChooser({
  place,
  current,
  alternatives,
  units,
  onChoose,
}: {
  place: Place;
  current: Candidate;
  /** Nearest-first; always includes `current` (see `PositionMatch.alternatives`). */
  alternatives: Candidate[];
  units: Units;
  onChoose: (station: Candidate) => void;
}) {
  const [open, setOpen] = useState(false);

  if (alternatives.length <= 1) return null;

  // The nearest three set the neighbourhood's tide gradient, same as
  // `matchStation`'s own `ranked.slice(0, 3)` — just measured from the place
  // instead of a raw fix.
  const neighbours = alternatives.slice(0, 3);
  const currentQuality = qualityNear(place, current, neighbours);
  const currentKm = distanceKm(place, current);

  return (
    <div className="station-chooser">
      <button
        type="button"
        className="chooser-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current.name} · {formatDistance(currentKm, units)} {distanceUnit(units)} ·{" "}
        {QUALITY_COPY[currentQuality]} — not right?
      </button>
      {open && (
        <ul className="chooser-list">
          {alternatives.map((station) => {
            const isCurrent = station.slug === current.slug;
            const km = distanceKm(place, station);
            const quality = qualityNear(place, station, neighbours);
            return (
              <li key={station.slug}>
                <button
                  type="button"
                  className={isCurrent ? "chooser-option current" : "chooser-option"}
                  disabled={isCurrent}
                  onClick={() => {
                    setPlaceStation(place.name, station.slug);
                    onChoose(station);
                    setOpen(false);
                  }}
                >
                  <span className="chooser-option-name">{station.name}</span>
                  <span className="chooser-option-meta">
                    {formatDistance(km, units)} {distanceUnit(units)} · {QUALITY_COPY[quality]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
