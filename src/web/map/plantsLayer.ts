import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties } from "../api.ts";
import { token } from "../theme.ts";
import { FUEL_LABELS, FUELS, fuelKey } from "./fuels.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";
export const PLANT_LAYER = "plants";
const INTERACTIONS = ["plants-enter", "plants-click", "plants-leave"] as const;

const STATUS_LABEL: Record<string, string> = {
  operating: "Beroperasi",
  planned: "Rencana",
  unknown: "Captive / belum terverifikasi",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Popup body for one plant. Unverified sites and guessed coordinates say so plainly. */
export function plantPopupHtml(p: PlantProperties): string {
  const fuel = fuelKey(p.fuel);
  const notes: string[] = [];
  if (p.status !== "operating") notes.push(STATUS_LABEL[p.status] ?? p.status);
  if (p.approx) notes.push("Lokasi perkiraan");
  return `
    <div class="plant-popup">
      <div class="plant-popup__fuel"><span class="fuel-dot" data-fuel="${fuel}"></span>${FUEL_LABELS[fuel]}</div>
      <div class="plant-popup__name">${escapeHtml(p.name)}</div>
      <div class="plant-popup__mw"><span class="num">${fmtNumber(p.capacityMw)}</span> MW</div>
      ${notes.map((n) => `<div class="plant-popup__note">${escapeHtml(n)}</div>`).join("")}
    </div>`;
}

let popup: mapboxgl.Popup | null = null;
const IMAGE_PX = 128;
const PERIOD_MS = 3200;

interface MarkerColors {
  /** Fuel colour. */
  core: string;
  /** Outer edge (ink). */
  edge: string;
  /** Ring and pulse (paper). */
  pulse: string;
}

/**
 * A marker drawn on a canvas (Mapbox's animated-image pattern): a fuel-coloured core in a paper ring
 * with an ink edge, so it reads on a light map, a dark map and on top of the columns. A thin ring grows
 * and fades from it, meaning "a working plant". A symbol layer, unlike a circle layer, can ignore depth,
 * so the plants stay visible in front of the region columns.
 */
function markerImage(map: MapboxMap, colors: MarkerColors, phase: number): mapboxgl.StyleImageInterface {
  const size = IMAGE_PX;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = canvas.getContext("2d", { willReadFrequently: true });

  const draw = (now: number) => {
    if (!ctx) return;
    const t = still ? 0.4 : ((now + phase) % PERIOD_MS) / PERIOD_MS;
    const c = size / 2;
    const core = size * 0.13;
    const ring = core + 4;
    ctx.clearRect(0, 0, size, size);
    // The pulse: a paper ring with an ink edge, from the marker outwards, fading as it grows.
    const r = ring + 2 + (size * 0.47 - ring - 2) * t;
    ctx.globalAlpha = 0.7 * (1 - t) ** 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = colors.edge;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = colors.pulse;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Ink edge, paper ring, then the fuel colour.
    ctx.beginPath();
    ctx.arc(c, c, ring + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = colors.edge;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c, ring, 0, Math.PI * 2);
    ctx.fillStyle = colors.pulse;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c, c, core, 0, Math.PI * 2);
    ctx.fillStyle = colors.core;
    ctx.fill();
  };

  // Mapbox copies `data` when the image is added, so the first frame must exist before that (and it
  // is the only frame when the user prefers reduced motion).
  draw(performance.now());
  return {
    width: size,
    height: size,
    data: ctx ? ctx.getImageData(0, 0, size, size).data : new Uint8Array(size * size * 4),
    render() {
      if (!ctx || still) return false;
      draw(performance.now());
      this.data = ctx.getImageData(0, 0, size, size).data;
      map.triggerRepaint();
      return true;
    },
    onRemove() {
      ctx = null;
    },
  };
}

/** Power plants as pulsing markers coloured by fuel and sized by MW, with a popup on hover or tap. */
export function addPlants(map: MapboxMap, fc: PlantCollection): void {
  removePlants(map);
  map.addSource(SOURCE, { type: "geojson", data: fc as unknown as GeoJSONSourceSpecification["data"] });
  const edge = token("--color-ink");
  const paper = token("--color-paper");
  FUELS.forEach((fuel, i) => {
    map.addImage(`plant-${fuel}`, markerImage(map, { core: token(`--color-fuel-${fuel}`), edge, pulse: paper }, i * 460), { pixelRatio: 2 });
  });

  // Square root of MW so a 2.200 MW site does not swallow a 50 MW one.
  const size = (k: number): ExpressionSpecification => ["*", k, ["+", 0.5, ["*", 0.022, ["sqrt", ["get", "capacityMw"]]]]];
  map.addLayer({
    id: PLANT_LAYER,
    type: "symbol",
    source: SOURCE,
    slot: "top",
    layout: {
      "icon-image": ["concat", "plant-", ["match", ["get", "fuel"], [...FUELS], ["get", "fuel"], "lainnya"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 5, size(0.75), 10, size(1.35)],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["-", 0, ["get", "capacityMw"]],
    },
    paint: {
      // Planned and unverified sites are drawn fainter than operating ones.
      "icon-opacity": ["match", ["get", "status"], "operating", 1, 0.6],
      "icon-emissive-strength": 1,
      // Draw markers in full even where a region column stands in front of them.
      "icon-occlusion-opacity": 1,
    },
  });

  popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: "map-popup", maxWidth: "260px" });
  const show = (e: mapboxgl.InteractionEvent) => {
    const f = e.feature;
    if (!f || f.geometry.type !== "Point") return;
    map.getCanvas().style.cursor = "pointer";
    popup!
      .setLngLat(f.geometry.coordinates as [number, number])
      .setHTML(plantPopupHtml(f.properties as unknown as PlantProperties))
      .addTo(map);
  };
  map.addInteraction("plants-enter", { type: "mouseenter", target: { layerId: PLANT_LAYER }, handler: show });
  // Touch screens have no hover, so a tap opens the same popup (and does not select the region below).
  map.addInteraction("plants-click", { type: "click", target: { layerId: PLANT_LAYER }, handler: show });
  map.addInteraction("plants-leave", {
    type: "mouseleave",
    target: { layerId: PLANT_LAYER },
    handler: () => {
      map.getCanvas().style.cursor = "";
      popup?.remove();
      return false;
    },
  });
}

export function setPlantsVisible(map: MapboxMap, visible: boolean): void {
  if (map.getLayer(PLANT_LAYER)) map.setLayoutProperty(PLANT_LAYER, "visibility", visible ? "visible" : "none");
  if (!visible) popup?.remove();
}

export function removePlants(map: MapboxMap): void {
  popup?.remove();
  popup = null;
  for (const id of INTERACTIONS) map.removeInteraction(id);
  if (map.getLayer(PLANT_LAYER)) map.removeLayer(PLANT_LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of FUELS as readonly FuelType[]) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
}
