import registry from "@sailingnaturali/station-corrections/data/registry.json" with { type: "json" };
import type { Station } from "./tides";

export interface ChsStation {
  kind: "chs";
  /** Which water this station reports: a tide port or a current gate. */
  series: "tide" | "current";
  provider: "chs";
  /** Registry key, e.g. "chs-victoria". Doubles as slug. */
  id: string;
  slug: string;
  name: string;
  context: string;
  latitude: number;
  longitude: number;
  aliases: string[];
  timezone: string;
}

// ponytail: every CHS tide port in the registry is Salish Sea / Inside Passage / BC
// reference ports (the membership rules scope the whole registry to Pacific waters),
// so a constant is correct here. Add a real per-station timezone field only if the
// registry ever expands past the Pacific.
const TIMEZONE = "America/Vancouver";

type RegistryEntry = {
  name: string;
  context: string;
  // number[] not [number, number]: JSON imports infer a plain array, and the
  // tuple type forced an `as unknown as` double-cast. We only read [0]/[1].
  position: number[];
  provider: string;
  kind?: "tide" | "current";
  aliases?: string[];
};

/** A bundled NOAA station has no `kind`; only CHS ports carry the discriminant. */
export const isChs = (s: Station | ChsStation): s is ChsStation =>
  "kind" in s && s.kind === "chs";

export const isChsCurrent = (s: Station | ChsStation): s is ChsStation =>
  isChs(s) && s.series === "current";

const entries = registry as Record<string, RegistryEntry>;

function toChsStation(key: string, e: RegistryEntry, series: "tide" | "current"): ChsStation {
  return {
    kind: "chs",
    series,
    provider: "chs",
    id: key,
    slug: key,
    name: e.name,
    context: e.context,
    latitude: e.position[0],
    longitude: e.position[1],
    aliases: e.aliases ?? [],
    timezone: TIMEZONE,
  };
}

export const chsStations: ChsStation[] = Object.entries(entries)
  .filter(([, e]) => e.provider === "chs" && e.kind === "tide")
  .map(([key, e]) => toChsStation(key, e, "tide"));

// The 19 Inside-Passage gates carry no `kind` field (ports carry kind:"tide"),
// so "chs and not a tide port" is exactly the gate set. Current-only on web
// (spec §5c): a gate reports current, never a paired tide.
export const chsCurrentStations: ChsStation[] = Object.entries(entries)
  .filter(([, e]) => e.provider === "chs" && e.kind !== "tide")
  .map(([key, e]) => toChsStation(key, e, "current"));
