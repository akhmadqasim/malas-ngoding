import type { ExpressionSpecification, GeoJSONSourceSpecification, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { RegionCollection } from "../api.ts";
import type { Metric } from "../store.ts";
import { rampTokens, token } from "../theme.ts";
import { columnHeight, columnZoomScale, HIDE_ZOOM, intensities, metricValue } from "./columns.ts";
import type { Tone } from "./effects.ts";
import {
  addRegionLabels,
  removeRegionLabels,
  setRegionLabelData,
  setRegionLabelFocus,
  setRegionLabelsShown,
  setRegionLabelsVisible,
} from "./regionLabels.ts";
import type { RegionSummary } from "../../shared/types.ts";

export { columnHeight, columnZoomScale, intensities, metricValue };

export const REGION_SOURCE = "regions";
export const REGION_LAYER = "regions-extrusion";
const OUTLINE_LAYER = "regions-outline";
const INTERACTIONS = ["regions-enter", "regions-leave", "regions-click"] as const;

/** By this zoom the columns have all but faded, so a hover on them ends (see `onZoom` in addRegions). */
const HOVER_END_ZOOM = HIDE_ZOOM - 0.5;
/** Map motion in ms (docs/research/design/00-direction.md section 6). */
const MS = { rise: 1600, riseStagger: 110, hover: 300, select: 900, sink: 380, swapRise: 900, swapStagger: 40 } as const;
/** Hover previews a selection: the column under the pointer rises this much ... */
const HOVER_LIFT = 1.12;
/** ... and the other columns fade this far toward the dimmed colour of a real selection (which goes all the way). */
const RECEDE = 0.6;
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

const dimColor = (tone: Tone) => token(tone === "light" ? "--color-dim-light" : "--color-dim-dark");

/**
 * Column colour by intensity `t`, on the ramp for the ground tone, faded toward the dimmed colour by the
 * feature-state `fade`: 0 shows the ramp, RECEDE previews a selection while another column is hovered, 1
 * is dimmed behind a selection. `fade` is tweened like the heights, so the colour never jumps.
 */
function colorExpression(metric: Metric, tone: Tone): ExpressionSpecification {
  const stops = rampTokens(metric, tone);
  const ramp: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["coalesce", ["feature-state", "t"], 0],
    ...stops.flatMap((c, i) => [i / (stops.length - 1), c]),
  ];
  return ["interpolate", ["linear"], ["coalesce", ["feature-state", "fade"], 0], 0, ramp, 1, dimColor(tone)];
}

const outlineColor = (tone: Tone) => token(tone === "light" ? "--color-outline-light" : "--color-paper");

// --- Animation ----------------------------------------------------------------------------------
// Heights (`h`) and colour fades (`fade`) live in feature-state, so animating them only updates paint
// buffers (no re-tiling).

/** The animated feature-state values of a column. */
type Channel = "h" | "fade";

interface Tween {
  id: string;
  channel: Channel;
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
  /** Current value per `channel:id`. */
  values: Map<string, number>;
  tweens: Map<string, Tween>;
  frame: number;
  hovered: string | null;
  selected: string | null;
  /** False until `riseRegions()`: columns stay flat while the intro flies in. */
  risen: boolean;
  /** The pending colour swap of a metric switch. */
  metricTimer: ReturnType<typeof setTimeout> | undefined;
  /** The labels come back once the running height animation has finished... */
  labelsPending: boolean;
  /** ...and no metric swap is waiting to start the next one. */
  swapPending: boolean;
  fc: RegionCollection;
  onMouseMove: (e: MapMouseEvent) => void;
  onZoom: () => void;
}
let state: LayerState | null = null;

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

const valueKey = (channel: Channel, id: string) => `${channel}:${id}`;

