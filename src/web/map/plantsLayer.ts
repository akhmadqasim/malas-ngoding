import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type MapMouseEvent, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties } from "../api.ts";
import { token } from "../theme.ts";
import { FUEL_LABELS, FUELS, fuelKey, fuelsPresent, plantIconExpression } from "./fuels.ts";
import { FADE_ZOOMS, type GroupNode, plantGroups, visibility as markerShown } from "./plantGroups.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";
/** Single plants. */
export const PLANT_LAYER = "plants";
/** Plants close enough on screen to overlap, drawn as one marker with their count. */
export const PLANT_CLUSTER_LAYER = "plant-clusters";
const INTERACTIONS = ["plants-click", "plant-clusters-click"] as const;


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
// Flat dots: the fuel colour inside a thin paper edge and a thin ink edge, so a dot reads on a light map,
// a dark map and on top of the amber or teal columns. No rings around it, no pulse: they read as targets.

/** Canvas size of a marker image, in image pixels (drawn at pixelRatio 2). */
const IMAGE_PX = 48;
/** Radius of the fuel colour, the paper edge and the ink edge, in image pixels. */
const CORE_R = 17;
const PAPER_W = 3;
const INK_W = 2;

interface DotColors {
  fill: string;
  paper: string;
  ink: string;
}

/** One marker image: a filled dot with a paper edge inside an ink edge. */
function dotImage({ fill, paper, ink }: DotColors): { width: number; height: number; data: Uint8Array | Uint8ClampedArray } {
  const size = IMAGE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { width: size, height: size, data: new Uint8Array(size * size * 4) };
  const c = size / 2;
  const disc = (r: number, color: string) => {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  disc(CORE_R + PAPER_W + INK_W, ink);
  disc(CORE_R + PAPER_W, paper);
  disc(CORE_R, fill);
  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data };
}

/**
 * Marker scale by capacity: the square root of MW, so a 2.200 MW site does not swallow a 40 MW one. It
 * depends on the feature only, never on the zoom: a zoom-and-feature `icon-size` made Chromium log
 * GL_INVALID_OPERATION warnings on every skipped intro (bisected in fix round 1).
 */
const byCapacity = (k: number): ExpressionSpecification => ["*", k, ["+", 0.42, ["*", 0.018, ["sqrt", ["get", "capacityMw"]]]]];

/** `icon-size` of a plant dot. */
export function plantIconSize(): ExpressionSpecification {
  return byCapacity(0.95);
}

/** `icon-size` of a group marker: like one plant of the summed capacity, never too small for its count. */
export function clusterIconSize(): ExpressionSpecification {
  return ["max", 0.9, byCapacity(0.95)];
}

let popup: mapboxgl.Popup | null = null;
let groups: GroupNode<PlantProperties>[] = [];
let onZoom: (() => void) | null = null;
let onPointer: ((e: MapMouseEvent) => void) | null = null;
/** The marker whose tooltip is open. */
let openNode: number | null = null;
/** The opacity last written per marker, so a zoom step only touches the markers that changed. */
const shownAt = new Map<number, number>();

/** Below this zoom the camera is on the globe, and no marker is drawn. */
export const MARKER_MIN_ZOOM = 6;
/** Size of the count on a group dot and its ink halo, in px. */
const COUNT_TEXT_PX = 12;
const COUNT_HALO_PX = 1.4;
/** Marker opacity, from feature-state `o` (0..1) that `writeOpacity` keeps in step with the zoom. */
const SHOWN: ExpressionSpecification = ["coalesce", ["feature-state", "o"], 0];

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
      },
    })),
  };
}

/**
 * Power plants as dots coloured by fuel and sized by MW, with a tooltip on hover or tap. Plants that would
 * overlap on screen merge into one cluster marker with their count; its tooltip lists them, a click zooms
 * in until they part. Pass `below` (the region label layer) to draw them under the region names: a marker
 * never pushes a name away, and a name over a marker stays legible on its ink halo.
 */
