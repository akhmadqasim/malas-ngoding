import type { ExpressionSpecification, GeoJSONSourceSpecification, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { RegionCollection } from "../api.ts";
import type { Metric } from "../store.ts";
import { rampTokens, token } from "../theme.ts";
import type { Tone } from "./effects.ts";
import type { RegionSummary } from "../../shared/types.ts";

export const REGION_SOURCE = "regions";
export const REGION_LAYER = "regions-extrusion";
const OUTLINE_LAYER = "regions-outline";
const INTERACTIONS = ["regions-enter", "regions-leave", "regions-click"] as const;

/** Tallest and shortest column at the province view, in metres. Scaled down again as the user zooms in. */
const MAX_HEIGHT_M = 75_000;
const MIN_HEIGHT_M = 4_000;
/** Above this zoom the city and its buildings matter more than the columns, so they flatten out and hide. */
const HIDE_ZOOM = 12;
/** Map motion in ms (docs/research/design/00-direction.md section 6). */
const MS = { rise: 1600, riseStagger: 110, hover: 300, select: 900, sink: 380, swapRise: 900, swapStagger: 40 } as const;
/**
 * Self-lit share of the column colour. In the dark presets the scene light is too dim to show the ramp
 * (measured: the columns rendered about a fifth darker), so the columns light themselves fully; by day
 * the sun shades their sides.
 */
const EMISSIVE: Record<Tone, number> = { light: 0.85, dark: 1 };

export interface RegionHandlers {
  onSelect?: (id: string | null) => void;
  /** The region under the pointer changed (null when the pointer left all regions). Not called on every move. */
  onHover?: (id: string | null) => void;
  /** The pointer moved while over a region: position the tooltip without re-rendering. */
  onPointer?: (point: { x: number; y: number }) => void;
}

export const metricValue = (r: RegionSummary, metric: Metric) => (metric === "co2" ? r.co2KgYear : r.kwhYear);

/** 0..1 per region. Square root so small regions (Mahakam Ulu) still read, and Samarinda does not dwarf all. */
export function intensities(regions: RegionSummary[], metric: Metric): Map<string, number> {
  const max = Math.max(...regions.map((r) => metricValue(r, metric)), 1);
  return new Map(regions.map((r) => [r.id, Math.sqrt(Math.max(metricValue(r, metric), 0) / max)]));
}

const heightFor = (t: number) => MIN_HEIGHT_M + (MAX_HEIGHT_M - MIN_HEIGHT_M) * t;

const selected: ExpressionSpecification = ["boolean", ["feature-state", "selected"], false];
const hovered: ExpressionSpecification = ["boolean", ["feature-state", "hover"], false];
const emissive = (tone: Tone): ExpressionSpecification => ["case", hovered, 1, EMISSIVE[tone]];

/** Column colour by intensity `t`, on the ramp for the ground tone; dimmed while another region is selected. */
function colorExpression(metric: Metric, tone: Tone): ExpressionSpecification {
  const stops = rampTokens(metric, tone);
  const ramp = stops.flatMap((color, i) => [i / (stops.length - 1), color]);
  return [
    "case",
    ["boolean", ["feature-state", "dim"], false],
    token(tone === "light" ? "--color-dim-light" : "--color-dim-dark"),
    ["interpolate", ["linear"], ["coalesce", ["feature-state", "t"], 0], ...ramp] as ExpressionSpecification,
  ];
}

const outlineColor = (tone: Tone) => token(tone === "light" ? "--color-outline-light" : "--color-paper");

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
  tone: Tone;
  heights: Map<string, number>;
  tweens: Map<string, Tween>;
  frame: number;
  hovered: string | null;
  selected: string | null;
  /** False until `riseRegions()`: columns stay flat while the intro flies in. */
  risen: boolean;
  /** The pending colour swap of a metric switch. */
  metricTimer: ReturnType<typeof setTimeout> | undefined;
  onMouseMove: (e: MapMouseEvent) => void;
}
let state: LayerState | null = null;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

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

/** Moves the hover lift to `id` (or clears it). Shared by map hover and list hover. */
function applyHover(id: string | null) {
  const s = state;
  if (!s || s.hovered === id) return;
  const previous = s.hovered;
  s.hovered = id;
  if (previous) {
    s.map.setFeatureState({ source: REGION_SOURCE, id: previous }, { hover: false });
    animateTo(previous, targetHeight(previous), MS.hover);
  }
  if (id) {
    s.map.setFeatureState({ source: REGION_SOURCE, id }, { hover: true });
    animateTo(id, targetHeight(id), MS.hover);
  }
}

// --- Public API ---------------------------------------------------------------------------------

/**
 * Adds the 10 regions as flat columns at height 0. Call `riseRegions()` to grow them (the intro does
 * this as the camera lands). Hover lifts a column and calls `onHover`; click calls `onSelect`.
 */
