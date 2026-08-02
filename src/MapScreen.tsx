import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Candidate } from "./place";
import { heightUnit, type Units, type SpeedUnit } from "./units";
import { composeStyle, localFallbackStyle, pinFeatures, seascapeStyleUrl, type StyleLike } from "./mapStyle";
import { previewHtml } from "./mapPopup";
import { pinGlyphImage, PIN_IMAGE_ID, PIN_PIXEL_RATIO } from "./pinGlyphs";
import { resolvePinStates } from "./pinState";

// Registered once per session; the protocol resolves pmtiles:// tile requests
// via HTTP range reads against our own origin.
let protocolRegistered = false;
function ensureProtocol() {
  if (protocolRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  protocolRegistered = true;
}

const SALISH_CENTER: [number, number] = [-123.4, 48.6];

export default function MapScreen({
  stations,
  units,
  speedUnit,
  selectedId,
  onSelect,
  onClose,
}: {
  stations: Candidate[];
  units: Units;
  speedUnit: SpeedUnit;
  selectedId: string;
  onSelect: (s: Candidate) => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // onSelect is an inline prop that changes identity every parent re-render
  // (30s poll); read the latest via ref instead of putting it in the mount
  // effect's deps, which would rebuild the map on every parent tick.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current) return;
    ensureProtocol();
    // stations is the stable candidates pool (module-level import in
    // practice) — captured here, not a dep, so it can't trigger a remount.
    // Reassigned once the state pass resolves, so a later setStyle carries the
    // enriched features rather than reverting every pin to neutral.
    let pins = pinFeatures(stations);
    const landUrl = `pmtiles://${new URL("/land.pmtiles", window.location.origin)}`;
    const selected = stations.find((s) => s.id === selectedId);

    const map = new maplibregl.Map({
      container: container.current,
      // Fallback first: land + pins render immediately (and are all an offline
      // user gets); Seascape replaces the style when its fetch lands. No error
      // banner when it doesn't — the map renders what it can reach (spec §4).
      style: localFallbackStyle(landUrl, pins) as unknown as maplibregl.StyleSpecification,
      center: selected ? [selected.longitude, selected.latitude] : SALISH_CENTER,
      zoom: selected ? 10 : 7,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));

    // setStyle({diff:false}) below drops every registered image, and this map
    // styles twice (fallback, then Seascape). So re-register on each style
    // load; hasImage keeps it idempotent.
    const ensurePinImages = () => {
      for (const kind of ["current", "tide"] as const) {
        const id = PIN_IMAGE_ID[kind];
        if (map.hasImage(id)) continue;
        map.addImage(id, pinGlyphImage(kind), { sdf: true, pixelRatio: PIN_PIXEL_RATIO });
      }
    };
    // The same swap drops the stations source's data back to whatever `pins`
    // was when composeStyle ran. If the state pass resolved while the new style
    // was still loading, its setData hit a source that didn't exist yet
    // (maplibre defers Style._load to a rAF) and was swallowed by `?.` — every
    // pin grey for the session. Reapplying on each style load closes that race;
    // setData fires sourcedata, not styledata, so there's no recursion.
    const applyPins = () =>
      (map.getSource("stations") as maplibregl.GeoJSONSource | undefined)?.setData(pins);
    ensurePinImages();
    map.on("styledata", () => {
      ensurePinImages();
      applyPins();
    });

    let gone = false;

    // Pins draw neutral, then fill in together when the pass completes. One
    // setData rather than per-pin feature state: no feature ids needed, one
    // repaint instead of N, and no popcorn effect. Runs once per map open —
    // state moves over minutes and this is a station picker, not an instrument.
    // CACHE ONLY — the rejecting fetchFn is load-bearing, not defensive. CHS
    // state comes from what the offline sync already stored and from nothing
    // else. Allowed to fetch, opening the map fires one request per unsynced
    // CHS station through a shared ~24 req/min limiter with retries: a storm
    // against a third-party API, and over a minute before any pin takes on
    // colour, since this single setData waits on the slowest station. A
    // station the sync has not reached stays neutral — the honest unknown.
    const cacheOnly: typeof fetch = () => Promise.reject(new Error("map pins read cache only"));
    resolvePinStates(stations, new Date(), { fetchFn: cacheOnly })
      .then((states) => {
        if (gone) return;
        pins = pinFeatures(stations, states);
        // Paints on first load, when no further style ever arrives (offline).
        applyPins();
      })
      .catch(() => {
        /* every pin stays neutral, which is the honest unknown */
      });
    // units is captured at mount for the initial Seascape fetch only; a
    // units change while the map is open doesn't restyle it (rare — the map
    // is a leaf view, closing and reopening picks up the new unit).
    fetch(seascapeStyleUrl(heightUnit(units)))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((style: StyleLike) => {
        if (!gone) map.setStyle(composeStyle(style, landUrl, pins) as unknown as maplibregl.StyleSpecification, { diff: false });
      })
      .catch(() => {
        /* offline or upstream down: the fallback style is already up */
      });

    // The preview popup: the header card's identity + live reading, so you know
    // a station before opening it. One reused popup, repositioned per pin.
    // units/speedUnit are captured at mount (like the Seascape fetch above).
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: "map-popup",
    });
    const showPreview = (station: Candidate, coords: [number, number]) => {
      popup.setLngLat(coords).setHTML(previewHtml(station, new Date(), units, speedUnit)).addTo(map);
    };
    const stationAt = (point: maplibregl.Point) => {
      const hit = map.queryRenderedFeatures(point, { layers: ["station-pins"] })[0];
      const slug = hit?.properties?.slug as string | undefined;
      const station = slug ? stations.find((s) => s.slug === slug) : undefined;
      if (!hit || !station) return null;
      const coords = (hit.geometry as GeoJSON.Point).coordinates.slice(0, 2) as [number, number];
      return { station, slug: slug!, coords };
    };

    // (hover: hover) is a mouse; (hover: none) is touch. Touch has no hover to
    // preview with, so there the first tap on a pin previews it and a second tap
    // on the same pin opens it — a tap on empty water dismisses the preview. A
    // mouse previews on hover, so a click opens straight away.
    const canHover = window.matchMedia("(hover: hover)").matches;
    let activeSlug: string | null = null;

    map.on("click", (e) => {
      const at = stationAt(e.point);
      if (!at) {
        if (!canHover) {
          popup.remove();
          activeSlug = null;
        }
        return;
      }
      if (canHover || activeSlug === at.slug) {
        onSelectRef.current(at.station);
        return;
      }
      activeSlug = at.slug;
      showPreview(at.station, at.coords);
    });

    if (canHover) {
      const pinLayerIds = ["station-pins"];
      map.on("mouseenter", pinLayerIds, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const slug = f?.properties?.slug as string | undefined;
        const station = slug ? stations.find((s) => s.slug === slug) : undefined;
        if (f && station) {
          showPreview(station, (f.geometry as GeoJSON.Point).coordinates.slice(0, 2) as [number, number]);
        }
      });
      map.on("mouseleave", pinLayerIds, () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }

    return () => {
      gone = true;
      mapRef.current = null;
      popup.remove();
      map.remove();
    };
    // Map is created once per mount: selectedId re-centers via the effect
    // below (easeTo) instead of a remount, onSelect is read via onSelectRef,
    // and stations is a stable pool (see comment above) — none of them
    // should rebuild the WebGL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const s = stations.find((st) => st.id === selectedId);
    if (s) map.easeTo({ center: [s.longitude, s.latitude] });
  }, [selectedId]);

  return (
    <div className="map-screen">
      <header className="map-head">
        <p className="eyebrow">Map</p>
        <button className="close" onClick={onClose} aria-label="Close map">
          ✕
        </button>
      </header>
      <div ref={container} className="map-canvas" />
      <p className="warn map-warn">
        Depths not reduced to chart datum — <strong>not for navigation</strong>.
      </p>
    </div>
  );
}
