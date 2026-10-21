import type { Map as MapboxMap } from "mapbox-gl";
import { api } from "../api.ts";
import { type MarkedPlace, showPlaces } from "../chat/placesLayer.ts";
import type { ChatAction } from "../chat/sse.ts";
import { type AppState, type LayerKey, type Metric, type PanelTab, type RainMode, useAppStore } from "../store.ts";
import { BUILDING_ZOOM, buildingViewPadding, type Padding, revealBuilding } from "./buildings.ts";
import { FLY_MS, flyToProvince, flyToRegion } from "./camera.ts";

// Turns the map actions of the AI chat (server `action` events) into store and camera calls.

/** Where actions land. Tests pass their own; the app uses the store, the map in it and the API. */
export interface ActionTarget {
  getState: () => AppState;
  /** A region's centre, to fly to the region that is already selected. */
  regionCentroid: (id: string) => Promise<[number, number] | null>;
  /** Marks found places on the map; a click on one selects the building there. */
  showPlaces: (map: MapboxMap, places: MarkedPlace[], onPick: (lngLat: [number, number]) => void) => void;
  reducedMotion: () => boolean;
  /** Screen padding that keeps a point clear of the open panels, the chat included; none in tests. */
  viewPadding: () => Padding | undefined;
}

/** Gap between a panel and the point the camera frames next to it, in px. */
const PANEL_GAP = 24;

/** Lane buildings' padding (sheet, building panel), widened so the open chat panel never covers the point. */
function panelsPadding(): Padding | undefined {
  if (typeof document === "undefined") return undefined;
  const pad = buildingViewPadding();
  const w = window.innerWidth;
  const chat = document.querySelector(".chat")?.getBoundingClientRect();
  if (chat && chat.width > 0 && chat.width < w / 2) pad.right = Math.max(pad.right, w - chat.left + PANEL_GAP);
  // Never pad the view away entirely (narrow windows). With the sheet, the building panel and the chat open
  // side by side a 1366 px window keeps a strip of about 230 px, enough for one building.
  if (pad.left + pad.right > w * 0.9) [pad.left, pad.right] = [PANEL_GAP, PANEL_GAP];
  return pad;
}

export const appTarget: ActionTarget = {
  getState: () => useAppStore.getState(),
  regionCentroid: (id) =>
    api
      .region(id)
      .then((r) => r.centroid)
      .catch(() => null),
  showPlaces,
  reducedMotion: () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  viewPadding: panelsPadding,
};

const LAYERS: readonly LayerKey[] = ["regions", "plants", "buildings"];
const METRICS: readonly Metric[] = ["co2", "kwh"];
const RAIN: readonly RainMode[] = ["auto", "on", "off"];
const TABS: readonly PanelTab[] = ["energi", "emisi", "surya", "cuaca"];
const MAX_PLACES = 10;
/** Closer than this the view already shows streets and buildings. */
const CITY_ZOOM = 14;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const lngLatOf = (i: Record<string, unknown>): [number, number] | null =>
  isNum(i.lng) && isNum(i.lat) && Math.abs(i.lng) <= 180 && Math.abs(i.lat) <= 90 ? [i.lng, i.lat] : null;
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;

function flyTo(map: MapboxMap, target: ActionTarget, center: [number, number], zoom: number): void {
  const padding = target.viewPadding();
  map.flyTo({
    center,
    zoom,
    // Tilted close in, so buildings read as 3D; the province view keeps its own tilt.
    pitch: zoom >= 14 ? 60 : zoom >= 9 ? 50 : map.getPitch(),
    ...(padding ? { padding } : {}),
    duration: target.reducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
}

/** When the chat last selected a region on a map; MapView starts that flight once the region's centre has loaded. */
const regionAskedAt = new WeakMap<MapboxMap, number>();
/** How long a region flight may take to start after the selection. */
export const REGION_FLIGHT_WAIT_MS = 1000;

/**
 * A camera move right after a region selection waits until MapView's region flight has started (or a
 * second has passed), so it takes over that flight instead of being overridden by it when the region's
 * centre arrives a moment later.
 */
function afterRegionFlightStarts(map: MapboxMap): Promise<void> {
  const since = Date.now() - (regionAskedAt.get(map) ?? 0);
  if (since > REGION_FLIGHT_WAIT_MS || map.isMoving()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off("movestart", done);
      resolve();
    };
    const timer = setTimeout(done, REGION_FLIGHT_WAIT_MS - since);
    map.once("movestart", done);
  });
}