export function addPlants(map: MapboxMap, fc: PlantCollection, visible = true, opts: { below?: string } = {}): void {
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
  map.addSource(SOURCE, { type: "geojson", data: groupCollection(groups) as unknown as GeoJSONSourceSpecification["data"] });
  // Opacity per marker from feature-state, written on every zoom: exact at any zoom (a zoom-and-feature
  // paint expression is only evaluated at whole zooms and blended, which left groups half-faded at rest).
  writeOpacity(map);
  onZoom = () => writeOpacity(map);
  map.on("zoom", onZoom);
  const present = fuelsPresent(fc);
  const paper = token("--color-paper");
  const ink = token("--color-ink");
  for (const fuel of present) map.addImage(`plant-${fuel}`, dotImage({ fill: token(`--color-fuel-${fuel}`), paper, ink }), { pixelRatio: 2 });

  const below = opts.below && map.getLayer(opts.below) ? opts.below : undefined;
  wanted = visible;
  // Hidden until the overview has landed (setPlantsLanded).
  const visibility = landed && visible ? "visible" : "none";
  map.addLayer(
    {
      id: PLANT_LAYER,
      type: "symbol",
      source: SOURCE,
      slot: "top",
      // Not on the globe: symbol layers drawn while the camera moves through the globe zooms made Chromium
      // log GL_INVALID_OPERATION warnings (the plants are one tiny group there anyway).
      minzoom: MARKER_MIN_ZOOM,
      filter: ["==", ["get", "kind"], "plant"],
      layout: {
        "icon-image": plantIconExpression(present),
        "icon-size": plantIconSize(),
        // Markers neither hide nor push away other symbols: every region name keeps its place.
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // The largest on top where two still touch.
        "symbol-sort-key": ["-", 0, ["get", "capacityMw"]],
        visibility,
      },
      paint: {
        // Fades in where its group parts, never pops. One style for every plant; the tooltip names the
        // status of planned and unverified sites.
        "icon-opacity": SHOWN,
        "icon-emissive-strength": 1,
        // A symbol layer, unlike a circle layer, can ignore depth: the dots stay visible in front of the
        // region columns.
        "icon-occlusion-opacity": 1,
      },
    },
    // Under the region labels, so a marker passes beneath a name instead of over it.
    below,
  );
  map.addLayer(
    {
      id: PLANT_CLUSTER_LAYER,
      type: "symbol",
      source: SOURCE,
      slot: "top",
      minzoom: MARKER_MIN_ZOOM,
      filter: ["==", ["get", "kind"], "group"],
      layout: {
        // The same dot as a single plant, in the fuel of its largest plant, with the count on it.
        "icon-image": plantIconExpression(present),
        "icon-size": clusterIconSize(),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["to-string", ["get", "count"]],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
        "text-size": COUNT_TEXT_PX,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        visibility,
      },
      paint: {
        "icon-opacity": SHOWN,
        "text-opacity": SHOWN,
        "text-color": paper,
        "text-halo-color": ink,
        "text-halo-width": COUNT_HALO_PX,
        "icon-emissive-strength": 1,
        "text-emissive-strength": 1,
        "icon-occlusion-opacity": 1,
        "text-occlusion-opacity": 1,
      },
    },
    below,
  );

  popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "map-popup", maxWidth: "280px" });
  const at = (e: mapboxgl.InteractionEvent) => (e.feature?.geometry.type === "Point" ? (e.feature.geometry.coordinates as [number, number]) : null);
  /** The marker under the pointer, if it is actually shown at this zoom (a faded-out one is not). */
  const shown = (e: mapboxgl.InteractionEvent) => {
    const node = groups.find((g) => g.id === Number(e.feature?.properties?.node));
    return node && markerShown(node, map.getZoom()) >= 0.5 ? node : undefined;
  };
  const open = (node: GroupNode<PlantProperties>) => {
    if (openNode === node.id && popup?.isOpen()) return;
    openNode = node.id;
    popup!
      .setLngLat([node.lng, node.lat])
      .setHTML(node.kind === "group" ? plantClusterHtml(node.members) : plantPopupHtml(node.members[0]!))
      .addTo(map);
  };
  const close = () => {
    openNode = null;
    popup?.remove();
  };
  // Hover: the topmost marker actually shown under the pointer, across both layers. Faded-out markers sit
  // on the same spots, so per-layer enter and leave events would fire for them and close or block the
  // tooltip of the marker you see.
  onPointer = (e: MapMouseEvent) => {
    if (!map.getLayer(PLANT_LAYER)) return;
    const z = map.getZoom();
    const hit = map
      .queryRenderedFeatures(e.point, { layers: [PLANT_CLUSTER_LAYER, PLANT_LAYER] })
      .map((f) => groups.find((g) => g.id === Number((f as unknown as { properties?: { node?: number } }).properties?.node)))
      .find((n) => n !== undefined && markerShown(n, z) >= 0.5);
    map.getCanvas().style.cursor = hit ? "pointer" : "";
    if (hit) open(hit);
    else if (openNode !== null) close();
  };
  map.on("mousemove", onPointer);
  // Touch screens have no hover, so a tap opens the same tooltip (and does not select the region below).
  map.addInteraction("plants-click", {
    type: "click",
    target: { layerId: PLANT_LAYER },
    handler: (e) => {
      const node = shown(e);
      if (!node) return false;
      open(node);
    },
  });
  // A click zooms in until the plants of the group have parted.
  map.addInteraction("plant-clusters-click", {
    type: "click",
    target: { layerId: PLANT_CLUSTER_LAYER },
    handler: (e) => {
      const node = shown(e);
      if (!node) return false;
      close();
      // Two plants on the very same spot never part; the zoom stops at building level then.
      const zoom = Math.min(Math.max(node.split + FADE_ZOOMS, map.getZoom() + 1), 16);
      map.easeTo({ center: [node.lng, node.lat], zoom, duration: 900, essential: true });
    },
  });
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
  for (const id of [PLANT_LAYER, PLANT_CLUSTER_LAYER]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
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
  openNode = null;
  if (onZoom) map.off("zoom", onZoom);
  onZoom = null;
  shownAt.clear();
  popup?.remove();
  popup = null;
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const id of [PLANT_CLUSTER_LAYER, PLANT_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of FUELS as readonly FuelType[]) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
}
