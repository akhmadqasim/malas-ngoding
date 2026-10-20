import type { ExpressionSpecification, GeoJSONSourceSpecification, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { RegionCollection } from "../api.ts";
import type { Metric } from "../store.ts";
import type { RegionSummary } from "../../shared/types.ts";

export const REGION_SOURCE = "regions";
export const REGION_LAYER = "regions-extrusion";
const OUTLINE_LAYER = "regions-outline";

/** Tallest and shortest column at the province view, in metres. Scaled down again as the user zooms in. */
const MAX_HEIGHT_M = 75_000;
const MIN_HEIGHT_M = 4_000;
/** Above this zoom the city and its buildings matter more than the columns, so they flatten out and hide. */
const HIDE_ZOOM = 12;

/** Low to high intensity. CO2 burns from dusky violet to coal-ember; electricity runs from deep blue to bright current. */
export const RAMPS: Record<Metric, readonly [string, string, string, string]> = {
  co2: ["#4a3f7a", "#b8487a", "#ff6a3d", "#ffc65c"],
  kwh: ["#1f4a7a", "#2a8fc4", "#3fd6e0", "#c8fbff"],
};
/** Unselected regions while one is selected: a cool mid grey that recedes on both day and night maps. */
const DIM_COLOR = "#56637d";

export interface RegionHover {
  id: string;
  name: string;
  value: number;
  point: { x: number; y: number };
}
export interface RegionHandlers {
  onSelect?: (id: string | null) => void;
  onHover?: (hover: RegionHover | null) => void;
}

const metricValue = (r: RegionSummary, metric: Metric) => (metric === "co2" ? r.co2KgYear : r.kwhYear);

/** 0..1 per region. Square root so small regions (Mahakam Ulu) still read, and Samarinda does not dwarf all. */
export function intensities(regions: RegionSummary[], metric: Metric): Map<string, number> {
  const max = Math.max(...regions.map((r) => metricValue(r, metric)), 1);
  return new Map(regions.map((r) => [r.id, Math.sqrt(Math.max(metricValue(r, metric), 0) / max)]));
}

const heightFor = (t: number) => MIN_HEIGHT_M + (MAX_HEIGHT_M - MIN_HEIGHT_M) * t;

function colorExpression(metric: Metric): ExpressionSpecification {
  const [a, b, c, d] = RAMPS[metric];
  return [
    "case",
    ["boolean", ["feature-state", "dim"], false],
    DIM_COLOR,
    ["interpolate", ["linear"], ["coalesce", ["feature-state", "t"], 0], 0, a, 0.4, b, 0.75, c, 1, d],
  ];
}

// --- Height animation -------------------------------------------------------------------------
// Heights live in feature-state `h`, so animating them only updates paint buffers (no re-tiling).

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}
interface LayerState {
  map: MapboxMap;
  regions: RegionSummary[];
  metric: Metric;
  heights: Map<string, number>;
  tweens: Map<string, Tween>;
  frame: number;
  hovered: string | null;
  selected: string | null;
  /** False until `riseRegions()`: columns stay flat while the intro flies in. */
  risen: boolean;
}
let state: LayerState | null = null;
let onMouseMove: ((e: MapMouseEvent) => void) | null = null;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

function tick(now: number) {
  if (!state) return;
  const s = state;
  for (const [id, tw] of s.tweens) {
    if (now < tw.start) continue;
    const p = Math.min((now - tw.start) / tw.duration, 1);
    const h = tw.from + (tw.to - tw.from) * easeOutCubic(p);
    s.heights.set(id, h);
    s.map.setFeatureState({ source: REGION_SOURCE, id }, { h });
    if (p >= 1) s.tweens.delete(id);
  }
  s.frame = s.tweens.size ? requestAnimationFrame(tick) : 0;
}

function animateTo(id: string, to: number, duration: number, delay = 0) {
  if (!state) return;
  const from = state.heights.get(id) ?? 0;
  state.tweens.set(id, { from, to, start: performance.now() + delay, duration });
  if (!state.frame) state.frame = requestAnimationFrame(tick);
}

/** Target height for a region given the selection: the chosen one grows a little, the rest step back. */
function targetHeight(id: string): number {
  if (!state?.risen) return 0;
  const t = intensities(state.regions, state.metric).get(id) ?? 0;
  const base = heightFor(t);
  if (!state.selected) return state.hovered === id ? base * 1.06 : base;
  return id === state.selected ? base * 1.1 : base * 0.4;
}

function writeIntensity() {
  if (!state) return;
  for (const [id, t] of intensities(state.regions, state.metric)) {
    state.map.setFeatureState({ source: REGION_SOURCE, id }, { t });
  }
}

// --- Public API ---------------------------------------------------------------------------------

/**
 * Adds the 10 regions as flat columns at height 0. Call `riseRegions()` to grow them (the intro does
 * this as the camera lands). Hover shows a glow and calls `onHover`; click calls `onSelect`.
 */
