import type { Map as MapboxMap, TargetFeature, TerrainSpecification } from "mapbox-gl";
import { polygonAreaM2 } from "../../shared/estimate.ts";
import type { BuildingInput } from "../../shared/types.ts";
import { token } from "../theme.ts";
import { FLY_MS } from "./camera.ts";
import type { Tone } from "./effects.ts";

/** Every building of the Mapbox Standard basemap: hover and click go through this featureset. */
export const BUILDINGS = { featuresetId: "buildings", importId: "basemap" } as const;

/** The camera `selectBuildingAt` flies to: close enough that one building fills a good part of the view. */
export const BUILDING_ZOOM = 17.5;
const BUILDING_PITCH = 60;
/** How long `selectBuildingAt` waits for the tiles after the flight before it looks for the building. */
const SETTLE_CAP_MS = 8000;
/** Half the side of the screen box searched around a point for the building that holds it, in px. */
const SEARCH_RADIUS_PX = 28;
/**
 * The same for a point from a place search (a POI often sits in the yard or on the street in front of its
 * building): about 35 m at building zoom.
 */
export const PLACE_SEARCH_RADIUS_PX = 80;

/**
 * Terrain is switched off at building zoom, with hysteresis so a zoom hovering around the line does not
 * flip it back and forth. With terrain on at this zoom the page went to about 1 GB; the city of Samarinda
 * is flat, so nothing visible is lost.
 */
export const TERRAIN_OFF_ZOOM = 13.2;
export const TERRAIN_ON_ZOOM = 12.8;

/** Whether terrain should be on at `zoom`, given whether it is on now. */
export function terrainWanted(zoom: number, on: boolean): boolean {
  if (on) return zoom <= TERRAIN_OFF_ZOOM;
  return zoom < TERRAIN_ON_ZOOM;
}

type Geometry = { type: string; coordinates?: unknown };
interface BuildingFeature {
  id?: string | number;
  geometry: Geometry;
  properties?: Record<string, unknown> | null;
}

/** The outer rings and holes of a Polygon or MultiPolygon, as a list of polygons. */
function polygonsOf(geometry: Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  return [];
}

/** Footprint area of a building feature in m2 (all its polygons). */
export function footprintOf(geometry: Geometry): number {
  return polygonsOf(geometry).reduce((sum, p) => sum + polygonAreaM2(p), 0);
}

/** A point inside the building for the estimate: the mean of the outer ring of its largest polygon. */
export function centroidOf(geometry: Geometry): [number, number] | null {
  const polygons = polygonsOf(geometry);
  let best: number[][] | undefined;
  let bestArea = -1;
  for (const p of polygons) {
    const area = polygonAreaM2(p);
    if (area > bestArea && p[0]) [best, bestArea] = [p[0], area];
  }
  if (!best || best.length === 0) return null;
  const closed = best.length > 1 && best[0]![0] === best.at(-1)![0] && best[0]![1] === best.at(-1)![1];
  const ring = closed ? best.slice(0, -1) : best;
  let [x, y] = [0, 0];
  for (const [lng = 0, lat = 0] of ring) {
    x += lng;
    y += lat;
  }
  const c: [number, number] = [x / ring.length, y / ring.length];
  return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
}

/**
 * The estimate request for a clicked building: its id (or, without one, a key from its rounded centre),
 * centre, footprint area and height. Standard gives every building a height; 3 m is its default for an
 * unknown height, which the estimate treats as unknown. Null when the geometry is not a polygon.
 */
export function buildingInputFrom(feature: BuildingFeature): BuildingInput | null {
  const at = centroidOf(feature.geometry);
  if (!at) return null;
  const [lng, lat] = at;
  const rawHeight = Number(feature.properties?.height);
  const id = feature.id;
  return {
    featureId: id !== undefined && id !== null && String(id) !== "" ? `mapbox:${id}` : `at:${lng.toFixed(5)},${lat.toFixed(5)}`,
    lng,
    lat,
    // Whole m2, so the panel's "footprint × floors" adds up to the floor area it shows.
    footprintM2: Math.round(footprintOf(feature.geometry)),
    heightM: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : null,
  };
}

