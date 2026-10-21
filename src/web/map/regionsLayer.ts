import type { ExpressionSpecification, FilterSpecification, GeoJSONSourceSpecification, Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { RegionCollection } from "../api.ts";
import type { Metric } from "../store.ts";
import { rampTokens, token } from "../theme.ts";
import { calmShapes } from "./regionShapes.ts";
import { columnHeight, columnZoomScale, columnZoomScaleShift, FLATTEN_SELECTED, HIDE_ZOOM, intensities, metresPerPixel, metricValue, selectedZoomScale } from "./columns.ts";
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
/** The selected region's own column, so the others can step aside without it (see setSelectedRegion). */
export const SELECTED_LAYER = "regions-selected";
/** The crisp edge on top of every column: a thin wall along its outline at the column's own height. */
export const RIM_LAYER = "regions-rim";
const SELECTED_RIM_LAYER = "regions-selected-rim";
const COLUMN_LAYERS = [REGION_LAYER, SELECTED_LAYER] as const;
const RIM_LAYERS = [RIM_LAYER, SELECTED_RIM_LAYER] as const;
const INTERACTIONS = ["regions-enter", "regions-leave", "regions-click", "regions-selected-click"] as const;

/** By this zoom the columns have all but faded, so a hover on them ends (see `onZoom` in addRegions). */
const HOVER_END_ZOOM = HIDE_ZOOM - 0.5;
/** Map motion in ms (docs/research/design/00-direction.md section 6). */
const MS = { rise: 1600, riseStagger: 110, hover: 300, select: 900, sink: 380, swapRise: 900, swapStagger: 40 } as const;
/** Hover previews a selection: the column under the pointer rises this much ... */
const HOVER_LIFT = 1.12;
/** With nothing selected, the columns are opaque until they fade out toward city zoom. */
const COLUMN_OPACITY: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11, 1, HIDE_ZOOM, 0];
/**
 * Behind a selection the other columns sink, dim and are gone from zoom 8.6, so a region seen up close
 * stands alone on the basemap, with its river, roads and coast in view.
 */
const NEIGHBOUR_OPACITY: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 8, 1, 8.6, 0];
/**
 * The selected column turns see-through from zoom 10 (a city fills the view there): the city shows
 * through and its crisp rim keeps the shape.
 */
const SELECTED_OPACITY: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 9.8, 1, 10.6, 0.4, HIDE_ZOOM, 0];
/** The rims stay at full strength until the columns go at city zoom. */
const RIM_OPACITY: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 11.5, 1, HIDE_ZOOM, 0];
/** The rim's width in metres, about 1.5 screen px at every zoom (wall-mode extrusion). */
const RIM_WIDTH: ExpressionSpecification = ["interpolate", ["exponential", 0.5], ["zoom"], 6, 1.5 * metresPerPixel(6), HIDE_ZOOM, 1.5 * metresPerPixel(HIDE_ZOOM)];
/**
 * Wall-mode fill-extrusions are not drawn on the globe (Mapbox skips tiles built in globe mode and warns
 * once), so the rims start at zoom 6, where tiles are built flat.
 */
const RIM_MIN_ZOOM = 6;
/** How long the selected column keeps its own layer after a deselect, while the camera flies out. */
const DESELECT_SETTLE_MS = 2200;

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
  /**
   * The top of some columns moved (a rise, hover lift, selection, metric swap or the Wilayah switch). Called
   * with the columns that changed, every animation frame while they move, so the plant pins can stand on them.
   */
  onColumnTops?: (tops: ColumnTop[]) => void;
}