export function addRegions(
  map: MapboxMap,
  fc: RegionCollection,
  metric: Metric,
  handlers: RegionHandlers = {},
  tone: Tone = "dark",
): void {
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
      "fill-extrusion-color": colorExpression(metric, tone),
      "fill-extrusion-height": zoomScaled(height),
      "fill-extrusion-base": 0,
      // Opaque, so the ground does not tint the data colour; fades out on the way to city zoom.
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 10, 1, HIDE_ZOOM, 0],
      // The hovered column lights itself fully; the rest show the ramp's true colour, no neon.
      "fill-extrusion-emissive-strength": emissive(tone),
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
      "line-color": outlineColor(tone),
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, ["case", selected, 0.95, 0.28], 9, ["case", selected, 0.95, 0.45], 13, ["case", selected, 0.5, 0.12]],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", selected, 1.6, 0.6], 10, ["case", selected, 2.6, 1.4]],
      "line-emissive-strength": 1,
    },
  });

  const regions = fc.features.map((f) => f.properties);
  const onMouseMove = (e: MapMouseEvent) => {
    if (state?.hovered) handlers.onPointer?.({ x: e.point.x, y: e.point.y });
  };
  state = {
    map,
    regions,
    metric,
    tone,
    heights: new Map(regions.map((r) => [r.id, 0])),
    tweens: new Map(),
    frame: 0,
    hovered: null,
    selected: null,
    risen: false,
    metricTimer: undefined,
    onMouseMove,
  };
  writeIntensity();
  map.on("mousemove", onMouseMove);

  map.addInteraction("regions-enter", {
    type: "mouseenter",
    target: { layerId: REGION_LAYER },
    handler: (e) => {
      const id = e.feature?.id;
      if (!state || typeof id !== "string") return;
      applyHover(id);
      map.getCanvas().style.cursor = "pointer";
      handlers.onHover?.(id);
      handlers.onPointer?.({ x: e.point.x, y: e.point.y });
    },
  });
  map.addInteraction("regions-leave", {
    type: "mouseleave",
    target: { layerId: REGION_LAYER },
    handler: (e) => {
      const id = e.feature?.id;
      // Moving straight from one region into the next can deliver the next one's enter first.
      if (state && typeof id === "string" && state.hovered === id) {
        applyHover(null);
        map.getCanvas().style.cursor = "";
        handlers.onHover?.(null);
      }
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
  order.forEach((r, i) => animateTo(r.id, targetHeight(r.id), MS.rise, i * MS.riseStagger));
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
  clearTimeout(s.metricTimer);
  for (const r of s.regions) animateTo(r.id, (s.heights.get(r.id) ?? 0) * 0.3, MS.sink);
  s.metricTimer = setTimeout(() => {
    if (state !== s) return;
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-color", colorExpression(s.metric, s.tone));
    writeIntensity();
    s.regions.forEach((r, i) => animateTo(r.id, targetHeight(r.id), MS.swapRise, i * MS.swapStagger));
  }, MS.sink + 20);
}

/** Highlights one region (others dim and step back, its outline brightens), or clears it with `null`. */
export function setSelectedRegion(map: MapboxMap, id: string | null): void {
  if (!state || state.map !== map || state.selected === id) return;
  state.selected = id;
  for (const r of state.regions) {
    map.setFeatureState({ source: REGION_SOURCE, id: r.id }, { dim: id !== null && r.id !== id, selected: r.id === id });
    animateTo(r.id, targetHeight(r.id), MS.select);
  }
}

/** Lifts the column of a region hovered in the list (or clears the lift with `null`). */
export function setRegionHover(map: MapboxMap, id: string | null): void {
  if (!state || state.map !== map) return;
  applyHover(id);
}

/** Matches the ramp, outlines and dimmed columns to a light (day, dawn) or dark (dusk, night) ground. */
export function setRegionTone(map: MapboxMap, tone: Tone): void {
  if (!state || state.map !== map || state.tone === tone) return;
  state.tone = tone;
  if (map.getLayer(REGION_LAYER)) {
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-color", colorExpression(state.metric, tone));
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-emissive-strength", emissive(tone));
  }
  if (map.getLayer(OUTLINE_LAYER)) map.setPaintProperty(OUTLINE_LAYER, "line-color", outlineColor(tone));
}

export function setRegionsVisible(map: MapboxMap, visible: boolean): void {
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  }
}

/** Stops every animation and timer, then removes the layers, source and interactions. */
export function removeRegions(map: MapboxMap): void {
  if (state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    clearTimeout(state.metricTimer);
    map.off("mousemove", state.onMouseMove);
    state = null;
  }
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(REGION_SOURCE)) map.removeSource(REGION_SOURCE);
}
