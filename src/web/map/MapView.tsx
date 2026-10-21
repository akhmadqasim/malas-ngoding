import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { api, type PlantCollection, type RegionCollection } from "../api.ts";
import { useAppStore } from "../store.ts";
import { abortIntro, FLY_MS, flyToRegion, GLOBE_VIEW, introFlight, KALTIM_VIEW, startIdleOrbit, stopIdleOrbit } from "./camera.ts";
import { applyLightPreset, type LightPreset, lightPresetFor, presetTone, setRainEffect } from "./effects.ts";
import { addPlants, removePlants, setPlantsVisible } from "./plantsLayer.ts";
import {
  addRegions,
  removeRegions,
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
  /** The map cannot be shown; the message is Indonesian and says what to do. */
  onFailure: (message: string) => void;
}

/** Indonesian failure texts for the "Coba lagi" card. */
const FAILURE = {
  webgl: "Browser ini tidak bisa menampilkan peta 3D karena WebGL mati. Coba browser lain atau nyalakan akselerasi grafis.",
  token: "Token Mapbox ditolak. Periksa MAPBOX_TOKEN di server lalu coba lagi.",
  style: "Peta dasar dari Mapbox gagal dimuat. Periksa koneksi internet lalu coba lagi.",
  slow: "Peta terlalu lama dimuat. Periksa koneksi internet lalu coba lagi.",
  setup: "Lapisan data gagal dipasang di peta. Coba lagi sebentar lagi.",
};
/** No first frame within this time: show the failure card instead of an endless "Memuat peta…". */
const LOAD_GUARD_MS = 15_000;
/** The intro waits for the first complete frame, but never longer than this. */
const IDLE_WAIT_MS = 4_000;

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

/** Resolves on the map's next `idle`, or after `capMs`, whichever comes first. */
function idleOrTimeout(map: mapboxgl.Map, capMs: number): Promise<void> {
  if (map.loaded() && !map.isMoving()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off("idle", done);
      resolve();
    };
    const timer = setTimeout(done, capMs);
    map.once("idle", done);
  });
}

type TestWindow = Window & { __malasMap?: mapboxgl.Map };

export function MapView({ token, regions, plants, onIntroStart, onIntroEnd, onRegionHover, onRegionPointer, onFailure }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks without re-creating the map.
  const handlers = useRef({ onIntroStart, onIntroEnd, onRegionHover, onRegionPointer, onFailure });
  handlers.current = { onIntroStart, onIntroEnd, onRegionHover, onRegionPointer, onFailure };

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let failed = false;
    let loadGuard: ReturnType<typeof setTimeout> | undefined;
    let riseTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (message: string, detail?: unknown) => {
      if (disposed || failed) return;
      failed = true;
      clearTimeout(loadGuard);
      clearTimeout(riseTimer);
      if (detail !== undefined) console.warn("[peta]", detail);
      handlers.current.onFailure(message);
    };

    mapboxgl.accessToken = token;
    const store = useAppStore.getState();
    const pinned = pinnedPreset();
    let preset: LightPreset = pinned ?? lightPresetFor(new Date());
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
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
    } catch (err) {
      // Mapbox throws here when the browser has no usable WebGL.
      fail(FAILURE.webgl, err);
      return;
    }
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");

    let styleLoaded = false;
    let ready = false;
    let introStarted = false;
    let introDone = false;
    let backgroundClick = false;

    loadGuard = setTimeout(() => fail(FAILURE.slow), LOAD_GUARD_MS);
    map.once("idle", () => clearTimeout(loadGuard));

    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) return fail(FAILURE.token, e.error);
      if (!styleLoaded) return fail(FAILURE.style, e.error);
      // A tile or glyph that failed after the map is up: the map keeps working, so only log it.
      console.warn("[peta]", e.error?.message ?? e);
    });

    const lightTimer = pinned
      ? undefined
      : setInterval(() => {
          preset = applyLightPreset(map, new Date());
          setRegionTone(map, presetTone(preset));
        }, 60_000);

    /** Adds terrain and the data layers. Safe to run again if the style ever reloads. */
    const setupStyle = async () => {
      styleLoaded = true;
      if (disposed || failed) return;
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });

      const now = useAppStore.getState();
      addRegions(
        map,
        regions,
        now.metric,
        {
          onSelect: (id) => useAppStore.getState().selectRegion(id),
          onHover: (id) => handlers.current.onRegionHover(id),
          onPointer: (point) => handlers.current.onRegionPointer(point),
        },
        presetTone(preset),
      );
      addPlants(map, plants, now.layers.plants);
      setRegionsVisible(map, now.layers.regions);
      setRainEffect(map, now.rain === "on");
      if (now.selectedRegionId) setSelectedRegion(map, now.selectedRegionId);

      // Clicking empty ground at the province view clears the region selection. Interactions outlive a
      // style reload, so this is added once.
      if (!backgroundClick) {
        backgroundClick = true;
        map.addInteraction("map-background-click", {
          type: "click",
          handler: () => {
            if (map.getZoom() < 11) useAppStore.getState().selectRegion(null);
          },
        });
      }

      ready = true;
      useAppStore.getState().setMap(map);
      // Test hook for scripts/smoke.ts (waits for idle, projects points). Read-only use only.
      (window as TestWindow).__malasMap = map;

      if (introDone) riseRegions(map, regions);
      if (introStarted) return;
      introStarted = true;

      await idleOrTimeout(map, IDLE_WAIT_MS);
      if (disposed || failed) return;
      clearTimeout(loadGuard);
      handlers.current.onIntroStart();
      // Columns rise while the camera is still descending, so they are growing as Kaltim comes into view.
      riseTimer = setTimeout(() => riseRegions(map, regions), 4300);
      await introFlight(map);
      if (disposed || failed) return;
      clearTimeout(riseTimer);
      riseRegions(map, regions);
      introDone = true;
      handlers.current.onIntroEnd();
      startIdleOrbit(map);
    };
    map.on("style.load", () => {
      setupStyle().catch((err: unknown) => fail(FAILURE.setup, err));
    });

    // React to store changes that the map must follow.
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (!ready || failed) return;
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
      clearTimeout(loadGuard);
      clearTimeout(riseTimer);
      clearInterval(lightTimer);
      unsubscribe();
      abortIntro();
      stopIdleOrbit();
      try {
        removeRegions(map);
        removePlants(map);
      } catch {
        // The map is going away; a layer it never finished adding is not worth an error.
      }
      useAppStore.getState().setMap(null);
      const w = window as TestWindow;
      if (w.__malasMap === map) delete w.__malasMap;
      map.remove();
    };
  }, [token, regions, plants]);

  // Inline style: mapbox-gl.css sets `.mapboxgl-map { position: relative }`, which would beat a class.
  return <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Peta 3D Kalimantan Timur" role="region" />;
}