/** Where a column's top is now: its province-view height and the flattening curve it follows by zoom. */
export interface ColumnTop {
  id: string;
  /** Height at the province view in metres (feature-state `h`); 0 while the columns are hidden. */
  h: number;
  /** Drawn in the selected column's layers, which flatten sooner (FLATTEN_SELECTED). */
  selected: boolean;
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

/** Paint of a column layer; only the opacity curve differs between the shared and the selected layer. */
function columnPaint(metric: Metric, tone: Tone, height: ExpressionSpecification, opacity: ExpressionSpecification, selected = false) {
  return {
    "fill-extrusion-color": colorExpression(metric, tone),
    "fill-extrusion-height": selected ? selectedZoomScale(height) : columnZoomScale(height),
    "fill-extrusion-base": 0,
    "fill-extrusion-opacity": opacity,
    // One value for every column: hover is shown by the lift and the receding neighbours, not by glow.
    "fill-extrusion-emissive-strength": EMISSIVE[tone],
    // Calm walls: no darkening gradient and no ambient occlusion, which broke the low walls of a selected
    // region into dark fragments.
    "fill-extrusion-vertical-gradient": false,
    "fill-extrusion-ambient-occlusion-intensity": 0,
  } as const;
}

/** Rim colour: ink on every column, a quiet grey on a dimmed one (feature-state `fade`, as the fill). */
function rimColor(): ExpressionSpecification {
  return ["interpolate", ["linear"], ["coalesce", ["feature-state", "fade"], 0], 0, token("--color-ink"), 1, token("--color-paper-faint")];
}

/** Which columns each layer draws: the selected one alone in its own layers, the others in the shared ones. */
function applySelectionFilters(map: MapboxMap, selected: string | null) {
  const others: FilterSpecification | null = selected ? ["!=", ["get", "id"], selected] : null;
  const own: FilterSpecification = ["==", ["get", "id"], selected ?? ""];
  for (const id of [REGION_LAYER, RIM_LAYER]) if (map.getLayer(id)) map.setFilter(id, others);
  for (const id of [SELECTED_LAYER, SELECTED_RIM_LAYER]) if (map.getLayer(id)) map.setFilter(id, own);
  if (state && state.drawnSelected !== selected) {
    const changed = [state.drawnSelected, selected].filter((id): id is string => id !== null);
    state.drawnSelected = selected;
    emitTops(changed);
  }
}

/** Tells `onColumnTops` where the tops of these columns (all, by default) are now. */
function emitTops(ids?: Iterable<string>) {
  const s = state;
  if (!s?.handlers.onColumnTops) return;
  const list = ids ? [...ids] : s.regions.map((r) => r.id);
  if (!list.length) return;
  s.handlers.onColumnTops(
    list.map((id) => ({ id, h: s.visible ? (s.values.get(valueKey("h", id)) ?? 0) : 0, selected: s.drawnSelected === id })),
  );
}

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
  /** The pending hand-back of a just deselected column to the shared layers. */
  deselectTimer: ReturnType<typeof setTimeout> | undefined;
  /** The labels come back once the running height animation has finished... */
  labelsPending: boolean;
  /** ...and no metric swap is waiting to start the next one. */
  swapPending: boolean;
  fc: RegionCollection;
  onMouseMove: (e: MapMouseEvent) => void;
  onZoom: () => void;
  handlers: RegionHandlers;
  /** The region drawn in the selected column's layers (it keeps them for a while after a deselect). */
  drawnSelected: string | null;
  /** The Wilayah switch. */
  visible: boolean;
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
  emitTops([...writes].flatMap(([id, values]) => (values.h === undefined ? [] : [id])));
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
  // The others sink to the ground; they are gone from zoom 8.6 anyway (NEIGHBOUR_OPACITY).
  return id === state.selected ? base * 1.1 : 0;
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
  // A little more simplification than Mapbox's default (0.375 tile px) on top, scaled by zoom like it.
  // The columns use a calmer copy of the shapes (regionShapes.ts): no delta slivers, no comb of walls.
  map.addSource(REGION_SOURCE, { type: "geojson", data: calmShapes(fc) as unknown as GeoJSONSourceSpecification["data"], promoteId: "id", tolerance: 1.5 });

  const height: ExpressionSpecification = ["coalesce", ["feature-state", "h"], 0];

