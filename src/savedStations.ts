const KEY = "slackwater.saved";

/** Starred/recent are capped at 7 (RECENT_LIMIT below); the chain is one-directional. */
export interface Saved {
  starred: string[];
  recent: string[];
  lastLocationSlug: string | null;
  /** Place name -> station slug. A deliberate pick for a named place, not a coordinate. */
  placeStations: Record<string, string>;
}

export const RECENT_LIMIT = 7;

/**
 * Display-only: how many starred stations a view renders at once (see
 * StationList's "All"). Storage is unbounded — this bounds rendering, not
 * what's kept.
 */
export const STARRED_LIMIT = 50;

/** NEARBY's "All" shows at most this many (spec §4) — beyond that it stops
 * being nearby and becomes the full list, which is what search is for. */
export const NEARBY_ALL_LIMIT = 20;

const EMPTY: Saved = { starred: [], recent: [], lastLocationSlug: null, placeStations: {} };

function isPlaceStations(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadSaved(): Saved {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw);
    return {
      starred: Array.isArray(parsed?.starred) ? parsed.starred : [],
      recent: Array.isArray(parsed?.recent) ? parsed.recent : [],
      lastLocationSlug: typeof parsed?.lastLocationSlug === "string" ? parsed.lastLocationSlug : null,
      placeStations: isPlaceStations(parsed?.placeStations) ? parsed.placeStations : {},
    };
  } catch {
    // A corrupted store reads as empty rather than throwing into the render path.
    return { ...EMPTY };
  }
}

function write(saved: Saved): Saved {
  localStorage.setItem(KEY, JSON.stringify(saved));
  return saved;
}

/**
 * Recent, with `slug` moved to the front, de-duplicated and capped —
 * unless `slug` is starred, in which case it stays out entirely. It is
 * already shown above; listing it twice below would be noise.
 */
function withRecent(saved: Saved, slug: string): string[] {
  if (saved.starred.includes(slug)) return saved.recent;
  return [slug, ...saved.recent.filter((s) => s !== slug)].slice(0, RECENT_LIMIT);
}

export function star(slug: string): Saved {
  const saved = loadSaved();
  if (saved.starred.includes(slug)) {
    return write({ ...saved, recent: saved.recent.filter((s) => s !== slug) });
  }
  const starred = [...saved.starred, slug];
  const recent = saved.recent.filter((s) => s !== slug);
  return write({ ...saved, starred, recent });
}

export function unstar(slug: string): Saved {
  // Un-starring demotes rather than removes: starred -> recent, not gone.
  const saved = loadSaved();
  const starred = saved.starred.filter((s) => s !== slug);
  const recent = [slug, ...saved.recent.filter((s) => s !== slug)].slice(0, RECENT_LIMIT);
  return write({ ...saved, starred, recent });
}

export function visit(slug: string): Saved {
  const saved = loadSaved();
  return write({ ...saved, recent: withRecent(saved, slug) });
}

export function forget(slug: string): Saved {
  // Recent is the bottom of the chain: forgetting here drops it from view entirely.
  const saved = loadSaved();
  return write({ ...saved, recent: saved.recent.filter((s) => s !== slug) });
}

export function rememberLocation(slug: string): Saved {
  const saved = loadSaved();
  if (saved.lastLocationSlug === slug) return saved;
  // The location moved: the previous match demotes to recent rather than vanishing.
  const recent = saved.lastLocationSlug ? withRecent(saved, saved.lastLocationSlug) : saved.recent;
  return write({ ...saved, recent, lastLocationSlug: slug });
}

/** "In `place`, use this station" — keyed to a name, not coordinates, so it survives drift. */
export function setPlaceStation(place: string, slug: string): Saved {
  const saved = loadSaved();
  return write({ ...saved, placeStations: { ...saved.placeStations, [place]: slug } });
}

export function getPlaceStation(place: string): string | null {
  return loadSaved().placeStations[place] ?? null;
}
