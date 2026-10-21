import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { api, type PlantCollection, type RegionCollection } from "../api.ts";
import { useAppStore } from "../store.ts";
import { FLY_MS, flyToRegion, GLOBE_VIEW, introFlight, KALTIM_VIEW, startIdleOrbit, stopIdleOrbit } from "./camera.ts";
import { applyLightPreset, type LightPreset, lightPresetFor, presetTone, setRainEffect } from "./effects.ts";
import { addPlants, setPlantsVisible } from "./plantsLayer.ts";
import {
  addRegions,
  riseRegions,
  setRegionHover,
  setRegionMetric,
  setRegionsVisible,
  setRegionTone,
  setSelectedRegion,
} from "./regionsLayer.ts";

interface Props {
  token: string;
  regions: RegionCollection;
  plants: PlantCollection;
  onIntroStart: () => void;
  onIntroEnd: () => void;
  /** The region under the pointer on the map changed. Called on enter and leave, not on every move. */
  onRegionHover: (id: string | null) => void;
  /** The pointer moved over a hovered region (tooltip position). */
  onRegionPointer: (point: { x: number; y: number }) => void;
}

const PRESETS: readonly LightPreset[] = ["dawn", "day", "dusk", "night"];
/** `?cahaya=night` pins the light preset (screenshots, a night demo in daylight). Otherwise it follows WITA time. */
function pinnedPreset(): LightPreset | null {
  const v = new URLSearchParams(window.location.search).get("cahaya");
  return PRESETS.includes(v as LightPreset) ? (v as LightPreset) : null;
}

/** Bounding box of a region polygon, used to frame it when selected. */
function bboxOf(fc: RegionCollection, id: string): [[number, number], [number, number]] | undefined {
  const f = fc.features.find((x) => x.properties.id === id);
  if (!f) return undefined;
  const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const ring of rings) {
    for (const [x = 0, y = 0] of ring) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Centre of a bounding box: the fallback when the region detail (with its PostGIS centroid) cannot load. */
const centerOf = (b: [[number, number], [number, number]]): [number, number] => [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];

export function MapView({ token, regions, plants, onIntroStart, onIntroEnd, onRegionHover, onRegionPointer }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without re-creating the map.
  const handlers = useRef({ onIntroStart, onIntroEnd, onRegionHover, onRegionPointer });
  handlers.current = { onIntroStart, onIntroEnd, onRegionHover, onRegionPointer };

  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = token;
    const store = useAppStore.getState();
    const pinned = pinnedPreset();
    let preset: LightPreset = pinned ?? lightPresetFor(new Date());
    const map = new mapboxgl.Map({
      container: container.current,
      style: "mapbox://styles/mapbox/standard",
      projection: "globe",
      ...GLOBE_VIEW,
      antialias: true,
      attributionControl: false,
      config: {
        basemap: {
          lightPreset: preset,
          theme: "faded",
          show3dLandmarks: false,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
        },
      },
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");

    let disposed = false;
    let ready = false;
    const lightTimer = pinned
      ? undefined
      : setInterval(() => {
          preset = applyLightPreset(map, new Date());
          setRegionTone(map, presetTone(preset));
        }, 60_000);

    map.on("style.load", async () => {
      map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });

      addRegions(
        map,
        regions,
        store.metric,
        {
          onSelect: (id) => useAppStore.getState().selectRegion(id),
          onHover: (id) => handlers.current.onRegionHover(id),
          onPointer: (point) => handlers.current.onRegionPointer(point),
        },
        presetTone(preset),
      );
      addPlants(map, plants);
      setRegionsVisible(map, store.layers.regions);
      setPlantsVisible(map, store.layers.plants);
      setRainEffect(map, store.rain === "on");

      // Clicking empty ground at the province view clears the region selection.
      map.addInteraction("map-background-click", {
        type: "click",
        handler: () => {
          if (map.getZoom() < 11) useAppStore.getState().selectRegion(null);
        },
      });

      ready = true;
      useAppStore.getState().setMap(map);
      // Test hook for scripts/smoke.ts (waits for idle, projects points). Read-only use only.
      (window as unknown as { __malasMap?: mapboxgl.Map }).__malasMap = map;
      handlers.current.onIntroStart();
      // Columns rise while the camera is still descending, so they are growing as Kaltim comes into view.
      const rise = setTimeout(() => riseRegions(map, regions), 4300);
      await introFlight(map);
      if (disposed) return;
      clearTimeout(rise);
      riseRegions(map, regions);
      handlers.current.onIntroEnd();
      startIdleOrbit(map);
    });

    // React to store changes that the map must follow.
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (!ready) return;
      if (s.metric !== prev.metric) setRegionMetric(map, s.metric);
      if (s.layers.regions !== prev.layers.regions) setRegionsVisible(map, s.layers.regions);
      if (s.layers.plants !== prev.layers.plants) setPlantsVisible(map, s.layers.plants);
      if (s.rain !== prev.rain) setRainEffect(map, s.rain === "on");
      if (s.hoveredRegionId !== prev.hoveredRegionId) setRegionHover(map, s.hoveredRegionId);
      if (s.selectedRegionId !== prev.selectedRegionId) {
        setSelectedRegion(map, s.selectedRegionId);
        if (s.selectedRegionId) {
          const id = s.selectedRegionId;
          const bounds = bboxOf(regions, id);
          api
            .region(id)
            .then((r) => r.centroid)
            .catch(() => (bounds ? centerOf(bounds) : null))
            .then((centroid) => {
              // Skip when the user picked another region while the request was out.
              if (!disposed && centroid && useAppStore.getState().selectedRegionId === id) flyToRegion(map, centroid, { bounds });
            });
        } else {
          map.flyTo({ ...KALTIM_VIEW, duration: FLY_MS, curve: 1.2, essential: true });
        }
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(lightTimer);
      stopIdleOrbit();
      useAppStore.getState().setMap(null);
      map.remove();
    };
  }, [token, regions, plants]);

  // Inline style: mapbox-gl.css sets `.mapboxgl-map { position: relative }`, which would beat a class.
  return <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Peta 3D Kalimantan Timur" role="region" />;
}
