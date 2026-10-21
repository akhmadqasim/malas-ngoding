import type { Map as MapboxMap } from "mapbox-gl";
import type { BuildingType } from "../../shared/types.ts";
import { api } from "../api.ts";
import { type MarkedPlace, showPlaces } from "../chat/placesLayer.ts";
import type { ChatAction } from "../chat/sse.ts";
import { type AppState, type BuildingHint, type LayerKey, type Metric, type PanelTab, type RainMode, useAppStore } from "../store.ts";
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

/**
 * What an action did, for the chat's action buttons: `ok`, `failed` (it ran but did not get there, for
 * example no building at the point) or `skipped` (unknown action, unusable input, no map).
 */
export type ActionOutcome = "ok" | "failed" | "skipped";

/** Gap between a panel and the point the camera frames next to it, in px. */
const PANEL_GAP = 24;
/** Room kept right of a selected place for its name label (the names sit right of the pins). */
const LABEL_ROOM = 160;

/** Lane buildings' padding (sheet, building panel), widened so the open chat panel never covers the point. */
function panelsPadding(): Padding | undefined {
  if (typeof document === "undefined") return undefined;
  const pad = buildingViewPadding();
  const w = window.innerWidth;
  const chat = document.querySelector(".chat")?.getBoundingClientRect();
  if (chat && chat.width > 0 && chat.width < w / 2) pad.right = Math.max(pad.right, w - chat.left + PANEL_GAP);
  // Never pad the view away entirely (narrow windows). With the sheet, the building panel and the chat open
  // side by side a 1280 px window keeps a strip of about 200 px, enough for one building.
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
const BUILDING_TYPES: readonly BuildingType[] = [
  "rumah",
  "ruko",
  "kantor",
  "pemerintahan",
  "sekolah",
  "kampus",
  "rumah_sakit",
  "hotel",
  "mal",
  "ibadah",
  "gudang",
  "industri",
];
const MAX_PLACES = 10;
/** Closer than this the view already shows streets and buildings. */
const CITY_ZOOM = 14;
/** The closest a fit to the marked places goes (one street block). */
const PLACES_MAX_ZOOM = 16;

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
/** How long a region flight may take to start after the selection (the region detail request). */
export const REGION_FLIGHT_WAIT_MS = 2500;

/**
 * A camera move right after a region selection waits until MapView's region flight has started (or the
 * wait is over), so it takes over that flight instead of being overridden by it when the region's centre
 * arrives a moment later.
 */
function afterRegionFlightStarts(map: MapboxMap): Promise<void> {
  const asked = regionAskedAt.get(map);
  if (asked === undefined) return Promise.resolve();
  const since = Date.now() - asked;
  if (since > REGION_FLIGHT_WAIT_MS || map.isMoving()) {
    regionAskedAt.delete(map);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off("movestart", done);
      regionAskedAt.delete(map);
      resolve();
    };
    const timer = setTimeout(done, REGION_FLIGHT_WAIT_MS - since);
    map.once("movestart", done);
  });
}

// ---------- the places find_places marked ----------

let marked: MarkedPlace[] = [];

/** The marked place at exactly this point (find_places' coordinates, as Claude passes them back). */
function markedAt([lng, lat]: [number, number]): MarkedPlace | undefined {
  return marked.find((p) => Math.abs(p.lng - lng) < 1e-6 && Math.abs(p.lat - lat) < 1e-6);
}

/** Forgets the marked places (a new conversation clears them from the map too). */
export function forgetMarkedPlaces(): void {
  marked = [];
}

