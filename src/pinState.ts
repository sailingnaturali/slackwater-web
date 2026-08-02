import type { Tone } from "./StationGlyph";
import { type Candidate } from "./place";
import { predict } from "./tides";
import { isNoaaCurrent, noaaCurrentState } from "./noaaCurrents";
import { isChs, isChsCurrent, type ChsStation } from "./chsStations";
import { chsTideDay } from "./chs/tide";
import { chsCurrentDay } from "./chs/current";
import { type ChsCache, indexedDbCache } from "./chs/cache";

/**
 * A station's live state as a Tone, for the map pins.
 *
 * Two speeds, deliberately. Bundled NOAA stations predict from their own
 * constituents on-device, so they resolve synchronously. CHS stations fetch
 * theirs — but the offline sync prefetches whole days into IndexedDB, so for a
 * synced station the reading IS available, just asynchronously. That is why
 * this module exists rather than the map simply drawing everything neutral:
 * "not knowable synchronously" is not the same as "not knowable".
 *
 * Anything genuinely unresolved reports `"unknown"`, which the map draws
 * neutral. Never guess — a wrong slack is worse than an honest grey.
 */

/** Resolvable without I/O: bundled NOAA tide and current stations. */
export function syncTone(station: Candidate, now: Date): Tone {
  if (isChs(station)) return "unknown";
  // 6 h window, not noaaCurrentState's 30 h default: the pin reads `.phase`
  // only, which comes from the signed value at `now`, so the rest of the window
  // is work thrown away. Measured over the 133 bundled NOAA current stations:
  // 88.3 ms at 30 h vs 17.1 ms at 6 h, with 0 phase mismatches across 4 times
  // of day (532 samples). The default stays as it is — other callers need the
  // full window for their next-slack/next-max lookahead.
  if (isNoaaCurrent(station)) return noaaCurrentState(station, now, 6).phase;
  return predict(station, now).rising ? "rising" : "falling";
}

type ChsDeps = { cache: ChsCache; fetchFn?: typeof fetch };

async function chsTone(station: ChsStation, now: Date, deps: ChsDeps): Promise<Tone> {
  try {
    if (isChsCurrent(station)) return (await chsCurrentDay(station, now, deps)).phase;
    return (await chsTideDay(station, now, deps)).rising ? "rising" : "falling";
  } catch {
    // Offline with nothing cached for this station. The honest answer.
    return "unknown";
  }
}

export async function resolvePinStates(
  stations: Candidate[],
  now: Date,
  deps: { cache?: ChsCache; fetchFn?: typeof fetch } = {},
): Promise<Record<string, Tone>> {
  const chsDeps: ChsDeps = { cache: deps.cache ?? indexedDbCache(), fetchFn: deps.fetchFn };
  const states: Record<string, Tone> = {};
  const pending: Promise<void>[] = [];
  for (const s of stations) {
    if (isChs(s)) {
      pending.push(
        chsTone(s, now, chsDeps).then((tone) => {
          states[s.slug] = tone;
        }),
      );
    } else {
      // Guarded for the same reason chsTone is. predict() and
      // noaaCurrentState() are unguarded maths over bundled data, so a single
      // malformed station would throw straight out of this loop and blank
      // every other pin on the map. allSettled below only nets the CHS
      // promises; it does nothing for this synchronous branch.
      try {
        states[s.slug] = syncTone(s, now);
      } catch {
        states[s.slug] = "unknown";
      }
    }
  }
  // allSettled, not all: one station's failure must not blank the whole map.
  await Promise.allSettled(pending);
  return states;
}