  map.addLayer({
    id: REGION_LAYER,
    type: "fill-extrusion",
    source: REGION_SOURCE,
    slot: "middle",
    maxzoom: HIDE_ZOOM,
    paint: columnPaint(metric, tone, height, COLUMN_OPACITY),
  });
  map.addLayer({
    id: SELECTED_LAYER,
    type: "fill-extrusion",
    source: REGION_SOURCE,
    slot: "middle",
    maxzoom: HIDE_ZOOM,
    filter: ["==", ["get", "id"], ""],
    paint: columnPaint(metric, tone, height, SELECTED_OPACITY, true),
  });
  for (const id of RIM_LAYERS) {
    map.addLayer({
      id,
      type: "fill-extrusion",
      source: REGION_SOURCE,
      slot: "middle",
      minzoom: RIM_MIN_ZOOM,
      maxzoom: HIDE_ZOOM,
      ...(id === SELECTED_RIM_LAYER ? { filter: ["==", ["get", "id"], ""] as FilterSpecification } : {}),
      paint: {
        // Wall mode: a thin wall along each outline, from just under the column top to just over it, on the
        // same feature-state height, so it follows the rise, the hover lift and the selection exactly.
        "fill-extrusion-line-width": RIM_WIDTH,
        "fill-extrusion-color": rimColor(),
        "fill-extrusion-height": columnZoomScaleShift(height, 0.6, id === SELECTED_RIM_LAYER ? FLATTEN_SELECTED : undefined),
        "fill-extrusion-base": columnZoomScaleShift(height, -0.6, id === SELECTED_RIM_LAYER ? FLATTEN_SELECTED : undefined),
        "fill-extrusion-opacity": RIM_OPACITY,
        "fill-extrusion-emissive-strength": 1,
        "fill-extrusion-vertical-gradient": false,
        "fill-extrusion-ambient-occlusion-intensity": 0,
      },
    });
  }
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
    deselectTimer: undefined,
    labelsPending: false,
    swapPending: false,
    fc,
    onMouseMove,
    onZoom,
    handlers,
    drawnSelected: null,
    visible: true,
  };
  writeIntensity();
  emitTops();
  addRegionLabels(map, fc, metric);
  map.on("mousemove", onMouseMove);
  map.on("zoom", onZoom);

  // The selected column has its own layer: a click on it must not fall through to the map, which would
  // read it as a click on empty ground and close the selection.
  map.addInteraction("regions-selected-click", { type: "click", target: { layerId: SELECTED_LAYER }, handler: () => {} });
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
    for (const layer of COLUMN_LAYERS) map.setPaintProperty(layer, "fill-extrusion-color", colorExpression(s.metric, s.tone));
    writeIntensity();
    s.regions.forEach((r, i) => animateTo(r.id, "h", targetHeight(r.id), MS.swapRise, i * MS.swapStagger));
  }, MS.sink + 20);
}

/** Highlights one region (the others dim and step back), or clears the selection with `null`. */
export function setSelectedRegion(map: MapboxMap, id: string | null): void {
  if (!state || state.map !== map || state.selected === id) return;
  const previous = state.selected;
  state.selected = id;
  holdLabels(state);
  clearTimeout(state.deselectTimer);
  if (id) {
    // The selected column moves to its own layers; the others sink, dim and go from zoom 8.6.
    applySelectionFilters(map, id);
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-opacity", NEIGHBOUR_OPACITY);
    map.setPaintProperty(RIM_LAYER, "fill-extrusion-opacity", NEIGHBOUR_OPACITY);
  } else {
    // The others come back while the camera flies out; the region just left keeps its own layers until the
    // flight is over, so it never blinks between two opacity curves.
    map.setPaintProperty(REGION_LAYER, "fill-extrusion-opacity", COLUMN_OPACITY);
    map.setPaintProperty(RIM_LAYER, "fill-extrusion-opacity", RIM_OPACITY);
    if (previous) {
      const s = state;
      s.deselectTimer = setTimeout(() => {
        if (state === s && !s.selected) applySelectionFilters(map, null);
      }, DESELECT_SETTLE_MS);
    }
  }
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
  for (const layer of COLUMN_LAYERS) {
    if (!map.getLayer(layer)) continue;
    map.setPaintProperty(layer, "fill-extrusion-color", colorExpression(state.metric, tone));
    map.setPaintProperty(layer, "fill-extrusion-emissive-strength", EMISSIVE[tone]);
  }
  if (map.getLayer(OUTLINE_LAYER)) map.setPaintProperty(OUTLINE_LAYER, "line-color", outlineColor(tone));
}

export function setRegionsVisible(map: MapboxMap, visible: boolean): void {
  if (state && state.map === map && state.visible !== visible) {
    state.visible = visible;
    emitTops();
  }
  for (const layer of [...COLUMN_LAYERS, ...RIM_LAYERS, OUTLINE_LAYER]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  }
  setRegionLabelsVisible(map, visible);
}

/** Stops every animation and timer, then removes the layers, source and interactions. */
export function removeRegions(map: MapboxMap): void {
  if (state) {
    if (state.frame) cancelAnimationFrame(state.frame);
    clearTimeout(state.metricTimer);
    clearTimeout(state.deselectTimer);
    map.off("mousemove", state.onMouseMove);
    map.off("zoom", state.onZoom);
    state = null;
  }
  removeRegionLabels(map);
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const layer of [...RIM_LAYERS, ...COLUMN_LAYERS, OUTLINE_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(REGION_SOURCE)) map.removeSource(REGION_SOURCE);
}