/** Moves the camera so every marked place is in view, clear of the panels. False when nothing is marked. */
export function fitMarkedPlaces(target: ActionTarget = appTarget): boolean {
  const map = target.getState().map;
  if (!map || marked.length === 0) return false;
  if (marked.length === 1) {
    const only = marked[0]!;
    flyTo(map, target, [only.lng, only.lat], PLACES_MAX_ZOOM);
    return true;
  }
  const lngs = marked.map((p) => p.lng);
  const lats = marked.map((p) => p.lat);
  const padding = target.viewPadding() ?? { top: PANEL_GAP, bottom: PANEL_GAP, left: PANEL_GAP, right: PANEL_GAP };
  // The names sit right of the pins: keep room for the easternmost one.
  const room = { ...padding, top: padding.top + PANEL_GAP, right: padding.right + LABEL_ROOM };
  const camera = map.cameraForBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: room, pitch: 50, bearing: map.getBearing() },
  );
  if (!camera?.center) return false;
  const c = camera.center as { lng: number; lat: number } | [number, number];
  const center: [number, number] = Array.isArray(c) ? c : [c.lng, c.lat];
  map.flyTo({
    center,
    zoom: Math.min(PLACES_MAX_ZOOM, camera.zoom ?? PLACES_MAX_ZOOM),
    pitch: 50,
    bearing: map.getBearing(),
    padding: room,
    duration: target.reducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
  return true;
}

/**
 * Selects the building at a point as a click would: the camera flies there and the building panel opens.
 * A place the chat found passes its type and name along, so a school opens as a school. If the pick found
 * nothing because a region flight cut in, it tries once more; if there is still no building, the camera at
 * least goes there. Returns "failed" when no building was selected.
 */
async function selectBuilding(target: ActionTarget, lngLat: [number, number]): Promise<ActionOutcome> {
  const map = target.getState().map;
  if (map) await afterRegionFlightStarts(map);
  const place = markedAt(lngLat);
  const hint: BuildingHint | undefined = place ? { type: place.type, name: place.name } : undefined;
  const select = () => target.getState().selectBuildingAt(lngLat, hint);
  await select();
  let after = target.getState();
  // Interrupted before the camera reached the building (another flight took over): once more.
  if (after.map && after.buildingStatus === "empty" && after.map.getZoom() < BUILDING_ZOOM - 1) {
    await select();
    after = target.getState();
  }
  if (!after.map) return after.buildingStatus === "empty" ? "failed" : "ok";
  if (after.buildingStatus === "empty") {
    if (after.map.getZoom() < CITY_ZOOM) flyTo(after.map, target, lngLat, BUILDING_ZOOM);
    return "failed";
  }
  // Lane buildings frames the building beside its panel; the chat panel sits there too, so slide the
  // building (and the name of a marked place) out from under it when needed.
  const padding = target.viewPadding();
  if (padding && after.buildingStatus !== "idle") {
    const w = after.map.getCanvas().clientWidth;
    const withLabel = place && w - padding.left - padding.right - LABEL_ROOM > 2 * PANEL_GAP ? { ...padding, right: padding.right + LABEL_ROOM } : padding;
    revealBuilding(after.map, after.selectedBuildingAt ?? lngLat, withLabel);
  }
  return "ok";
}

function placesOf(v: unknown): MarkedPlace[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .flatMap((p): MarkedPlace[] => {
      const at = lngLatOf(p);
      if (!at || typeof p.name !== "string") return [];
      const type = oneOf(p.type, BUILDING_TYPES);
      return [{ name: p.name, lng: at[0], lat: at[1], ...(type ? { type } : {}) }];
    })
    .slice(0, MAX_PLACES);
}

/**
 * Runs one chat map action and says what it did. `replay` is set when the user presses the action's
 * button again: marked places then also bring the camera to them. Never throws.
 */
export async function runAction(
  action: ChatAction,
  target: ActionTarget = appTarget,
  opts: { replay?: boolean } = {},
): Promise<ActionOutcome> {
  const state = target.getState();
  const input = action.input ?? {};
  const did = (ok: boolean): ActionOutcome => (ok ? "ok" : "skipped");
  try {
    switch (action.name) {
      case "fly_to_region": {
        const id = typeof input.region === "string" ? input.region : null;
        if (!id) return "skipped";
        // A region is the province-level view: the building panel steps aside.
        if (state.buildingStatus !== "idle") state.closeBuilding();
        if (state.selectedRegionId !== id) {
          if (state.map) regionAskedAt.set(state.map, Date.now());
          state.selectRegion(id); // MapView flies to a newly selected region.
          return "ok";
        }
        // Already open: fly there again. The flight starts here, so a building pick after it waits for
        // nothing and simply takes the camera over.
        const centroid = await target.regionCentroid(id);
        const map = target.getState().map;
        if (!centroid || !map) return "skipped";
        flyToRegion(map, centroid);
        return "ok";
      }
      case "show_all_regions": {
        if (state.buildingStatus !== "idle") state.closeBuilding();
        if (state.selectedRegionId) {
          state.selectRegion(null); // MapView flies back to the province.
          return "ok";
        }
        if (!state.map) return "skipped";
        flyToProvince(state.map);
        return "ok";
      }
      case "fly_to": {
        const at = lngLatOf(input);
        if (!at || !isNum(input.zoom) || !state.map) return "skipped";
        await afterRegionFlightStarts(state.map);
        flyTo(state.map, target, at, Math.min(22, Math.max(0, input.zoom)));
        return "ok";
      }
      case "select_building_at": {
        const at = lngLatOf(input);
        if (!at) return "skipped";
        return await selectBuilding(target, at);
      }
      case "toggle_layer": {
        const layer = oneOf(input.layer, LAYERS);
        if (!layer || typeof input.visible !== "boolean") return "skipped";
        state.setLayer(layer, input.visible);
        return "ok";
      }
      case "set_metric": {
        const metric = oneOf(input.metric, METRICS);
        if (metric) state.setMetric(metric);
        return did(metric !== null);
      }
      case "set_rain": {
        const mode = oneOf(input.mode, RAIN);
        if (mode) state.setRain(mode);
        return did(mode !== null);
      }
      case "open_tab": {
        const tab = oneOf(input.tab, TABS);
        if (tab) state.setPanelTab(tab);
        return did(tab !== null);
      }
      case "mark_places": {
        const places = placesOf(input.places);
        if (places.length === 0 || !state.map) return "skipped";
        marked = places;
        target.showPlaces(state.map, places, (lngLat) => {
          void selectBuilding(target, lngLat).catch(() => {});
        });
        if (opts.replay) {
          await afterRegionFlightStarts(state.map);
          fitMarkedPlaces(target);
        }
        return "ok";
      }
      default:
        return "skipped";
    }
  } catch {
    // A failed camera move or building lookup shows in its own panel.
    return action.name === "select_building_at" ? "failed" : "skipped";
  }
}

/**
 * Runs map actions one after another, in the order the answer gave them: a region flight has started
 * before a building pick takes the camera over, never the other way round.
 */
export function actionQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => {});
    return next;
  };
}

/** Camera actions after which the view already shows what the answer is about. */
const SHOWS_A_PLACE = new Set<ChatAction["name"]>(["select_building_at", "fly_to"]);

/**
 * Whether an answer marked places but never took the camera to one of them (for example "rumah sakit di
 * Kukar" at the regency's view, where the pins are tiny). The chat then fits the camera to the pins.
 */
export function needsPlacesFit(actions: ChatAction[]): boolean {
  const lastMark = actions.findLastIndex((a) => a.name === "mark_places");
  return lastMark >= 0 && !actions.slice(lastMark + 1).some((a) => SHOWS_A_PLACE.has(a.name));
}
