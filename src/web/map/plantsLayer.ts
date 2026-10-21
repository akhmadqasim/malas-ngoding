import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type MapMouseEvent, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties, RegionCollection } from "../api.ts";
import { token } from "../theme.ts";
import { FUEL_LABELS, FUELS, fuelKey, fuelsPresent, plantIconExpression } from "./fuels.ts";
import { columnZoomScale, FLATTEN, FLATTEN_SELECTED, flattenShare, selectedZoomScale } from "./columns.ts";
import { FADE_ZOOMS, type GroupNode, plantGroups, visibility as markerShown } from "./plantGroups.ts";
import { calmShapes, regionAt } from "./regionShapes.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";

const STATUS_LABEL: Record<string, string> = {
  operating: "Beroperasi",
  planned: "Rencana",
  unknown: "Captive / belum terverifikasi",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Tooltip body for one plant: name, fuel, capacity. Unverified sites and guessed coordinates say so plainly. */
export function plantPopupHtml(p: PlantProperties): string {
  const fuel = fuelKey(p.fuel);
  const notes: string[] = [];
  if (p.status !== "operating") notes.push(STATUS_LABEL[p.status] ?? p.status);
  if (p.approx) notes.push("Lokasi perkiraan");
  return `
    <div class="plant-popup">
      <div class="plant-popup__name">${escapeHtml(p.name)}</div>
      <div class="plant-popup__fuel"><span class="fuel-dot" data-fuel="${fuel}"></span>${FUEL_LABELS[fuel]}</div>
      <div class="plant-popup__mw"><span class="num">${fmtNumber(p.capacityMw)}</span> MW</div>
      ${notes.map((n) => `<div class="plant-popup__note">${escapeHtml(n)}</div>`).join("")}
    </div>`;
}

/** Tooltip body for a cluster: how many plants, then each one with its fuel and capacity, largest first. */
export function plantClusterHtml(plants: PlantProperties[]): string {
  const rows = [...plants]
    .sort((a, b) => b.capacityMw - a.capacityMw)
    .map((p) => {
      const fuel = fuelKey(p.fuel);
      return `<li><span class="fuel-dot" data-fuel="${fuel}"></span><span class="plant-list__name">${escapeHtml(p.name)}</span><span class="plant-list__mw"><span class="num">${fmtNumber(p.capacityMw)}</span> MW</span></li>`;
    })
    .join("");
  return `
    <div class="plant-popup">
      <div class="plant-popup__name">${plants.length} pembangkit berdekatan</div>
      <ul class="plant-list">${rows}</ul>
      <div class="plant-popup__note">Klik untuk memperbesar.</div>
    </div>`;
}

// --- Markers -------------------------------------------------------------------------------------
// Pins: a round head in the fuel colour on a short point, inside a thin paper edge and a thin ink edge, so
// a pin reads on a light map, a dark map and on top of the amber or teal columns. The point marks the
// plant; the pin stands on the top of the column it is in (symbol-z-offset), so the columns' walls and rims
// never run through it. No rings, no pulse: they read as targets.

/** Canvas size of a pin image, in image pixels (drawn at pixelRatio 2). */
const IMAGE_W = 44;
const IMAGE_H = 66;
/** Radius of the fuel colour in the head, and the paper and ink edges, in image pixels. */
const CORE_R = 16;
const PAPER_W = 3;
const INK_W = 2;
/** Centre of the head from the top of the image, and the point from the centre, in image pixels. */
const HEAD_CY = 2 + CORE_R + PAPER_W + INK_W;
const TIP_DIST = 37;
/** The image's pixel ratio: image pixels per screen pixel at `icon-size` 1. */
const PIXEL_RATIO = 2;
/** Pin size on screen at `icon-size` 1, and the head centre above the point, in px. */
export const PIN = {
  width: IMAGE_W / PIXEL_RATIO,
  height: IMAGE_H / PIXEL_RATIO,
  headRadius: (CORE_R + PAPER_W + INK_W) / PIXEL_RATIO,
  headAbovePoint: (IMAGE_H - HEAD_CY) / PIXEL_RATIO,
} as const;

interface PinColors {
  fill: string;
  paper: string;
  ink: string;
}

/** The pin outline: the head's circle and the two lines from it that meet in the point. */
function pinPath(ctx: CanvasRenderingContext2D) {
  const cx = IMAGE_W / 2;
  const cy = HEAD_CY;
  // The lines touch the circle where they are square to its radius.
  const a = Math.acos(CORE_R / TIP_DIST);
  ctx.beginPath();
  ctx.moveTo(cx, cy + TIP_DIST);
  ctx.arc(cx, cy, CORE_R, Math.PI / 2 - a, Math.PI / 2 + a, true);
  ctx.closePath();
}

/** One pin image: the fuel colour with a paper edge inside an ink edge, its point at the bottom centre. */
function pinImage({ fill, paper, ink }: PinColors): { width: number; height: number; data: Uint8Array | Uint8ClampedArray } {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_W;
  canvas.height = IMAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: IMAGE_W, height: IMAGE_H, data: new Uint8Array(IMAGE_W * IMAGE_H * 4) };
  ctx.lineJoin = "round";
  pinPath(ctx);
  // Strokes are centred on the outline; the fill then covers their inner half.
  ctx.lineWidth = 2 * (PAPER_W + INK_W);
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = 2 * PAPER_W;
  ctx.strokeStyle = paper;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  return { width: IMAGE_W, height: IMAGE_H, data: ctx.getImageData(0, 0, IMAGE_W, IMAGE_H).data };
}

