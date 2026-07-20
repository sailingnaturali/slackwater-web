/**
 * NOAA station names arrive in whatever case the surveyor typed them:
 * "CHERRY POINT" next to "Friday Harbor, San Juan Island" next to
 * "Swinomish Channel ent., Padilla Bay". Left alone they read as a database
 * dump rather than a place you might anchor.
 *
 * Two jobs: fix the shouting, and split the qualifier off so the name can be
 * displayed as a place with context rather than one long comma-run.
 */

/** Words that stay lowercase inside a name, but not at the start. */
const MINOR = new Set(["of", "the", "at", "on", "in", "and", "de", "la", "el"]);

/** Tokens whose capitalisation is already correct and must survive title-casing. */
const KEEP = new Map([
  ["NAS", "NAS"], // Naval Air Station
  ["US", "US"],
  ["BC", "BC"],
  ["NE", "NE"], ["NW", "NW"], ["SE", "SE"], ["SW", "SW"],
  ["USCG", "USCG"],
]);

/** Abbreviations worth spelling out. Deliberately short — only the noisy ones. */
const EXPAND: [RegExp, string][] = [
  [/\bSt\. Park\b/gi, "State Park"],
  [/\bent\./gi, "Entrance"],
  [/\bI\.$/g, "Island"],
  [/\bI\.,/g, "Island,"],
  [/\bIs\./gi, "Islands"],
  [/\bPt\./gi, "Point"],
  [/\bCk\./gi, "Creek"],
];

function titleCaseWord(word: string, first: boolean): string {
  const bare = word.replace(/[^A-Za-z]/g, "");
  const keep = KEEP.get(bare.toUpperCase());
  if (keep && bare.toUpperCase() === bare) return word.replace(bare, keep);

  const lower = word.toLowerCase();
  if (!first && MINOR.has(lower)) return lower;

  // Hyphens and slashes each get their own capital: "spee-bi-dah".
  return lower.replace(/(^|[-/(])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

/**
 * Fix a name's capitalisation without touching names that are already fine.
 *
 * Only ALL-CAPS runs get re-cased. Mixed-case names were written by a human and
 * may contain capitalisation we cannot reconstruct — "Spee-Bi-Dah", "McArthur",
 * "La Push". Re-casing those would break more than it fixed.
 */
export function fixCase(name: string): string {
  return name
    .split(" ")
    .map((word, index) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      const shouting = letters.length > 1 && letters === letters.toUpperCase();
      return shouting ? titleCaseWord(word, index === 0) : word;
    })
    .join(" ");
}

export interface StationName {
  /** The place itself: "Friday Harbor". */
  primary: string;
  /** Where it is, if the name said: "San Juan Island". Empty when it did not. */
  context: string;
  /** Both, for search and for the document title. */
  full: string;
}

/**
 * Split a raw station name into a place and its context.
 *
 * NOAA names read outside-in after the first comma — "Rosario, East Sound,
 * Orcas Island" is Rosario, which is in East Sound, which is on Orcas. The
 * first segment is the thing you would say out loud; the rest is context, which
 * the UI can show quietly instead of making it compete with the place name.
 */
export function stationName(raw: string): StationName {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  for (const [pattern, replacement] of EXPAND) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = fixCase(cleaned);

  const [primary, ...rest] = cleaned.split(",").map((part) => part.trim());
  const context = rest
    .filter(Boolean)
    // "Puget Sound" as a trailing qualifier is true of nearly everything here
    // and tells a local nothing.
    .filter((part) => part.toLowerCase() !== "puget sound")
    .join(" · ");

  return { primary, context, full: context ? `${primary}, ${context}` : primary };
}
