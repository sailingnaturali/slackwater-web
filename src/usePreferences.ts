import { useCallback, useState } from "react";
import type { SpeedUnit, Units } from "./units";

const KEY = "slackwater.units";
const SPEED_KEY = "slackwater.speedUnit";

export function readUnits(): Units {
  const stored = localStorage.getItem(KEY);
  // Anything unrecognised falls back rather than rendering nonsense.
  return stored === "metric" || stored === "imperial" ? stored : "imperial";
}

export function writeUnits(units: Units): void {
  localStorage.setItem(KEY, units);
}

export function readSpeedUnit(): SpeedUnit {
  const stored = localStorage.getItem(SPEED_KEY);
  return stored === "kn" || stored === "kmh" || stored === "ms" ? stored : "kn";
}

export function writeSpeedUnit(unit: SpeedUnit): void {
  localStorage.setItem(SPEED_KEY, unit);
}

export function usePreferences() {
  const [units, set] = useState<Units>(readUnits);
  const [speedUnit, setSpeed] = useState<SpeedUnit>(readSpeedUnit);
  const setUnits = useCallback((next: Units) => {
    writeUnits(next);
    set(next);
  }, []);
  const setSpeedUnit = useCallback((next: SpeedUnit) => {
    writeSpeedUnit(next);
    setSpeed(next);
  }, []);
  return { units, setUnits, speedUnit, setSpeedUnit };
}
