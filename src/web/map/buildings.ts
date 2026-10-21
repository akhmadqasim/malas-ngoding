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
/** Half the side of the screen box `selectBuildingAt` searches when no building sits right on the point. */
const SEARCH_RADIUS_PX = 28;

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
    footprintM2: Math.round(footprintOf(feature.geometry) * 10) / 10,
    heightM: Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : null,
  };
}

/**
 * Building hover and select colours (00-direction section 8). On a light ground: ink, the selection darker
 * than the hover. On a dark ground the hover is paper-muted, but the selection is the light CO2 amber:
 * rendered, the night basemap theme (`faded`) grades light neutrals down to the colour of the other
 * buildings, so a paper-bright selection all but vanished, while the amber stays clear in every light
 * (at dusk, under `monochrome`, it reads as a light tint). It is the colour of what the panel measures.
 */
export function buildingColors(tone: Tone): { highlight: string; select: string } {
  return tone === "light"
    ? { highlight: token("--color-ink-faint"), select: token("--color-outline-light") }
    : { highlight: token("--color-paper-muted"), select: token("--color-co2-4") };
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
const INTERACTIONS = ["building-enter", "building-leave", "building-click"] as const;

/** The largest piece of the same building around a clicked one: a building cut by a tile edge comes in pieces. */
function wholestPiece(map: MapboxMap, feature: TargetFeature): TargetFeature {
  if (feature.id === undefined) return feature;
  const points = polygonsOf(feature.geometry).flatMap((p) => p[0] ?? []);
  if (points.length === 0) return feature;
  const screen = points.map(([lng = 0, lat = 0]) => map.project([lng, lat]));
  const xs = screen.map((p) => p.x);
  const ys = screen.map((p) => p.y);
  const pad = 4;
  const pieces = map
    .queryRenderedFeatures(
      [
        [Math.min(...xs) - pad, Math.min(...ys) - pad],
        [Math.max(...xs) + pad, Math.max(...ys) + pad],
      ],
      { target: BUILDINGS },
    )
    .filter((f) => f.id === feature.id) as TargetFeature[];
  let best = feature;
  let bestArea = footprintOf(feature.geometry);
  for (const piece of pieces) {
    const area = footprintOf(piece.geometry);
    if (area > bestArea) [best, bestArea] = [piece, area];
  }
  return best;
}

/** Marks `feature` as the selected building (and only it) and reports it. */
function select(map: MapboxMap, s: BuildingState, feature: TargetFeature): boolean {
  const input = buildingInputFrom(wholestPiece(map, feature));
  if (!input) return false;
  if (s.selected) map.setFeatureState(s.selected, { select: false });
  s.selected = feature;
  map.setFeatureState(feature, { select: true });
  s.onSelect(input);
  return true;
}

/**
 * Makes the basemap buildings hoverable and clickable (Standard `buildings` featureset): hover lights a
 * building, a click selects it and calls `onSelect` with the estimate request. Also switches terrain off
 * at building zoom. Returns a function that undoes all of it.
 */
export function enableBuildingInteraction(map: MapboxMap, onSelect: OnSelect, tone: Tone): () => void {
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
      if (e.feature) select(map, s, e.feature);
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
 * building panel on the right, or the building panel as a bottom sheet on a phone.
 */
export function buildingViewPadding(): Padding {
  const pad: Padding = { top: PANEL_GAP, bottom: PANEL_GAP, left: PANEL_GAP, right: PANEL_GAP };
  if (typeof document === "undefined") return pad;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sheet = document.querySelector(".sheet-slot")?.getBoundingClientRect();
  const panel = document.querySelector(".building-slot")?.getBoundingClientRect();
  if (sheet && sheet.width < w / 2) pad.left = Math.max(pad.left, sheet.right + PANEL_GAP);
  if (panel && panel.width < w / 2) pad.right = Math.max(pad.right, w - panel.left + PANEL_GAP);
  else if (panel && panel.height > 0) pad.bottom = Math.max(pad.bottom, h - panel.top + PANEL_GAP);
  // Never pad the view away entirely (very narrow windows).
  if (pad.left + pad.right > w * 0.8) [pad.left, pad.right] = [PANEL_GAP, PANEL_GAP];
  if (pad.top + pad.bottom > h * 0.8) [pad.top, pad.bottom] = [PANEL_GAP, PANEL_GAP];
  return pad;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Selects the building at a point, as a click would (the chat's "select building" action): flies there at
 * building zoom, waits for the tiles, picks the building under the point (or the nearest one within a few
 * metres), selects it and calls the `onSelect` of `enableBuildingInteraction`. False when there is no
 * building there or the interaction is not enabled.
 */
export async function selectBuildingAt(map: MapboxMap, lng: number, lat: number, padding?: Padding): Promise<boolean> {
  if (!states.get(map)) return false;
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
    ...(padding ? { padding } : {}),
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
  await ready;
  const s = states.get(map);
  if (!s) return false;
  const p = map.project([lng, lat]);
  const exact = map.queryRenderedFeatures(p, { target: BUILDINGS }) as TargetFeature[];
  let feature: TargetFeature | undefined = exact[0];
  if (!feature) {
    const r = SEARCH_RADIUS_PX;
    const near = map.queryRenderedFeatures(
      [
        [p.x - r, p.y - r],
        [p.x + r, p.y + r],
      ],
      { target: BUILDINGS },
    ) as TargetFeature[];
    let best = Number.POSITIVE_INFINITY;
    for (const f of near) {
      const c = centroidOf(f.geometry);
      if (!c) continue;
      const q = map.project(c);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best) [feature, best] = [f, d];
    }
  }
  return feature ? select(map, s, feature) : false;
}