/**
 * Building hover and select colours (00-direction section 8). On a light ground: ink, the selection darker
 * than the hover. On a dark ground the hover is paper and the selection the light CO2 amber: rendered, the
 * night basemap theme (`faded`) grades light neutrals down toward the other buildings, so a paper-bright
 * selection all but vanished and a paper-muted hover was hard to see, while the amber stays clear. It is
 * the colour of what the panel measures.
 */
export function buildingColors(tone: Tone): { highlight: string; select: string } {
  return tone === "light"
    ? { highlight: token("--color-ink-faint"), select: token("--color-outline-light") }
    : { highlight: token("--color-paper"), select: token("--color-co2-4") };
}

/** Sets the basemap's building hover and select colours for the ground tone. */
export function setBuildingTone(map: MapboxMap, tone: Tone): void {
  const c = buildingColors(tone);
  map.setConfigProperty("basemap", "colorBuildingHighlight", c.highlight);
  map.setConfigProperty("basemap", "colorBuildingSelect", c.select);
}

type OnSelect = (input: BuildingInput) => void;

interface BuildingState {
  onSelect: OnSelect;
  hovered: TargetFeature | null;
  selected: TargetFeature | null;
  /** The terrain to put back below building zoom; null while terrain is on. */
  terrain: TerrainSpecification | null;
  onZoom: () => void;
}

const states = new WeakMap<MapboxMap, BuildingState>();
const INTERACTIONS = ["building-enter", "building-leave", "building-click", "building-background-click"] as const;
/** From this zoom a click on empty ground (no building, no other layer) closes the building panel. */
export const BACKGROUND_CLOSE_ZOOM = 14;

/**
 * Marks `feature` as the selected building (and only it) and returns its estimate request. The featureset
 * returns whole footprints (checked over about 11,600 building views: none came in pieces at a tile edge).
 */
function select(map: MapboxMap, s: BuildingState, feature: TargetFeature): BuildingInput | null {
  const input = buildingInputFrom(feature);
  if (!input) return null;
  if (s.selected) map.setFeatureState(s.selected, { select: false });
  s.selected = feature;
  map.setFeatureState(feature, { select: true });
  return input;
}

/**
 * Makes the basemap buildings hoverable and clickable (Standard `buildings` featureset): hover lights a
 * building, a click selects it and calls `onSelect` with the estimate request, and a click on empty ground
 * at building zoom calls `onBackground`. Also switches terrain off at building zoom. Returns a function
 * that undoes all of it.
 */
export function enableBuildingInteraction(map: MapboxMap, onSelect: OnSelect, tone: Tone, onBackground?: () => void): () => void {
  disableBuildingInteraction(map);
  const s: BuildingState = {
    onSelect,
    hovered: null,
    selected: null,
    terrain: null,
    onZoom: () => followTerrain(map, s),
  };
  states.set(map, s);
  setBuildingTone(map, tone);

  map.addInteraction("building-enter", {
    type: "mouseenter",
    target: BUILDINGS,
    handler: (e) => {
      if (!e.feature) return;
      if (s.hovered) map.setFeatureState(s.hovered, { highlight: false });
      s.hovered = e.feature;
      map.setFeatureState(e.feature, { highlight: true });
      map.getCanvas().style.cursor = "pointer";
    },
  });
  map.addInteraction("building-leave", {
    type: "mouseleave",
    target: BUILDINGS,
    handler: (e) => {
      // Leaving one building straight into the next can deliver the next one's enter first.
      if (s.hovered && e.feature?.id === s.hovered.id) {
        map.setFeatureState(s.hovered, { highlight: false });
        s.hovered = null;
        map.getCanvas().style.cursor = "";
      }
      return false;
    },
  });
  map.addInteraction("building-click", {
    type: "click",
    target: BUILDINGS,
    handler: (e) => {
      const input = e.feature ? select(map, s, e.feature) : null;
      if (input) s.onSelect(input);
    },
  });
  // A click no other interaction took: empty ground. At building zoom it closes the panel.
  map.addInteraction("building-background-click", {
    type: "click",
    handler: () => {
      if (onBackground && map.getZoom() >= BACKGROUND_CLOSE_ZOOM) onBackground();
    },
  });

  map.on("zoom", s.onZoom);
  followTerrain(map, s);
  return () => disableBuildingInteraction(map);
}

