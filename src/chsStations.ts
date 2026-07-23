import registry from "@sailingnaturali/station-corrections/data/registry.json" with { type: "json" };

export interface ChsStation {
  kind: "chs";
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
  position: [number, number];
  provider: string;
  kind?: "tide" | "current";
  aliases?: string[];
};

const entries = registry as unknown as Record<string, RegistryEntry>;

export const chsStations: ChsStation[] = Object.entries(entries)
  .filter(([, e]) => e.provider === "chs" && e.kind === "tide")
  .map(([key, e]) => ({
    kind: "chs",
    provider: "chs",
    id: key,
    slug: key,
    name: e.name,
    context: e.context,
    latitude: e.position[0],
    longitude: e.position[1],
    aliases: e.aliases ?? [],
    timezone: TIMEZONE,
  }));