/**
 * Pin scale by capacity: the square root of MW, so a 2.200 MW site does not swallow a 40 MW one. A group is
 * scaled like one plant of the summed capacity, never too small for its count. It depends on the feature
 * only, never on the zoom: a zoom-and-feature `icon-size` made Chromium log GL_INVALID_OPERATION warnings on
 * every skipped intro (bisected in fix round 1).
 */
const SIZE = { k: 0.95, base: 0.42, perSqrtMw: 0.018, groupMin: 0.9 } as const;
const IS_GROUP: ExpressionSpecification = ["==", ["get", "kind"], "group"];

/** `icon-size` of a pin: a plant by its MW, a group by its summed MW. */
export function pinIconSize(): ExpressionSpecification {
  const byCapacity: ExpressionSpecification = ["*", SIZE.k, ["+", SIZE.base, ["*", SIZE.perSqrtMw, ["sqrt", ["get", "capacityMw"]]]]];
  return ["case", IS_GROUP, ["max", SIZE.groupMin, byCapacity], byCapacity];
}

/** The scale `pinIconSize` gives a marker, for placing its tooltip. */
export function pinScale(kind: "plant" | "group", capacityMw: number): number {
  const s = SIZE.k * (SIZE.base + SIZE.perSqrtMw * Math.sqrt(capacityMw));
  return kind === "group" ? Math.max(SIZE.groupMin, s) : s;
}

/** Size of the count in a group's head and its ink halo, in px. */
const COUNT_TEXT_PX = 12;
const COUNT_HALO_PX = 1.4;

/** `text-offset` of a group's count: up from the point to the centre of the head, in ems, for its scale. */
export function countOffset(): ExpressionSpecification {
  const up = PIN.headAbovePoint / COUNT_TEXT_PX;
  return ["interpolate", ["linear"], pinIconSize(), 0, ["literal", [0, 0]], 2, ["literal", [0, -2 * up]]];
}

