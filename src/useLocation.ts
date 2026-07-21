import { useEffect, useRef, useState } from "react";
import { matchForPosition, type PositionMatch } from "./place";
import { distanceKm } from "./tides";

/**
 * Calibration knobs, not physical constants — GPS jitter under
 * MOVEMENT_THRESHOLD_M must read as "still", or the watch never sleeps and
 * the battery argument is lost. QUIET_PERIOD_MS is how long that stillness
 * has to hold before we trust it and back off.
 */
export const MOVEMENT_THRESHOLD_M = 250;
export const QUIET_PERIOD_MS = 5 * 60_000;

/**
 * Pure backoff policy, kept apart from the browser API so it is testable
 * without mocking geolocation. `shouldKeepWatching` says whether an active
 * `watchPosition` is still worth its battery cost, given the state of the
 * most recent fixes.
 */
export function shouldKeepWatching({
  movedM,
  stillForMs,
}: {
  movedM: number;
  stillForMs: number;
}): boolean {
  return movedM >= MOVEMENT_THRESHOLD_M || stillForMs < QUIET_PERIOD_MS;
}

type Coords = { latitude: number; longitude: number };

export interface LocationState {
  position: Coords | null;
  place: PositionMatch | null;
  watching: boolean;
  /** True once geolocation has explicitly failed (denied, revoked, unsupported). */
  unavailable: boolean;
}

const OPTS: PositionOptions = {
  // Choosing a tide station, not navigating — metre precision costs power
  // and buys nothing here.
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 60_000,
};

/**
 * Watches position while movement makes that worth doing, and backs off once
 * it stops being worth it (see `shouldKeepWatching`). Once asleep, a return
 * to the app — `visibilitychange` to visible, or window `focus` — takes a
 * single fresh fix and resumes watching if it shows movement. That is the
 * close-in-Victoria, open-in-Seattle case: a continuous watch would have
 * slept through it too, because the phone was in a pocket.
 *
 * `enabled` gates the whole thing off until the caller is ready (the initial
 * permission ask belongs to `LocationGate`'s explain-first screen, not to a
 * silent prompt fired the moment this hook mounts).
 */
export function useLocation(enabled: boolean): LocationState {
  const [position, setPosition] = useState<Coords | null>(null);
  const [watching, setWatching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // Mutable tracking state that must not itself trigger renders.
  const lastFixRef = useRef<Coords | null>(null);
  const stillSinceRef = useRef<number>(Date.now());
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setUnavailable(true);
      return;
    }

    function clearWatch() {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setWatching(false);
    }

    function onError() {
      // Declined or revoked: fail quietly, no retry loop, and drop any stale
      // fix so the caller falls back to the unavailable state instead of
      // holding on to a card that no longer reflects reality.
      clearWatch();
      setUnavailable(true);
      setPosition(null);
      lastFixRef.current = null;
    }

    function noteFix(coords: Coords) {
      const previous = lastFixRef.current;
      const movedM = previous ? distanceKm(previous, coords) * 1000 : Infinity;
      if (movedM >= MOVEMENT_THRESHOLD_M) {
        stillSinceRef.current = Date.now();
        lastFixRef.current = coords;
      }
      setUnavailable(false);
      setPosition(coords);
      return movedM;
    }

    function startWatch() {
      if (watchIdRef.current != null) return;
      stillSinceRef.current = Date.now();
      setWatching(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (fix) => {
          const coords = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
          const movedM = noteFix(coords);
          const stillForMs = Date.now() - stillSinceRef.current;
          if (!shouldKeepWatching({ movedM, stillForMs })) clearWatch();
        },
        onError,
        OPTS,
      );
    }

    function checkOnReturn() {
      navigator.geolocation.getCurrentPosition(
        (fix) => {
          const coords = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
          const movedM = noteFix(coords);
          if (movedM >= MOVEMENT_THRESHOLD_M) startWatch();
        },
        onError,
        OPTS,
      );
    }

    function onVisibility() {
      if (document.visibilityState === "visible") checkOnReturn();
    }

    startWatch();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", checkOnReturn);

    return () => {
      clearWatch();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", checkOnReturn);
    };
  }, [enabled]);

  const place = position ? matchForPosition(position) : null;
  return { position, place, watching, unavailable };
}