/** Removes the building interactions and puts terrain back. Safe to call more than once. */
export function disableBuildingInteraction(map: MapboxMap): void {
  const s = states.get(map);
  if (!s) return;
  states.delete(map);
  map.off("zoom", s.onZoom);
  for (const id of INTERACTIONS) map.removeInteraction(id);
  try {
    if (s.hovered) map.setFeatureState(s.hovered, { highlight: false });
    if (s.selected) map.setFeatureState(s.selected, { select: false });
    if (s.terrain && !map.getTerrain()) map.setTerrain(s.terrain);
  } catch {
    // The style is going away with the map; nothing left to reset.
  }
  map.getCanvas().style.cursor = "";
}

/** Clears the selected building on the map (the panel closed). */
export function clearBuildingSelection(map: MapboxMap): void {
  const s = states.get(map);
  if (!s?.selected) return;
  map.setFeatureState(s.selected, { select: false });
  s.selected = null;
}

/** Terrain off above TERRAIN_OFF_ZOOM, back on below TERRAIN_ON_ZOOM. */
function followTerrain(map: MapboxMap, s: BuildingState): void {
  const current = map.getTerrain();
  const on = Boolean(current);
  const want = terrainWanted(map.getZoom(), on);
  if (want === on) return;
  if (!want && current) {
    s.terrain = current;
    map.setTerrain(null);
  } else if (want && s.terrain) {
    map.setTerrain(s.terrain);
    s.terrain = null;
  }
}

/** Screen padding that keeps a building clear of the panels, in px. */
export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A short glide that brings a clicked building out from under a panel. */
const REVEAL_MS = 600;

/**
 * Moves the camera a little when the building at `at` sits under a panel (outside the padded view), so
 * the selection stays in sight next to the open panel. Does nothing when it is already in the clear.
 */
export function revealBuilding(map: MapboxMap, at: [number, number], padding: Padding): void {
  const p = map.project(at);
  const canvas = map.getCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const inView = p.x >= padding.left && p.x <= w - padding.right && p.y >= padding.top && p.y <= h - padding.bottom;
  if (inView) return;
  map.easeTo({ center: at, padding, duration: prefersReducedMotion() ? 0 : REVEAL_MS, essential: true });
}

/** Gap between a panel and the building the camera frames next to it, in px. */
const PANEL_GAP = 24;

/**
 * Screen padding that keeps a building clear of the open panels: the region sheet on the left, the
 * building panel and the chat panel (when open) on the right, or the building panel as a bottom sheet on
 * a phone.
 */