let popup: mapboxgl.Popup | null = null;
let groups: GroupNode<PlantProperties>[] = [];
let onZoom: (() => void) | null = null;
let onPointer: ((e: MapMouseEvent) => void) | null = null;
let onPointerOut: (() => void) | null = null;
/** Whether the pointer cursor is ours, so the region columns keep the one they set. */
let cursorOwned = false;
/** The marker whose tooltip is open. */
let openNode: GroupNode<PlantProperties> | null = null;
/** The opacity last written per marker, so a zoom step only touches the markers that changed. */
const shownAt = new Map<number, number>();
/** The column each marker stands on (a region id), or GROUND, by marker id. */
const standsOn = new Map<number, string>();
/** The pin layers, one per column with markers in it, back to front, and the interactions added with them. */
let layerIds: string[] = [];
let interactionIds: string[] = [];
/**
 * The column tops as regionsLayer last reported them. Kept across a re-add of the plants, since the
 * columns report a change only when they move.
 */
const tops = new Map<string, { h: number; selected: boolean }>();
/** The `symbol-z-offset` value last written per column, so a frame only touches the pins that moved. */
const liftAt = new Map<string, string>();

/** Below this zoom the camera is on the globe, and no marker is drawn. */
export const MARKER_MIN_ZOOM = 6;
/** Every pin layer id starts with this; one layer per column (`plants-<region id>`) and one on the ground. */
export const PLANT_LAYER_PREFIX = "plants-";
/** Pins outside every region (at sea): they stand on the ground. */
const GROUND = "ground";
/** Marker opacity, from feature-state `o` (0..1) that `writeOpacity` keeps in step with the zoom. */
const SHOWN: ExpressionSpecification = ["coalesce", ["feature-state", "o"], 0];

/** The pin layers on the map now, back to front. */
export function plantLayerIds(): string[] {
  return [...layerIds];
}

/** Writes every marker's opacity for the current zoom (plantGroups.visibility). */
function writeOpacity(map: MapboxMap) {
  const z = map.getZoom();
  for (const node of groups) {
    const o = Math.round(markerShown(node, z) * 1000) / 1000;
    if (shownAt.get(node.id) === o) continue;
    shownAt.set(node.id, o);
    map.setFeatureState({ source: SOURCE, id: node.id }, { o });
  }
}

/**
 * `symbol-z-offset` of the pins on one column: the column's top, flattened by zoom exactly like the column
 * (a camera expression: exact at every zoom, and changing it needs no new layout). 0 on the ground.
 */
export function pinLift(column: string): ExpressionSpecification | number {
  const top = tops.get(column);
  if (!top || top.h <= 0) return 0;
  const h = Math.round(top.h);
  return top.selected ? selectedZoomScale(h) : columnZoomScale(h);
}

/** How high the pins on a column stand at `zoom`, in metres. */
function liftMetres(column: string, zoom: number): number {
  const top = tops.get(column);
  if (!top || top.h <= 0) return 0;
  return top.h * flattenShare(zoom, top.selected ? FLATTEN_SELECTED : FLATTEN);
}

/** Writes `pinLift` to the layers of these columns where it changed. */
function writeLift(map: MapboxMap, columns: Iterable<string>) {
  for (const column of columns) {
    const layer = PLANT_LAYER_PREFIX + column;
    if (!map.getLayer(layer)) continue;
    const lift = pinLift(column);
    const key = JSON.stringify(lift);
    if (liftAt.get(column) === key) continue;
    liftAt.set(column, key);
    map.setPaintProperty(layer, "symbol-z-offset", lift, { validate: false });
  }
}

/**
 * Moves the pins with the column tops (regionsLayer's `onColumnTops`): every frame of a rise, hover lift,
 * selection or metric swap, and when the Wilayah switch hides the columns (the pins go to the ground).
 */
export function setPlantLifts(map: MapboxMap, changed: { id: string; h: number; selected: boolean }[]): void {
  for (const { id, h, selected } of changed) tops.set(id, { h, selected });
  writeLift(
    map,
    changed.map((c) => c.id),
  );
  const open = openNode;
  if (open && changed.some((c) => c.id === standsOn.get(open.id))) placePopup(map);
}

