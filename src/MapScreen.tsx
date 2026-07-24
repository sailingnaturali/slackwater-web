import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Candidate } from "./place";
import { heightUnit, type Units } from "./units";
import { composeStyle, localFallbackStyle, pinFeatures, seascapeStyleUrl, type StyleLike } from "./mapStyle";

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
  selectedId,
  onSelect,
  onClose,
}: {
  stations: Candidate[];
  units: Units;
  selectedId: string;
  onSelect: (s: Candidate) => void;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    ensureProtocol();
    const pins = pinFeatures(stations);
    const landUrl = `pmtiles://${new URL("/land.pmtiles", window.location.origin)}`;
    const selected = stations.find((s) => s.id === selectedId);

    const map = new maplibregl.Map({
      container: container.current,
      // Fallback first: land + pins render immediately (and are all an offline
      // user gets); Seascape replaces the style when its fetch lands. No error
      // banner when it doesn't — the map renders what it can reach (spec §4).
      style: localFallbackStyle(landUrl, pins) as never,
      center: selected ? [selected.longitude, selected.latitude] : SALISH_CENTER,
      zoom: selected ? 10 : 7,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));

    let gone = false;
    fetch(seascapeStyleUrl(heightUnit(units)))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((style: StyleLike) => {
        if (!gone) map.setStyle(composeStyle(style, landUrl, pins) as never, { diff: false });
      })
      .catch(() => {
        /* offline or upstream down: the fallback style is already up */
      });

    const pick = (e: maplibregl.MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["station-dots"] })[0];
      const slug = hit?.properties?.slug as string | undefined;
      const station = slug && stations.find((s) => s.slug === slug);
      if (station) onSelect(station);
    };
    map.on("click", pick);
    map.on("mouseenter", "station-dots", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "station-dots", () => (map.getCanvas().style.cursor = ""));

    return () => {
      gone = true;
      map.remove();
    };
  }, [stations, units, selectedId, onSelect]);

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