export function buildingViewPadding(): Padding {
  const pad: Padding = { top: PANEL_GAP, bottom: PANEL_GAP, left: PANEL_GAP, right: PANEL_GAP };
  if (typeof document === "undefined") return pad;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sheet = document.querySelector(".sheet-slot")?.getBoundingClientRect();
  const panel = document.querySelector(".building-slot")?.getBoundingClientRect();
  const chat = document.querySelector(".chat")?.getBoundingClientRect();
  if (sheet && sheet.width < w / 2) pad.left = Math.max(pad.left, sheet.right + PANEL_GAP);
  if (panel && panel.width < w / 2) pad.right = Math.max(pad.right, w - panel.left + PANEL_GAP);
  else if (panel && panel.height > 0) pad.bottom = Math.max(pad.bottom, h - panel.top + PANEL_GAP);
  // The chat panel sits left of the building panel when both are open.
  if (chat && chat.width > 0 && chat.width < w / 2 && chat.left > w / 2) pad.right = Math.max(pad.right, w - chat.left + PANEL_GAP);
  // Never pad the view away entirely (very narrow windows).
  if (pad.left + pad.right > w * 0.8) [pad.left, pad.right] = [PANEL_GAP, PANEL_GAP];
  if (pad.top + pad.bottom > h * 0.8) [pad.top, pad.bottom] = [PANEL_GAP, PANEL_GAP];
  return pad;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether [lng, lat] lies inside a polygon (ray casting on the outer ring, outside every hole). */
export function polygonContains(polygon: number[][][], [x, y]: [number, number]): boolean {
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi = 0, yi = 0] = ring[i]!;
      const [xj = 0, yj = 0] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const [outer, ...holes] = polygon;
  return Boolean(outer && inRing(outer) && !holes.some(inRing));
}

/** Whether a building's footprint (Polygon or MultiPolygon) holds [lng, lat]. */
export function footprintContains(geometry: Geometry, point: [number, number]): boolean {
  return polygonsOf(geometry).some((p) => polygonContains(p, point));
}

/**
 * The building at [lng, lat] on the current view: the one whose footprint holds the point, else the one
 * whose centre is nearest within `radius` px. At a pitched camera a neighbour's wall often covers the
 * projected ground point, so the frontmost feature there is not enough.
 */
export function buildingAt(map: MapboxMap, lng: number, lat: number, radius = SEARCH_RADIUS_PX): TargetFeature | null {
  const p = map.project([lng, lat]);
  const r = radius;
  const near = map.queryRenderedFeatures(
    [
      [p.x - r, p.y - r],
      [p.x + r, p.y + r],
    ],
    { target: BUILDINGS },
  ) as TargetFeature[];
  const holding = near.find((f) => footprintContains(f.geometry, [lng, lat]));
  if (holding) return holding;
  let nearest: TargetFeature | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const f of near) {
    const c = centroidOf(f.geometry);
    if (!c) continue;
    const q = map.project(c);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= r && d < best) [nearest, best] = [f, d];
  }
  return nearest;
}

export interface SelectAtOptions {
  /** Screen padding that keeps the building clear of the panels. */
  padding?: Padding;
  /** True once the request is out of date (the user clicked another building or closed the panel). */
  isStale?: () => boolean;
  /** How far from the point a building centre may be, in px at building zoom (default 28). */
  searchRadiusPx?: number;
}

/**
 * Selects the building at a point (the chat's "select building" action): flies there at building zoom,
 * waits for the tiles, picks the building whose footprint holds the point (or the nearest one within a
 * few metres) and marks it selected. Returns its estimate request, or null when there is no building there,
 * the interaction is not enabled, or the request went stale during the flight (then nothing is selected).
 */
export async function selectBuildingAt(map: MapboxMap, lng: number, lat: number, opts: SelectAtOptions = {}): Promise<BuildingInput | null> {
  if (!states.get(map)) return null;
  map.stop();
  // Listen before the flight starts (a flight without duration ends at once), and for the first idle
  // right at its end: that is when the tiles of the new view are in and drawn.
  const ready = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, FLY_MS + SETTLE_CAP_MS);
    map.once("moveend", () => {
      map.once("idle", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
  map.flyTo({
    center: [lng, lat],
    zoom: BUILDING_ZOOM,
    pitch: BUILDING_PITCH,
    bearing: map.getBearing(),
    ...(opts.padding ? { padding: opts.padding } : {}),
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
  await ready;
  const s = states.get(map);
  if (!s || opts.isStale?.()) return null;
  const feature = buildingAt(map, lng, lat, opts.searchRadiusPx);
  return feature ? select(map, s, feature) : null;
}
