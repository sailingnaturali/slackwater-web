import { useEffect, useRef } from "react";
import type { Units } from "./units";

/**
 * The settings sheet — units, set once and rarely revisited.
 *
 * A native <dialog> rather than a hand-rolled overlay: showModal() gives
 * focus trapping, Escape-to-close and the backdrop for free, and getting
 * those right by hand is how modals become inaccessible.
 *
 * TIDE HEIGHT plus the CHS licence consent. The prototype also has CURRENT
 * SPEED and a boat-relative SLACK LIMIT, but this client ships tide stations
 * only — there is no current to show a speed for or a slack window to size,
 * so those wait until currents arrive.
 */
export function Settings({
  open,
  units,
  onUnitsChange,
  onClose,
}: {
  open: boolean;
  units: Units;
  onUnitsChange: (units: Units) => void;
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
        <p className="eyebrow">Canadian tide data</p>
        <p className="settings-note">
          British Columbia stations are served live from the Canadian Hydrographic Service.
          By using this product you consent to using the CHS API and abiding by its licence.
        </p>
      </section>
    </dialog>
  );
}