function tick(now: number) {
  if (!state) return;
  const s = state;
  // One feature-state write per column per frame, with every channel that moved.
  const writes = new Map<string, Partial<Record<Channel, number>>>();
  for (const [key, tw] of s.tweens) {
    if (now < tw.start) continue;
    const p = Math.min((now - tw.start) / tw.duration, 1);
    const value = tw.from + (tw.to - tw.from) * easeOutCubic(p);
    s.values.set(key, value);
    writes.set(tw.id, { ...writes.get(tw.id), [tw.channel]: value });
    if (p >= 1) s.tweens.delete(key);
  }
  for (const [id, values] of writes) s.map.setFeatureState({ source: REGION_SOURCE, id }, values);
  s.frame = s.tweens.size ? requestAnimationFrame(tick) : 0;
  // Everything stands still: the labels, which float at the resting heights, can show again.
  if (!s.frame && s.labelsPending && !s.swapPending) {
    s.labelsPending = false;
    setRegionLabelsShown(s.map, true);
  }
}

/** Hides the labels while columns change height; they return when the animation has settled. */
function holdLabels(s: LayerState) {
  if (!s.risen) return;
  setRegionLabelsShown(s.map, false);
  s.labelsPending = true;
}

/** Tweens one channel of a column from where it is now to `to`. */
function animateTo(id: string, channel: Channel, to: number, duration: number, delay = 0) {
  if (!state) return;
  const key = valueKey(channel, id);
  const from = state.values.get(key) ?? 0;
  state.tweens.set(key, { id, channel, from, to, start: performance.now() + delay, duration });
  if (!state.frame) state.frame = requestAnimationFrame(tick);
}

/** Target height for a region given the selection: the chosen one grows a little, the rest step back. */
function targetHeight(id: string): number {
  if (!state?.risen) return 0;
  const t = intensities(state.regions, state.metric).get(id) ?? 0;
  const base = columnHeight(t);
  if (!state.selected) return state.hovered === id ? base * HOVER_LIFT : base;
  return id === state.selected ? base * 1.1 : base * 0.4;
}

/**
 * Target colour fade for a region: a selection dims every other column fully; a hover with no selection
 * previews that, fading the others part of the way.
 */
function targetFade(id: string): number {
  if (!state) return 0;
  if (state.selected) return id === state.selected ? 0 : 1;
  return state.hovered !== null && id !== state.hovered ? RECEDE : 0;
}

/** Fades every column toward its target colour (see targetFade) over `duration`. */
function fadeColumns(duration: number) {
  if (!state) return;
  for (const r of state.regions) animateTo(r.id, "fade", targetFade(r.id), duration);
}

function writeIntensity() {
  if (!state) return;
  for (const [id, t] of intensities(state.regions, state.metric)) {
    state.map.setFeatureState({ source: REGION_SOURCE, id }, { t });
  }
}

/** Moves the hover preview to `id` (or clears it). Shared by map hover and list hover. */
function applyHover(id: string | null) {
  const s = state;
  if (!s || s.hovered === id) return;
  const previous = s.hovered;
  s.hovered = id;
  if (previous) {
    s.map.setFeatureState({ source: REGION_SOURCE, id: previous }, { hover: false });
    animateTo(previous, "h", targetHeight(previous), MS.hover);
  }
  if (id) {
    s.map.setFeatureState({ source: REGION_SOURCE, id }, { hover: true });
    animateTo(id, "h", targetHeight(id), MS.hover);
  }
  fadeColumns(MS.hover);
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

  const height: ExpressionSpecification = ["coalesce", ["feature-state", "h"], 0];

  map.addLayer({
    id: REGION_LAYER,
    type: "fill-extrusion",
    source: REGION_SOURCE,
    slot: "middle",
    maxzoom: HIDE_ZOOM,
    paint: {
      "fill-extrusion-color": colorExpression(metric, tone),
      "fill-extrusion-height": columnZoomScale(height),
      "fill-extrusion-base": 0,
      // Opaque, so the ground does not tint the data colour; fades out on the way to city zoom.
      "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 10, 1, HIDE_ZOOM, 0],
      // One value for every column: hover is shown by the lift and the receding neighbours, not by glow.
      "fill-extrusion-emissive-strength": EMISSIVE[tone],
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
      // Borders on the ground. They show between and beside the columns, so they do not mark a selection
      // (the dimming does that); a selected outline would sit under its own column.
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.28, 9, 0.45, 13, 0.12],
      "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 1.4],
      "line-emissive-strength": 1,
    },
  });

  const regions = fc.features.map((f) => f.properties);
  const onMouseMove = (e: MapMouseEvent) => {
    if (state?.hovered) handlers.onPointer?.({ x: e.point.x, y: e.point.y });
  };
  // A wheel zoom with a still pointer fires no mouseleave, so a hover would outlive its column and leave
  // the tooltip floating over the city. End it once the columns have faded.
  const onZoom = () => {
    if (!state?.hovered || map.getZoom() < HOVER_END_ZOOM) return;
    applyHover(null);
    map.getCanvas().style.cursor = "";
    handlers.onHover?.(null);
  };
  state = {
    map,
    regions,
    metric,
    tone,
    values: new Map(),
    tweens: new Map(),
    frame: 0,
    hovered: null,
    selected: null,
    risen: false,
    metricTimer: undefined,
    labelsPending: false,
    swapPending: false,
    fc,
    onMouseMove,
    onZoom,
  };
  writeIntensity();
  addRegionLabels(map, fc, metric);
  map.on("mousemove", onMouseMove);
  map.on("zoom", onZoom);

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