/** Puts the open tooltip just above the pin's head, wherever the pin stands now. */
function placePopup(map: MapboxMap) {
  if (!popup || !openNode) return;
  const s = pinScale(openNode.kind, openNode.capacityMw);
  const [h, r, head] = [PIN.height * s, PIN.headRadius * s, PIN.headAbovePoint * s];
  const gap = 4;
  popup.setAltitude(liftMetres(standsOn.get(openNode.id) ?? GROUND, map.getZoom()));
  popup.setOffset({
    center: [0, -head],
    top: [0, gap],
    bottom: [0, -(h + gap)],
    left: [r + gap, -head],
    right: [-(r + gap), -head],
    "top-left": [r, 0],
    "top-right": [-r, 0],
    "bottom-left": [r, -(h + gap)],
    "bottom-right": [-r, -(h + gap)],
  });
}

const largest = (plants: PlantProperties[]) => plants.reduce((a, b) => (b.capacityMw > a.capacityMw ? b : a));

/** Every marker as a point: plants with their own properties, groups with their count and summed MW. */
function groupCollection(nodes: GroupNode<PlantProperties>[]) {
  return {
    type: "FeatureCollection" as const,
    features: nodes.map((n) => ({
      type: "Feature" as const,
      id: n.id,
      geometry: { type: "Point" as const, coordinates: [n.lng, n.lat] },
      properties: {
        ...(n.kind === "plant" ? n.members[0] : { fuel: largest(n.members).fuel }),
        node: n.id,
        kind: n.kind,
        count: n.members.length,
        capacityMw: n.capacityMw,
        appear: n.appear,
        split: n.split,
        column: standsOn.get(n.id) ?? GROUND,
      },
    })),
  };
}

/** Rough latitude of a region, to draw the pins of the columns further south (nearer the camera) later. */
function regionLat(f: RegionCollection["features"][number]): number {
  if (f.properties.labelPoint) return f.properties.labelPoint[1];
  const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
  return ring?.length ? ring.reduce((sum, c) => sum + (c[1] ?? 0), 0) / ring.length : 0;
}

export interface PlantOptions {
  /** Draw the pins under this layer (the region names). */
  below?: string;
  /** The region shapes: each pin stands on the column it is in. Without them every pin is on the ground. */
  regions?: RegionCollection;
}

/**
 * Power plants as pins coloured by fuel and sized by MW, with a tooltip on hover or tap. Each pin stands on
 * the top of the region column it is in and moves with it (setPlantLifts). Plants that would overlap on
 * screen merge into one group pin with their count in its head; its tooltip lists them, a click zooms in
 * until they part. Pass `below` (the region label layer) to draw them under the region names: a pin never
 * pushes a name away, and a name over a pin stays legible on its ink halo.
 */
