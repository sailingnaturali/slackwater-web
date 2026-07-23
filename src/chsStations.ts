import registry from "@sailingnaturali/station-corrections/data/registry.json" with { type: "json" };
import type { Station } from "./tides";

/**
 * A current gate CHS publishes no current prediction for: slack is derived
 * from a reference tide port's high/low water, plus a fixed lag. Local to this
 * app (not the shared station-corrections registry) because no other registry
 * consumer knows how to derive a gate yet — see derivedGates below.
 */
export interface DerivedGateConfig {
  reference: { name: string; latitude: number; longitude: number };
  /** Minutes after reference high water that slack occurs. */
  hwLagMin: number;
  /** Minutes after reference low water that slack occurs. */
  lwLagMin: number;
}

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
  /** Set only on a derived gate (see DerivedGateConfig). */
  derived?: DerivedGateConfig;
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
const registryCurrentStations: ChsStation[] = Object.entries(entries)
  .filter(([, e]) => e.provider === "chs" && e.kind !== "tide")
  .map(([key, e]) => toChsStation(key, e, "current"));

// Gates CHS publishes no current for: slack is derived from a reference tide
// port. Everyone types these in (Malibu Rapids is the classic ~9 kn gate at the
// entrance to Princess Louisa Inlet), so they must be searchable even though
// CHS has no current station there. Lags are the cruising-community consensus:
// slack ≈ Point Atkinson HW+25 / LW+35 min (Points North seminar / Waggoner).
// TODO promote to station-corrections once currents-mcp/chs-constituents can derive.
export const derivedGates: ChsStation[] = [
  {
    kind: "chs", series: "current", provider: "chs",
    id: "chs-malibu-rapids", slug: "chs-malibu-rapids",
    name: "Malibu Rapids", context: "Princess Louisa Inlet",
    latitude: 50.163, longitude: -123.85, // Malibu Islet
    aliases: ["princess louisa", "malibu islet"],
    timezone: TIMEZONE,
    derived: {
      reference: { name: "Point Atkinson", latitude: 49.337, longitude: -123.254 },
      hwLagMin: 25, lwLagMin: 35,
    },
  },
];

export const chsCurrentStations: ChsStation[] = [...registryCurrentStations, ...derivedGates];
