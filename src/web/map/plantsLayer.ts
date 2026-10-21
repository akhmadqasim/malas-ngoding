import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties } from "../api.ts";
import { token } from "../theme.ts";
import { FUEL_LABELS, FUELS, fuelKey, fuelsPresent, plantIconExpression } from "./fuels.ts";
import { FADE_ZOOMS, type GroupNode, markerOpacity, plantGroups, visibility as markerShown } from "./plantGroups.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";
/** Single plants. */
export const PLANT_LAYER = "plants";
/** Plants close enough on screen to overlap, drawn as one marker with their count. */
export const PLANT_CLUSTER_LAYER = "plant-clusters";
const INTERACTIONS = ["plants-enter", "plants-click", "plants-leave", "plant-clusters-enter", "plant-clusters-click", "plant-clusters-leave"] as const;


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

/** Marker scale for a capacity in MW: the square root, so a 2.200 MW site does not swallow a 40 MW one. */
const byCapacity = (k: number): ExpressionSpecification => ["*", k, ["+", 0.42, ["*", 0.018, ["sqrt", ["get", "capacityMw"]]]]];

/** `icon-size` of a plant dot: by capacity, growing a little as the map zooms in. */
export function plantIconSize(): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 5, byCapacity(0.7), 10, byCapacity(1.3)];
}

/**
 * `icon-size` of a group marker: by the summed capacity of its plants, like a single plant of that size,
 * but never too small to hold its count.
 */
export function clusterIconSize(): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 5, ["max", 0.8, byCapacity(0.7)], 10, ["max", 0.8, byCapacity(1.3)]];
}

let popup: mapboxgl.Popup | null = null;
let groups: GroupNode<PlantProperties>[] = [];

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
  const present = fuelsPresent(fc);
  const paper = token("--color-paper");
  const ink = token("--color-ink");
  for (const fuel of present) map.addImage(`plant-${fuel}`, dotImage({ fill: token(`--color-fuel-${fuel}`), paper, ink }), { pixelRatio: 2 });

  const below = opts.below && map.getLayer(opts.below) ? opts.below : undefined;
  const visibility = visible ? "visible" : "none";
  map.addLayer(
    {
      id: PLANT_LAYER,
      type: "symbol",
      source: SOURCE,
      slot: "top",
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
        "icon-opacity": markerOpacity(),
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
      filter: ["==", ["get", "kind"], "group"],
      layout: {
        // The same dot as a single plant, in the fuel of its largest plant, with the count on it.
        "icon-image": plantIconExpression(present),
        "icon-size": clusterIconSize(),
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["to-string", ["get", "count"]],
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 11,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        visibility,
      },
      paint: {
        "icon-opacity": markerOpacity(),
        "text-opacity": markerOpacity(),
        "text-color": paper,
        "text-halo-color": ink,
        "text-halo-width": 1.2,
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
  const showPlant = (e: mapboxgl.InteractionEvent) => {
    const node = shown(e);
    if (!node) return false;
    map.getCanvas().style.cursor = "pointer";
    popup!.setLngLat([node.lng, node.lat]).setHTML(plantPopupHtml(node.members[0]!)).addTo(map);
  };
  const showCluster = (e: mapboxgl.InteractionEvent) => {
    const node = shown(e);
    if (!node) return false;
    map.getCanvas().style.cursor = "pointer";
    popup!.setLngLat([node.lng, node.lat]).setHTML(plantClusterHtml(node.members)).addTo(map);
  };
  const hide = () => {
    map.getCanvas().style.cursor = "";
    popup?.remove();
    return false;
  };
  map.addInteraction("plants-enter", { type: "mouseenter", target: { layerId: PLANT_LAYER }, handler: showPlant });
  // Touch screens have no hover, so a tap opens the same tooltip (and does not select the region below).
  map.addInteraction("plants-click", { type: "click", target: { layerId: PLANT_LAYER }, handler: showPlant });
  map.addInteraction("plants-leave", { type: "mouseleave", target: { layerId: PLANT_LAYER }, handler: hide });
  map.addInteraction("plant-clusters-enter", { type: "mouseenter", target: { layerId: PLANT_CLUSTER_LAYER }, handler: showCluster });
  // A click zooms in until the plants of the group have parted.
  map.addInteraction("plant-clusters-click", {
    type: "click",
    target: { layerId: PLANT_CLUSTER_LAYER },
    handler: (e) => {
      const node = shown(e);
      if (!node) return false;
      popup?.remove();
      map.easeTo({ center: [node.lng, node.lat], zoom: Math.max(node.split + FADE_ZOOMS, map.getZoom() + 1), duration: 900, essential: true });
    },
  });
  map.addInteraction("plant-clusters-leave", { type: "mouseleave", target: { layerId: PLANT_CLUSTER_LAYER }, handler: hide });
}

/** Shows or hides the plants. */
export function setPlantsVisible(map: MapboxMap, visible: boolean): void {
  for (const id of [PLANT_LAYER, PLANT_CLUSTER_LAYER]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  if (!visible) popup?.remove();
}

/** Removes the tooltip, layers, source, marker images and interactions. */
export function removePlants(map: MapboxMap): void {
  popup?.remove();
  popup = null;
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const id of [PLANT_CLUSTER_LAYER, PLANT_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of FUELS as readonly FuelType[]) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
}
