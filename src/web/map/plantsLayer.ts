import mapboxgl, { type ExpressionSpecification, type GeoJSONSourceSpecification, type Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, PlantProperties } from "../api.ts";
import { token } from "../theme.ts";
import { FUEL_LABELS, FUELS, fuelKey, fuelsPresent, plantIconExpression } from "./fuels.ts";
import type { FuelType } from "../../shared/types.ts";
import { fmtNumber } from "../../shared/format.ts";

const SOURCE = "plants";
export const PLANT_LAYER = "plants";
/**
 * An invisible copy of the markers, above the region labels, with a box the size of the marker itself.
 * It keeps labels off the markers; the drawn layer cannot, because its box includes the whole pulse.
 */
export const PLANT_HIT_LAYER = "plants-hit";
const HIT_IMAGE = "plant-hit";
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

// --- Pulse ---------------------------------------------------------------------------------------
// One shared ticker asks the map for a frame 24 times a second, but only while Mapbox is actually
// drawing a marker: it calls render() only for images in view, so with every plant off screen (or the
// layer hidden) the ticker stops asking and the map can sit idle. Any later frame (a pan, a hover) that
// draws a marker again restarts the pulse. Each marker redraws at most once per tick.

const IMAGE_PX = 128;
const FRAME_MS = 1000 / 24;
const PERIOD_MS = 3200;
/** How long after the last drawn marker the ticker keeps asking for frames. */
export const PULSE_IDLE_MS = 500;

const pulse = {
  map: null as MapboxMap | null,
  visible: true,
  still: false,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  /** When Mapbox last asked a marker image for a frame. */
  lastRender: Number.NEGATIVE_INFINITY,
};

/** Whether the pulse should ask for another frame, given when a marker was last drawn. */
export const pulseWantsFrame = (now: number, lastRender: number) => now - lastRender < PULSE_IDLE_MS;

function startPulse() {
  if (pulse.timer || pulse.still || !pulse.visible || !pulse.map) return;
  const map = pulse.map;
  pulse.timer = setInterval(() => {
    if (!document.hidden && pulseWantsFrame(performance.now(), pulse.lastRender)) map.triggerRepaint();
  }, FRAME_MS);
}

function stopPulse() {
  clearInterval(pulse.timer);
  pulse.timer = undefined;
}

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
function markerImage(colors: MarkerColors, phase: number): mapboxgl.StyleImageInterface {
  const size = IMAGE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = canvas.getContext("2d", { willReadFrequently: true });
  let lastDraw = Number.NEGATIVE_INFINITY;

  const draw = (now: number) => {
    if (!ctx) return;
    const t = pulse.still ? 0.4 : ((now + phase) % PERIOD_MS) / PERIOD_MS;
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
      const now = performance.now();
      pulse.lastRender = now;
      if (!ctx || pulse.still || !pulse.visible) return false;
      if (now - lastDraw < FRAME_MS - 1) return false;
      lastDraw = now;
      draw(now);
      this.data = ctx.getImageData(0, 0, size, size).data;
      return true;
    },
    onRemove() {
      ctx = null;
    },
  };
}

/** Core, ring and edge of a marker, as a share of the marker image (see markerImage). */
const MARKER_CORE_SHARE = 0.36;

/** Power plants as pulsing markers coloured by fuel and sized by MW, with a popup on hover or tap. */
export function addPlants(map: MapboxMap, fc: PlantCollection, visible = true, opts: { below?: string } = {}): void {
  removePlants(map);
  pulse.map = map;
  pulse.visible = visible;
  pulse.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  map.addSource(SOURCE, { type: "geojson", data: fc as unknown as GeoJSONSourceSpecification["data"] });
  const present = fuelsPresent(fc);
  const edge = token("--color-ink");
  const paper = token("--color-paper");
  present.forEach((fuel) => {
    // Phases are spread so neighbouring plants do not pulse in step.
    const phase = FUELS.indexOf(fuel) * 460;
    map.addImage(`plant-${fuel}`, markerImage({ core: token(`--color-fuel-${fuel}`), edge, pulse: paper }, phase), { pixelRatio: 2 });
  });

  // The hit box: transparent, as wide as the core and ring of a marker image at the same icon size.
  const hitPx = Math.round(IMAGE_PX * MARKER_CORE_SHARE);
  map.addImage(HIT_IMAGE, { width: hitPx, height: hitPx, data: new Uint8Array(hitPx * hitPx * 4) }, { pixelRatio: 2 });

  // Square root of MW so a 2.200 MW site does not swallow a 50 MW one.
  const size = (k: number): ExpressionSpecification => ["*", k, ["+", 0.5, ["*", 0.022, ["sqrt", ["get", "capacityMw"]]]]];
  const iconSize: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 5, size(0.75), 10, size(1.35)];
  const below = opts.below && map.getLayer(opts.below) ? opts.below : undefined;
  map.addLayer(
    {
      id: PLANT_LAYER,
      type: "symbol",
      source: SOURCE,
      slot: "top",
      layout: {
        "icon-image": plantIconExpression(present),
        "icon-size": iconSize,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["-", 0, ["get", "capacityMw"]],
        visibility: visible ? "visible" : "none",
      },
      paint: {
        // Planned and unverified sites are drawn fainter than operating ones.
        "icon-opacity": ["match", ["get", "status"], "operating", 1, 0.6],
        "icon-emissive-strength": 1,
        // Draw markers in full even where a region column stands in front of them.
        "icon-occlusion-opacity": 1,
      },
    },
    // Under the region labels, so a pulse ring passes beneath a name instead of over it.
    below,
  );
  map.addLayer({
    id: PLANT_HIT_LAYER,
    type: "symbol",
    source: SOURCE,
    slot: "top",
    layout: {
      "icon-image": HIT_IMAGE,
      "icon-size": iconSize,
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
      "icon-padding": 2,
      visibility: visible ? "visible" : "none",
    },
    paint: { "icon-opacity": 0 },
  });
  startPulse();

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

/** Shows or hides the plants. Hidden plants neither redraw nor ask the map for frames. */
export function setPlantsVisible(map: MapboxMap, visible: boolean): void {
  pulse.visible = visible;
  // The layout change makes Mapbox draw a frame, so shown markers report in and the pulse restarts.
  for (const layer of [PLANT_LAYER, PLANT_HIT_LAYER]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
  }
  if (visible) {
    startPulse();
  } else {
    stopPulse();
    popup?.remove();
  }
}

/** Stops the pulse, then removes the popup, layer, source, marker images and interactions. */
export function removePlants(map: MapboxMap): void {
  stopPulse();
  pulse.map = null;
  popup?.remove();
  popup = null;
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const layer of [PLANT_HIT_LAYER, PLANT_LAYER]) if (map.getLayer(layer)) map.removeLayer(layer);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  for (const fuel of FUELS as readonly FuelType[]) if (map.hasImage(`plant-${fuel}`)) map.removeImage(`plant-${fuel}`);
  if (map.hasImage(HIT_IMAGE)) map.removeImage(HIT_IMAGE);
}
