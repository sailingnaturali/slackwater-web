import { useState } from "react";

export type GateResult =
  | { kind: "located"; latitude: number; longitude: number }
  | { kind: "declined" };

/**
 * First run: ask for location before showing anything else.
 *
 * The ask is the whole screen rather than a banner over a working app, because
 * a permission prompt fired at load — before the user knows what this is — gets
 * dismissed reflexively, and iOS only asks once. Saying what it is for first
 * buys the grant.
 *
 * Declining is a first-class path, not a dead end (spec §5e): the app has 41
 * real stations either way, so the fallback is a list, never an empty screen.
 */
export function LocationGate({ onResolve }: { onResolve: (result: GateResult) => void }) {
  const [asking, setAsking] = useState(false);

  function ask() {
    if (!navigator.geolocation) {
      onResolve({ kind: "declined" });
      return;
    }
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        onResolve({
          kind: "located",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      () => onResolve({ kind: "declined" }),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  return (
    <div className="gate">
      <div className="gate-inner rise">
        <p className="eyebrow">Slackwater · Sailing Naturali</p>
        <hr className="rule" />
        <h1>Tides that work with no signal.</h1>
        <p className="gate-body">
          Predictions are computed on your device, so they keep working at anchor with no
          bars. Share your location and we'll open on your nearest station.
        </p>
        <div className="gate-actions">
          <button className="primary" onClick={ask} disabled={asking}>
            {asking ? "Finding you…" : "Use my location"}
          </button>
          <button className="ghost" onClick={() => onResolve({ kind: "declined" })}>
            Choose a station instead
          </button>
        </div>
        <p className="gate-fine">
          Your location stays on your device. Nothing is sent anywhere — there is no server.
        </p>
      </div>
    </div>
  );
}
