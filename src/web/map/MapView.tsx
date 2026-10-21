import mapboxgl, { type FogSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { api, type PlantCollection, type RegionCollection } from "../api.ts";
import { useAppStore } from "../store.ts";
import { rainVisible, startAutoRain } from "./autoRain.ts";
import {
  abortIntro,
  chatInsetRight,
  flyToProvince,
  flyToRegion,
  GLOBE_VIEW,
  introFlight,
  setRegionFlyer,
  startIdleOrbit,
  stopIdleOrbit,
} from "./camera.ts";
import {
  applyLightPreset,
  basemapLight,
  BASEMAP_THEME,
  type LightPreset,
  lightPresetFor,
  overcastOpacity,
  presetTone,
  resolvePreset,
  setRainEffect,
} from "./effects.ts";
import { addPlants, removePlants, setPlantLifts, setPlantsLanded, setPlantsVisible } from "./plantsLayer.ts";
import { basemapLabelConfig, REGION_LABEL_LAYER } from "./regionLabels.ts";
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

/** Room around a framed region, so the sheet, the dock and the map tools never cover any of it. */
const FRAME_GAP_PX = 24;

/**
 * Camera padding measured from the chrome on screen: left of the sheet's right edge, above the dock's
 * highest card, right of the map tools or, when it is open, of the chat panel. Falls back to a fixed frame
 * when the chrome is not there.
 */
function chromePadding(): { top: number; bottom: number; left: number; right: number } {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const sheet = rect(".sheet");
  const cards = [rect(".legend"), rect(".controls")].filter((r): r is DOMRect => r !== undefined);
  const tools = rect(".map-tools");
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dockTop = cards.length ? Math.min(...cards.map((r) => r.top)) : h - 80;
  // On narrow screens the sheet sits on top and the dock spans the bottom: frame between them.
  const sheetBeside = sheet ? sheet.right < w / 2 : false;
  return {
    top: (sheet && !sheetBeside ? sheet.bottom : 0) + FRAME_GAP_PX,
    bottom: Math.max(h - dockTop, 0) + FRAME_GAP_PX,
    left: (sheet && sheetBeside ? sheet.right : 0) + FRAME_GAP_PX,
    right: Math.max((tools ? w - tools.left : 0) + FRAME_GAP_PX, chatInsetRight(FRAME_GAP_PX)),
  };
}

export function MapView({ token, regions, plants, onIntroStart, onIntroEnd, onRegionHover, onRegionPointer, onFailure }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const overcast = useRef<HTMLDivElement>(null);
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
    // The light: the presenter's choice (Cahaya control, or `?cahaya=`), or the time of day in WITA.
    let preset: LightPreset = resolvePreset(useAppStore.getState().lightMode, new Date());
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: container.current,
        style: "mapbox://styles/mapbox/standard",
        projection: "globe",
        ...GLOBE_VIEW,
        antialias: true,
        attributionControl: false,
        // No snap to north: the idle sway passes within 7° of north (it swings from -26° to -2°), and a
        // gesture ending there would ease the camera to 0° and move the sway off the arc the names hold on.
        bearingSnap: 0,
        // Indonesian place names on the basemap (Selat Makassar, Laut Sulawesi).
        language: "id",
        config: {
          basemap: {
            lightPreset: basemapLight(preset),
            theme: BASEMAP_THEME,
            show3dLandmarks: false,
            showPointOfInterestLabels: false,
            showTransitLabels: false,
            // Basemap names on the globe, our own region labels at the province view, basemap names again
            // closer in (basemapLabelConfig).
            ...basemapLabelConfig(GLOBE_VIEW.zoom),
          },
        },
      });
    } catch (err) {
      // Mapbox throws here when the browser has no usable WebGL.
      fail(FAILURE.webgl, err);
      return;
    }
    useAppStore.getState().setLightPreset(preset);
    // The Mapbox wordmark and the full attribution stay on screen (Mapbox terms), on one line under the
    // sheet. Zoom, compass and the rest are our own tools (panels/MapTools.tsx).
    map.addControl(new mapboxgl.AttributionControl({ compact: false }), "bottom-left");

    let styleLoaded = false;
    let ready = false;
    let introStarted = false;
    let introDone = false;
    let backgroundClick = false;
    let stopAutoRain: (() => void) | undefined;

    loadGuard = setTimeout(() => fail(FAILURE.slow), LOAD_GUARD_MS);
    map.once("idle", () => clearTimeout(loadGuard));

    map.on("error", (e) => {
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) return fail(FAILURE.token, e.error);
      if (!styleLoaded) return fail(FAILURE.style, e.error);
      // A tile or glyph that failed after the map is up: the map keeps working, so only log it.
      console.warn("[peta]", e.error?.message ?? e);
    });

    /** The overcast tint follows the rain: none from afar, fading in with it toward building zoom. */
    const updateOvercast = () => {
      const el = overcast.current;
      if (el) el.style.opacity = String(overcastOpacity(rainVisible(useAppStore.getState()), presetTone(preset), map.getZoom()));
    };
    map.on("zoom", updateOvercast);

    // Basemap labels follow the zoom: place names name the globe, give way to the region labels while the
    // columns stand and return at city zoom; road names wait for city zoom. The config only changes when
    // the view crosses a threshold, and that includes the middle of a flight (the intro crosses zoom 5.5).
    let basemapLabels = basemapLabelConfig(GLOBE_VIEW.zoom);
    const updateBasemapLabels = () => {
      const next = basemapLabelConfig(map.getZoom(), introDone ? "landed" : "intro");
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        if (next[key] !== basemapLabels[key]) map.setConfigProperty("basemap", key, next[key]);
      }
      basemapLabels = next;
    };
    map.on("zoom", updateBasemapLabels);

    // The basemap's own fog, captured before the rain haze ever replaces it, so it can be put back.
    let baseFog: FogSpecification | null | undefined;

    /** Switches the light and everything that follows the ground tone: ramps, outlines, rain, tint. */
    const applyLight = (next: LightPreset) => {
      if (next === preset) return;
      preset = next;
      applyLightPreset(map, next);
      const tone = presetTone(next);
      setRegionTone(map, tone);
      setRainEffect(map, rainVisible(useAppStore.getState()), tone, baseFog ?? null);
      updateOvercast();
      useAppStore.getState().setLightPreset(next);
    };
    // In automatic mode the light follows the clock; the check is cheap, so once a minute is plenty.
    const lightTimer = setInterval(() => {
      if (ready && !failed && useAppStore.getState().lightMode === "auto") applyLight(lightPresetFor(new Date()));
    }, 60_000);

    /** Adds terrain and the data layers. Safe to run again if the style ever reloads. */
    const setupStyle = async () => {
      styleLoaded = true;
      if (disposed || failed) return;
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });
      if (baseFog === undefined) baseFog = map.getFog();

      const now = useAppStore.getState();
      addRegions(
        map,
        regions,
        now.metric,
        {
          onSelect: (id) => useAppStore.getState().selectRegion(id),
          onHover: (id) => handlers.current.onRegionHover(id),
          onPointer: (point) => handlers.current.onRegionPointer(point),
          // The plant pins stand on the column tops and move with them.
          onColumnTops: (tops) => setPlantLifts(map, tops),
        },
        presetTone(preset),
      );
      // Plant pins go under the region names: a name may sit over a pin, and a pin never costs a name.
      addPlants(map, plants, now.layers.plants, { below: REGION_LABEL_LAYER, regions });
      setRegionsVisible(map, now.layers.regions);
      setRainEffect(map, rainVisible(now), presetTone(preset), baseFog ?? null);
      updateOvercast();
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
      stopAutoRain ??= startAutoRain(map);
      useAppStore.getState().setMap(map);
      // Test hook for scripts/smoke.ts (waits for idle, projects points). Read-only use only.
      (window as TestWindow).__malasMap = map;

      if (introDone) {
        riseRegions(map, regions);
        setPlantsLanded(map);
      }
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
      updateBasemapLabels();
      // Plant markers wait for the landed, idle map (setPlantsLanded explains why).
      idleOrTimeout(map, IDLE_WAIT_MS).then(() => {
        if (!disposed && !failed) setPlantsLanded(map);
      });
      handlers.current.onIntroEnd();
      startIdleOrbit(map);
    };
    map.on("style.load", () => {
      setupStyle().catch((err: unknown) => fail(FAILURE.setup, err));
    });

    /** Frames a selected region inside the space the chrome (and the open chat) leaves free. */
    const flyToSelected = (id: string) => {
      const bounds = bboxOf(regions, id);
      api
        .region(id)
        .then((r) => r.centroid)
        .catch(() => (bounds ? centerOf(bounds) : null))
        .then((centroid) => {
          // Skip when the user picked another region while the request was out.
          if (!disposed && centroid && useAppStore.getState().selectedRegionId === id) flyToRegion(map, centroid, { bounds, padding: chromePadding() });
        });
    };
    setRegionFlyer(map, flyToSelected);

    // React to store changes that the map must follow.
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (!ready || failed) return;
      if (s.metric !== prev.metric) setRegionMetric(map, s.metric);
      if (s.layers.regions !== prev.layers.regions) setRegionsVisible(map, s.layers.regions);
      if (s.layers.plants !== prev.layers.plants) setPlantsVisible(map, s.layers.plants);
      if (rainVisible(s) !== rainVisible(prev)) {
        setRainEffect(map, rainVisible(s), presetTone(preset), baseFog ?? null);
        updateOvercast();
      }
      if (s.lightMode !== prev.lightMode) applyLight(resolvePreset(s.lightMode, new Date()));
      if (s.hoveredRegionId !== prev.hoveredRegionId) setRegionHover(map, s.hoveredRegionId);
      if (s.selectedRegionId !== prev.selectedRegionId) {
        setSelectedRegion(map, s.selectedRegionId);
        if (s.selectedRegionId) {
          flyToSelected(s.selectedRegionId);
        } else {
          flyToProvince(map);
        }
      }
    });

    return () => {
      disposed = true;
      clearTimeout(loadGuard);
      clearTimeout(riseTimer);
      clearInterval(lightTimer);
      stopAutoRain?.();
      unsubscribe();
      setRegionFlyer(map, null);
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

  return (
    <>
      {/* Inline style: mapbox-gl.css sets `.mapboxgl-map { position: relative }`, which would beat a class. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} aria-label="Peta 3D Kalimantan Timur" role="region" />
      <div ref={overcast} className="overcast" aria-hidden />
    </>
  );
}