export function addPlants(map: MapboxMap, fc: PlantCollection, visible = true, opts: PlantOptions = {}): void {
  removePlants(map);

  // Plants that would overlap on screen form groups that part smoothly as the map zooms in (plantGroups.ts).
  groups = plantGroups(
    fc.features.map((f) => ({
      lng: f.geometry.coordinates[0]!,
      lat: f.geometry.coordinates[1]!,
      capacityMw: f.properties.capacityMw,
      props: f.properties,
    })),
  );
  // The column under each marker's point, from the shapes the columns are drawn with.
  const shapes = opts.regions ? calmShapes(opts.regions) : null;
  for (const n of groups) standsOn.set(n.id, (shapes && regionAt(shapes, n.lng, n.lat)) ?? GROUND);
  map.addSource(SOURCE, { type: "geojson", data: groupCollection(groups) as unknown as GeoJSONSourceSpecification["data"] });
  // Opacity per marker from feature-state, written on every zoom: exact at any zoom (a zoom-and-feature
  // paint expression is only evaluated at whole zooms and blended, which left groups half-faded at rest).
  writeOpacity(map);
  onZoom = () => {
    writeOpacity(map);
    if (openNode) placePopup(map);
  };
  map.on("zoom", onZoom);
  const present = fuelsPresent(fc);
  const paper = token("--color-paper");
  const ink = token("--color-ink");
  for (const fuel of present) map.addImage(`plant-${fuel}`, pinImage({ fill: token(`--color-fuel-${fuel}`), paper, ink }), { pixelRatio: PIXEL_RATIO });

  const below = opts.below && map.getLayer(opts.below) ? opts.below : undefined;
  wanted = visible;
  // Hidden until the overview has landed (setPlantsLanded).
  const visibility = landed && visible ? "visible" : "none";
  // One layer per column, since each stands at its own column's height. Back to front: the ground first,
  // then the columns from north to south, so at the tilted view a nearer pin is drawn over a farther one.
  const lat = new Map(opts.regions?.features.map((f) => [f.properties.id, regionLat(f)]));
  const columns = [...new Set(standsOn.values())].sort((a, b) =>
    a === GROUND ? -1 : b === GROUND ? 1 : (lat.get(b) ?? 0) - (lat.get(a) ?? 0),
  );
  layerIds = columns.map((c) => PLANT_LAYER_PREFIX + c);
  for (const column of columns) {
    const lift = pinLift(column);
    liftAt.set(column, JSON.stringify(lift));
    map.addLayer(
      {
        id: PLANT_LAYER_PREFIX + column,
        type: "symbol",
        source: SOURCE,
        slot: "top",
        // Not on the globe: symbol layers drawn while the camera moves through the globe zooms made Chromium
        // log GL_INVALID_OPERATION warnings (the plants are one tiny group there anyway).
        minzoom: MARKER_MIN_ZOOM,
        filter: ["==", ["get", "column"], column],
        layout: {
          "icon-image": plantIconExpression(present),
          "icon-size": pinIconSize(),
          // The point of the pin is on the plant.
          "icon-anchor": "bottom",
          // Pins neither hide nor push away other symbols: every region name keeps its place.
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          // A group carries its count in the head (paper on an ink halo); a single plant has no text.
          "text-field": ["case", IS_GROUP, ["to-string", ["get", "count"]], ""],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-size": COUNT_TEXT_PX,
          "text-offset": countOffset(),
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          // No sort key: with overlap allowed, Mapbox then draws by screen height, a nearer pin over a
          // farther one. Lifted onto the column top by symbol-z-offset below.
          "symbol-z-elevate": true,
          visibility,
        },
        paint: {
          "symbol-z-offset": lift,
          // The lift follows the column every frame; a transition would let it lag behind.
          "symbol-z-offset-transition": { duration: 0, delay: 0 },
          // Fades in where its group parts, never pops. One style for every plant; the tooltip names the
          // status of planned and unverified sites.
          "icon-opacity": SHOWN,
          "text-opacity": SHOWN,
          "text-color": paper,
          "text-halo-color": ink,
          "text-halo-width": COUNT_HALO_PX,
          "icon-emissive-strength": 1,
          "text-emissive-strength": 1,
          // Never ghosted behind a column in front.
          "icon-occlusion-opacity": 1,
          "text-occlusion-opacity": 1,
        },
      },
      // Under the region labels, so a pin passes beneath a name instead of over it.
      below,
    );
  }

  popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "map-popup", maxWidth: "280px" });
  /** The marker under the pointer, if it is actually shown at this zoom (a faded-out one is not). */
  const shown = (e: mapboxgl.InteractionEvent) => {
    const node = groups.find((g) => g.id === Number(e.feature?.properties?.node));
    return node && markerShown(node, map.getZoom()) >= 0.5 ? node : undefined;
  };
  const open = (node: GroupNode<PlantProperties>) => {
    if (openNode?.id === node.id && popup?.isOpen()) return;
    openNode = node;
    popup!
      .setLngLat([node.lng, node.lat])
      .setHTML(node.kind === "group" ? plantClusterHtml(node.members) : plantPopupHtml(node.members[0]!));
    placePopup(map);
    popup!.addTo(map);
  };
  const close = () => {
    openNode = null;
    popup?.remove();
  };
  // Hover: the topmost marker actually shown under the pointer, across every pin layer. Faded-out markers
  // sit on the same spots, so per-layer enter and leave events would fire for them and close or block the
  // tooltip of the marker you see.
  onPointer = (e: MapMouseEvent) => {
    const layers = layerIds.filter((id) => map.getLayer(id));
    if (!layers.length) return;
    const z = map.getZoom();
    const hit = map
      .queryRenderedFeatures(e.point, { layers })
      .map((f) => groups.find((g) => g.id === Number((f as unknown as { properties?: { node?: number } }).properties?.node)))
      .find((n) => n !== undefined && markerShown(n, z) >= 0.5);
    if (hit) {
      map.getCanvas().style.cursor = "pointer";
      cursorOwned = true;
      open(hit);
      return;
    }
    if (cursorOwned) {
      map.getCanvas().style.cursor = "";
      cursorOwned = false;
    }
    if (openNode !== null) close();
  };
  map.on("mousemove", onPointer);
  // Leaving the map for the sheet or the dock sends no more mousemoves, so the tooltip closes here.
  onPointerOut = () => {
    if (cursorOwned) map.getCanvas().style.cursor = "";
    cursorOwned = false;
    if (openNode !== null) close();
  };
  map.on("mouseout", onPointerOut);
  for (const layerId of layerIds) {
    const id = `${layerId}-click`;
    interactionIds.push(id);
    map.addInteraction(id, {
      type: "click",
      target: { layerId },
      handler: (e) => {
        const node = shown(e);
        if (!node) return false;
        // Touch screens have no hover, so a tap on a plant opens the same tooltip (and does not select the
        // region below).
        if (node.kind === "plant") {
          open(node);
          return;
        }
        // A click on a group zooms in until its plants have parted. Two plants on the very same spot never
        // part; the zoom stops at building level then.
        close();
        const zoom = Math.min(Math.max(node.split + FADE_ZOOMS, map.getZoom() + 1), 16);
        map.easeTo({ center: [node.lng, node.lat], zoom, duration: 900, essential: true });
      },
    });
  }
}

