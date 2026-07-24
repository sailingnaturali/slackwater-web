import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Candidate } from "./place";
import { heightUnit, type Units, type SpeedUnit } from "./units";
import { composeStyle, localFallbackStyle, pinFeatures, seascapeStyleUrl, type StyleLike } from "./mapStyle";
import { previewHtml } from "./mapPopup";

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
    const pins = pinFeatures(stations);
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

    let gone = false;
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
      const hit = map.queryRenderedFeatures(point, { layers: ["station-dots"] })[0];
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
      map.on("mouseenter", "station-dots", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const slug = f?.properties?.slug as string | undefined;
        const station = slug ? stations.find((s) => s.slug === slug) : undefined;
        if (f && station) {
          showPreview(station, (f.geometry as GeoJSON.Point).coordinates.slice(0, 2) as [number, number]);
        }
      });
      map.on("mouseleave", "station-dots", () => {
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