/** Grows every column from the ground in a west-to-east wave; the names appear once they stand. */
export function riseRegions(map: MapboxMap, fc: RegionCollection): void {
  if (!state || state.map !== map || state.risen) return;
  state.risen = true;
  state.labelsPending = true;
  const west = new Map(fc.features.map((f) => [f.properties.id, firstLng(f.geometry)]));
  const order = [...state.regions].sort((a, b) => (west.get(a.id) ?? 0) - (west.get(b.id) ?? 0));
  order.forEach((r, i) => animateTo(r.id, "h", targetHeight(r.id), MS.rise, i * MS.riseStagger));
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
  holdLabels(s);
  s.swapPending = true;
  for (const r of s.regions) animateTo(r.id, "h", (s.values.get(valueKey("h", r.id)) ?? 0) * 0.3, MS.sink);
  s.metricTimer = setTimeout(() => {
    if (state !== s) return;
    s.swapPending = false;
    // The labels follow the new metric's column heights (hidden until the rise below has finished).
    setRegionLabelData(map, s.fc, s.metric);
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-color", colorExpression(s.metric, s.tone));
    writeIntensity();
    s.regions.forEach((r, i) => animateTo(r.id, "h", targetHeight(r.id), MS.swapRise, i * MS.swapStagger));
  }, MS.sink + 20);
}

/** Highlights one region (the others dim and step back), or clears the selection with `null`. */
export function setSelectedRegion(map: MapboxMap, id: string | null): void {
  if (!state || state.map !== map || state.selected === id) return;
  state.selected = id;
  holdLabels(state);
  // A selection keeps only its own label; the others belong to columns that step back.
  setRegionLabelFocus(map, id);
  for (const r of state.regions) animateTo(r.id, "h", targetHeight(r.id), MS.select);
  fadeColumns(MS.select);
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
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-emissive-strength", EMISSIVE[tone]);
  }
  if (map.getLayer(OUTLINE_LAYER)) map.setPaintProperty(OUTLINE_LAYER, "line-color", outlineColor(tone));
}

export function setRegionsVisible(map: MapboxMap, visible: boolean): void {
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  }
  setRegionLabelsVisible(map, visible);
}

/** Stops every animation and timer, then removes the layers, source and interactions. */
export function removeRegions(map: MapboxMap): void {
  if (state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    clearTimeout(state.metricTimer);
    map.off("mousemove", state.onMouseMove);
    map.off("zoom", state.onZoom);
    state = null;
  }
  removeRegionLabels(map);
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const layer of [REGION_LAYER, OUTLINE_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(REGION_SOURCE)) map.removeSource(REGION_SOURCE);
}
