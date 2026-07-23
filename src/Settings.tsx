import { useEffect, useRef } from "react";
import type { SpeedUnit, Units } from "./units";
import { speedUnitLabel } from "./units";

/**
 * The settings sheet — units, set once and rarely revisited.
 *
 * A native <dialog> rather than a hand-rolled overlay: showModal() gives
 * focus trapping, Escape-to-close and the backdrop for free, and getting
 * those right by hand is how modals become inaccessible.
 *
 * TIDE HEIGHT, CURRENT SPEED, plus the CHS licence consent. CURRENT SPEED
 * ships now; SLACK LIMIT does not — it is the paid iOS tier's boat-relative
 * feature (spec §5b), sold rather than missing.
 */
export function Settings({
  open,
  units,
  onUnitsChange,
  speedUnit = "kn",
  onSpeedUnitChange = () => {},
  onClose,
}: {
  open: boolean;
  units: Units;
  onUnitsChange: (units: Units) => void;
  speedUnit?: SpeedUnit;
  onSpeedUnitChange?: (unit: SpeedUnit) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="settings" onClose={onClose}>
      <div className="settings-head">
        <h2>Settings</h2>
        <button className="done" onClick={onClose}>
          Done
        </button>
      </div>

      <section className="settings-section">
        <p className="eyebrow">Tide height</p>
        <div className="segmented" role="radiogroup" aria-label="Tide height units">
          <button
            role="radio"
            aria-checked={units === "imperial"}
            className={units === "imperial" ? "seg current" : "seg"}
            onClick={() => onUnitsChange("imperial")}
          >
            Feet
          </button>
          <button
            role="radio"
            aria-checked={units === "metric"}
            className={units === "metric" ? "seg current" : "seg"}
            onClick={() => onUnitsChange("metric")}
          >
            Meters
          </button>
        </div>
      </section>

      <section className="settings-section">
        <p className="eyebrow">Current speed</p>
        <div className="segmented" role="radiogroup" aria-label="Current speed units">
          {(["kn", "kmh", "ms"] as const).map((u) => (
            <button
              key={u}
              role="radio"
              aria-checked={speedUnit === u}
              className={speedUnit === u ? "seg current" : "seg"}
              onClick={() => onSpeedUnitChange(u)}
            >
              {speedUnitLabel(u)}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <p className="eyebrow">Canadian tide data</p>
        <p className="settings-note">
          British Columbia stations are served live from the Canadian Hydrographic Service.
          By using this product you consent to using the CHS API and abiding by its licence.
        </p>
      </section>
    </dialog>
  );
}