/**
 * Selects the building at a point as a click would: the camera flies there and the building panel opens.
 * When no building could be picked without the camera ever going there (the map's building layer is not
 * ready), it still flies there, so the answer's place is on screen.
 */
async function selectBuilding(target: ActionTarget, lngLat: [number, number]): Promise<void> {
  const map = target.getState().map;
  if (map) await afterRegionFlightStarts(map);
  await target.getState().selectBuildingAt(lngLat);
  const after = target.getState();
  if (!after.map) return;
  if (after.buildingStatus === "empty" && after.map.getZoom() < CITY_ZOOM) {
    flyTo(after.map, target, lngLat, BUILDING_ZOOM);
    return;
  }
  // Lane buildings frames the building beside its panel; the chat panel sits there too, so slide the
  // building out from under it when needed.
  const padding = target.viewPadding();
  if (padding && after.buildingStatus !== "idle") revealBuilding(after.map, after.selectedBuildingAt ?? lngLat, padding);
}

function placesOf(v: unknown): MarkedPlace[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .flatMap((p) => {
      const at = lngLatOf(p);
      return at && typeof p.name === "string" ? [{ name: p.name, lng: at[0], lat: at[1] }] : [];
    })
    .slice(0, MAX_PLACES);
}

/**
 * Runs one chat map action. Returns false when the action is unknown, its input is unusable or the map is
 * not ready; the chat then simply has nothing to show. Never throws.
 */
export async function runAction(action: ChatAction, target: ActionTarget = appTarget): Promise<boolean> {
  const state = target.getState();
  const input = action.input ?? {};
  try {
    switch (action.name) {
      case "fly_to_region": {
        const id = typeof input.region === "string" ? input.region : null;
        if (!id) return false;
        // A region is the province-level view: the building panel steps aside.
        if (state.buildingStatus !== "idle") state.closeBuilding();
        if (state.selectedRegionId !== id) {
          if (state.map) regionAskedAt.set(state.map, Date.now());
          state.selectRegion(id); // MapView flies to a newly selected region.
          return true;
        }
        const centroid = await target.regionCentroid(id);
        const map = target.getState().map;
        if (!centroid || !map) return false;
        flyToRegion(map, centroid);
        return true;
      }
      case "show_all_regions": {
        if (state.buildingStatus !== "idle") state.closeBuilding();
        if (state.selectedRegionId) {
          state.selectRegion(null); // MapView flies back to the province.
          return true;
        }
        if (!state.map) return false;
        flyToProvince(state.map);
        return true;
      }
      case "fly_to": {
        const at = lngLatOf(input);
        if (!at || !isNum(input.zoom) || !state.map) return false;
        await afterRegionFlightStarts(state.map);
        flyTo(state.map, target, at, Math.min(22, Math.max(0, input.zoom)));
        return true;
      }
      case "select_building_at": {
        const at = lngLatOf(input);
        if (!at) return false;
        await selectBuilding(target, at);
        return true;
      }
      case "toggle_layer": {
        const layer = oneOf(input.layer, LAYERS);
        if (!layer || typeof input.visible !== "boolean") return false;
        state.setLayer(layer, input.visible);
        return true;
      }
      case "set_metric": {
        const metric = oneOf(input.metric, METRICS);
        if (!metric) return false;
        state.setMetric(metric);
        return true;
      }
      case "set_rain": {
        const mode = oneOf(input.mode, RAIN);
        if (!mode) return false;
        state.setRain(mode);
        return true;
      }
      case "open_tab": {
        const tab = oneOf(input.tab, TABS);
        if (!tab) return false;
        state.setPanelTab(tab);
        return true;
      }
      case "mark_places": {
        const places = placesOf(input.places);
        if (places.length === 0 || !state.map) return false;
        target.showPlaces(state.map, places, (lngLat) => {
          void selectBuilding(target, lngLat).catch(() => {});
        });
        return true;
      }
      default:
        return false;
    }
  } catch {
    // A failed camera move or building lookup shows in its own panel; the chat answer stands.
    return false;
  }
}