export function addRegions(map: MapboxMap, fc: RegionCollection, metric: Metric, handlers: RegionHandlers = {}): void {
  removeRegions(map);
  map.addSource(REGION_SOURCE, { type: "geojson", data: fc as unknown as GeoJSONSourceSpecification["data"], promoteId: "id" });

  const zoomScaled = (value: ExpressionSpecification): ExpressionSpecification => [
    "interpolate",
    ["linear"],
    ["zoom"],
    6.6,
    value,
    8,
    ["*", value, 0.3],
    9.5,
    ["*", value, 0.08],
    HIDE_ZOOM,
    0,
  ];
  const height: ExpressionSpecification = ["coalesce", ["feature-state", "h"], 0];

  map.addLayer({
    id: REGION_LAYER,
    type: "fill-extrusion",
    source: REGION_SOURCE,
    slot: "middle",
    maxzoom: HIDE_ZOOM,
    paint: {
      "fill-extrusion-color": colorExpression(metric),
      "fill-extrusion-height": zoomScaled(height),
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.88, HIDE_ZOOM, 0],
      "fill-extrusion-emissive-strength": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.72],
      "fill-extrusion-vertical-gradient": true,
      "fill-extrusion-ambient-occlusion-intensity": 0.25,
    },
  });
  map.addLayer({
    id: OUTLINE_LAYER,
    type: "line",
    source: REGION_SOURCE,
    slot: "middle",
    paint: {
      "line-color": "#cfe3ff",
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 9, 0.5, 13, 0.15],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 1.6],
      "line-emissive-strength": 1,
    },
  });

  const regions = fc.features.map((f) => f.properties);
  state = { map, regions, metric, heights: new Map(), tweens: new Map(), frame: 0, hovered: null, selected: null, risen: false };
  for (const r of regions) state.heights.set(r.id, 0);
  writeIntensity();

  const regionOf = (id: unknown) => state?.regions.find((r) => r.id === id);
  const reportHover = (point: { x: number; y: number }) => {
    const r = regionOf(state?.hovered);
    if (r && state) handlers.onHover?.({ id: r.id, name: r.name, value: metricValue(r, state.metric), point: { x: point.x, y: point.y } });
  };
  // The tooltip follows the pointer while a region is hovered (mouseenter/leave track which one).
  onMouseMove = (e) => reportHover(e.point);
  map.on("mousemove", onMouseMove);

  map.addInteraction("regions-enter", {
    type: "mouseenter",
    target: { layerId: REGION_LAYER },
    handler: (e) => {
      const id = e.feature?.id;
      if (!state || typeof id !== "string") return;
      state.hovered = id;
      map.setFeatureState({ source: REGION_SOURCE, id }, { hover: true });
      map.getCanvas().style.cursor = "pointer";
      animateTo(id, targetHeight(id), 450);
      reportHover(e.point);
    },
  });
  map.addInteraction("regions-leave", {
    type: "mouseleave",
    target: { layerId: REGION_LAYER },
    handler: (e) => {
      const id = e.feature?.id;
      map.getCanvas().style.cursor = "";
      handlers.onHover?.(null);
      if (!state || typeof id !== "string") return;
      state.hovered = null;
      map.setFeatureState({ source: REGION_SOURCE, id }, { hover: false });
      animateTo(id, targetHeight(id), 450);
      return false;
    },
  });
  map.addInteraction("regions-click", {
    type: "click",
    target: { layerId: REGION_LAYER },
    handler: (e) => {
      const id = e.feature?.id;
      if (typeof id === "string") handlers.onSelect?.(id);
    },
  });
}

/** Grows every column from the ground in a west-to-east wave. */
export function riseRegions(map: MapboxMap, fc: RegionCollection): void {
  if (!state || state.map !== map || state.risen) return;
  state.risen = true;
  const west = new Map(fc.features.map((f) => [f.properties.id, firstLng(f.geometry)]));
  const order = [...state.regions].sort((a, b) => (west.get(a.id) ?? 0) - (west.get(b.id) ?? 0));
  order.forEach((r, i) => animateTo(r.id, targetHeight(r.id), 1600, i * 110));
}

function firstLng(g: RegionCollection["features"][number]["geometry"]): number {
  const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0]?.[0];
  if (!ring?.length) return 0;
  return ring.reduce((sum, c) => sum + (c[0] ?? 0), 0) / ring.length;
}

/**
 * Switches the columns between CO2 and kWh: they sink, change colour at the bottom, and rise again.
 * Both metrics share a shape (CO2 is kWh times one grid factor), so the dip makes the change visible.
 */
export function setRegionMetric(map: MapboxMap, metric: Metric): void {
  if (!state || state.map !== map || state.metric === metric) return;
  const s = state;
  s.metric = metric;
  for (const r of s.regions) animateTo(r.id, (s.heights.get(r.id) ?? 0) * 0.3, 380);
  setTimeout(() => {
    if (state !== s) return;
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-color", colorExpression(metric));
    writeIntensity();
    s.regions.forEach((r, i) => animateTo(r.id, targetHeight(r.id), 900, i * 40));
  }, 400);
}

/** Highlights one region (others dim and step back), or clears the highlight with `null`. */
export function setSelectedRegion(map: MapboxMap, id: string | null): void {
  if (!state || state.map !== map || state.selected === id) return;
  state.selected = id;
  for (const r of state.regions) {
    map.setFeatureState({ source: REGION_SOURCE, id: r.id }, { dim: id !== null && r.id !== id });
    animateTo(r.id, targetHeight(r.id), 900);
  }
}

export function setRegionsVisible(map: MapboxMap, visible: boolean): void {
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  }
}

export function removeRegions(map: MapboxMap): void {
  if (state?.frame) cancelAnimationFrame(state.frame);
  state = null;
  if (onMouseMove) map.off("mousemove", onMouseMove);
  onMouseMove = null;
  for (const id of ["regions-enter", "regions-leave", "regions-click"]) map.removeInteraction(id);
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(REGION_SOURCE)) map.removeSource(REGION_SOURCE);
}