/**
 * Whether the overview has landed. Until then the markers stay hidden: any symbol layer drawn while a
 * skipped intro eases off the globe made Chromium log GL_INVALID_OPERATION warnings (Mapbox 3.33; even a
 * bare icon layer did, 3 of 8 runs; with the markers hidden during the flight, 0 of 8).
 */
let landed = false;
/** The plant layer switch (Pembangkit). */
let wanted = true;

function applyVisibility(map: MapboxMap) {
  const v = landed && wanted ? "visible" : "none";
  for (const id of layerIds) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
  if (v === "none") {
    openNode = null;
    popup?.remove();
  }
}

/** Shows the markers once the overview has landed and the map is idle (MapView calls it after the intro). */
export function setPlantsLanded(map: MapboxMap): void {
  landed = true;
  applyVisibility(map);
}

/** Shows or hides the plants (the Pembangkit switch). */
export function setPlantsVisible(map: MapboxMap, visible: boolean): void {
  wanted = visible;
  applyVisibility(map);
}

/** Removes the tooltip, layers, source, marker images and interactions. */
export function removePlants(map: MapboxMap): void {
  landed = false;
  if (onPointer) map.off("mousemove", onPointer);
  onPointer = null;
  if (onPointerOut) map.off("mouseout", onPointerOut);
  onPointerOut = null;
  cursorOwned = false;
  openNode = null;
  if (onZoom) map.off("zoom", onZoom);
  onZoom = null;
  shownAt.clear();
  standsOn.clear();
  liftAt.clear();
  popup?.remove();
  popup = null;
  for (const id of interactionIds) map.removeInteraction(id);
  interactionIds = [];
  for (const id of layerIds) if (map.getLayer(id)) map.removeLayer(id);
  layerIds = [];
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of FUELS as readonly FuelType[]) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
}
