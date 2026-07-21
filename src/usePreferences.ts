import { useCallback, useState } from "react";
import type { Units } from "./units";

const KEY = "slackwater.units";

export function readUnits(): Units {
  const stored = localStorage.getItem(KEY);
  // Anything unrecognised falls back rather than rendering nonsense.
  return stored === "metric" || stored === "imperial" ? stored : "imperial";
}

export function writeUnits(units: Units): void {
  localStorage.setItem(KEY, units);
}

export function usePreferences() {
  const [units, set] = useState<Units>(readUnits);
  const setUnits = useCallback((next: Units) => {
    writeUnits(next);
    set(next);
  }, []);
  return { units, setUnits };
}
