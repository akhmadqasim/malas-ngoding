import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties } from "../api.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";
export const PLANT_LAYER = "plants";

export const FUEL_COLORS: Record<FuelType, string> = {
  batubara: "#ff5a4e",
  gas: "#ff9f1c",
  diesel: "#b07a45",
  surya: "#ffd23f",
  air: "#3fa7ff",
  biomassa: "#4cc76a",
  lainnya: "#a0a8b8",
};
export const FUEL_LABELS: Record<FuelType, string> = {
  batubara: "Batu bara",
  gas: "Gas",
  diesel: "Diesel",
  surya: "Surya",
  air: "Air",
  biomassa: "Biomassa",
  lainnya: "Lainnya",
};
/** Coal plants get a dark core inside their red ring: coal reads as soot, not as a bright light. */
const COAL_CORE = "#2f3138";

const STATUS_LABEL: Record<string, string> = {
  operating: "Beroperasi",
  planned: "Rencana",
  unknown: "Captive / belum terverifikasi",
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Popup body for one plant. Unverified sites and guessed coordinates say so plainly. */
export function plantPopupHtml(p: PlantProperties): string {
  const fuel = (p.fuel in FUEL_LABELS ? p.fuel : "lainnya") as FuelType;
  const notes: string[] = [];
  if (p.status !== "operating") notes.push(STATUS_LABEL[p.status] ?? p.status);
  if (p.approx) notes.push("Lokasi perkiraan");
  return `
    <div class="plant-popup">
      <div class="plant-popup__fuel"><span style="background:${FUEL_COLORS[fuel]}"></span>${FUEL_LABELS[fuel]}</div>
      <div class="plant-popup__name">${escapeHtml(p.name)}</div>
      <div class="plant-popup__mw">${fmtNumber(p.capacityMw)} <small>MW</small></div>
      ${notes.length ? `<div class="plant-popup__notes">${notes.map((n) => `<span>${escapeHtml(n)}</span>`).join("")}</div>` : ""}
    </div>`;
}

let popup: mapboxgl.Popup | null = null;
const IMAGE_PX = 128;

/**
 * A pulsing marker drawn on a canvas each frame (Mapbox's animated-image pattern). A symbol layer
 * (unlike a circle layer) can ignore depth, so the plants stay visible in front of the region columns.
 */
function pulsingMarker(map: MapboxMap, fuel: FuelType, phase: number): mapboxgl.StyleImageInterface {
  const size = IMAGE_PX;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let ctx: CanvasRenderingContext2D | null = null;
  const color = FUEL_COLORS[fuel];
  const coal = fuel === "batubara";
  return {
    width: size,
    height: size,
    data: new Uint8Array(size * size * 4),
    onAdd() {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    },
    render() {
      if (!ctx) return false;
      const period = 2600;
      const t = still ? 0.35 : ((performance.now() + phase) % period) / period;
      const c = size / 2;
      const core = size * 0.16;
      ctx.clearRect(0, 0, size, size);
      // Ring that grows and fades.
      ctx.beginPath();
      ctx.arc(c, c, core + (size * 0.5 - core - 2) * t, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.75 * (1 - t) ** 1.6;
      ctx.lineWidth = 3 + 5 * (1 - t);
      ctx.stroke();
      // Soft glow under the core.
      ctx.globalAlpha = 1;
      const glow = ctx.createRadialGradient(c, c, core * 0.6, c, c, core * 2.1);
      glow.addColorStop(0, `${color}aa`);
      glow.addColorStop(1, `${color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c, c, core * 2.1, 0, Math.PI * 2);
      ctx.fill();
      // Core: coal is a dark lump in a red ring, every other fuel is a bright dot.
      ctx.beginPath();
      ctx.arc(c, c, core, 0, Math.PI * 2);
      ctx.fillStyle = coal ? COAL_CORE : color;
      ctx.fill();
      ctx.lineWidth = coal ? 6 : 4;
      ctx.strokeStyle = coal ? color : "rgba(255,255,255,0.9)";
      ctx.stroke();
      this.data = ctx.getImageData(0, 0, size, size).data;
      if (!still) map.triggerRepaint();
      return true;
    },
  };
}

/** Power plants as pulsing markers coloured by fuel and sized by MW, with a popup on hover or tap. */
export function addPlants(map: MapboxMap, fc: PlantCollection): void {
  removePlants(map);
  map.addSource(SOURCE, { type: "geojson", data: fc as unknown as GeoJSONSourceSpecification["data"] });
  (Object.keys(FUEL_COLORS) as FuelType[]).forEach((fuel, i) => {
    map.addImage(`plant-${fuel}`, pulsingMarker(map, fuel, i * 430), { pixelRatio: 2 });
  });

  // Square root of MW so a 2.200 MW site does not swallow a 50 MW one.
  const size = (k: number): ExpressionSpecification => ["*", k, ["+", 0.5, ["*", 0.022, ["sqrt", ["get", "capacityMw"]]]]];
  map.addLayer({
    id: PLANT_LAYER,
    type: "symbol",
    source: SOURCE,
    slot: "top",
    layout: {
      "icon-image": ["concat", "plant-", ["match", ["get", "fuel"], Object.keys(FUEL_COLORS), ["get", "fuel"], "lainnya"]],
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

  popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 16, className: "glass-popup", maxWidth: "260px" });
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
  for (const id of ["plants-enter", "plants-click", "plants-leave"]) map.removeInteraction(id);
  if (map.getLayer(PLANT_LAYER)) map.removeLayer(PLANT_LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of Object.keys(FUEL_COLORS)) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
}
