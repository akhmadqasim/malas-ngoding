import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapboxMap } from "mapbox-gl";
import { token } from "../theme.ts";

// The places the AI chat found (find_places), marked on the map: numbered ink pins with a paper edge, as
// the chat lists them, with their names beside them. Pins, not dots, so they never read as the round
// plant cluster markers. Shown from city zoom only: at the province view they would be clutter. A click on
// one selects the building there.

export interface MarkedPlace {
  name: string;
  lng: number;
  lat: number;
}

export const PLACES_SOURCE = "chat-places";
export const PLACES_LAYER = "chat-places";
export const PLACES_NAMES_LAYER = "chat-place-names";
/** Below this zoom (the province and region views) the pins are hidden. */
export const PLACES_MIN_ZOOM = 10;
const FONT = ["DIN Pro Medium", "Arial Unicode MS Bold"];
const PIN_IMAGE = "chat-place-pin";
const INTERACTIONS = ["chat-places-click", "chat-places-enter", "chat-places-leave"] as const;
/** Pin size in CSS px: a round head and a point at the place. */
const PIN_W = 22;
const PIN_H = 30;
/** The number sits in the head: its centre is this far above the point, in ems of the 11 px number. */
const HEAD_EM = -(PIN_H - PIN_W / 2) / 11;

/** An ink pin with a paper edge, drawn at 2x for sharp edges. */
function pinImage(): ImageData {
  const s = 2;
  const canvas = document.createElement("canvas");
  canvas.width = PIN_W * s;
  canvas.height = PIN_H * s;
  const ctx = canvas.getContext("2d")!;
  const r = (PIN_W / 2) * s;
  const tipY = PIN_H * s;
  const pin = (inset: number) => {
    const head = r - inset;
    const tip = tipY - inset * 1.6;
    // The sides leave the head where they touch it (tangents from the point) and meet at the point.
    const a = Math.acos(head / (tip - r));
    ctx.beginPath();
    ctx.arc(r, r, head, Math.PI / 2 + a, Math.PI / 2 - a);
    ctx.lineTo(r, tip);
    ctx.closePath();
  };
  pin(1);
  ctx.fillStyle = token("--color-paper");
  ctx.fill();
  pin(4);
  ctx.fillStyle = token("--color-ink");
  ctx.fill();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** The places as GeoJSON points numbered from 1, in the order the chat lists them. */
export function placeFeatures(places: MarkedPlace[]) {
  return {
    type: "FeatureCollection" as const,
    features: places.map((p, i) => ({
      type: "Feature" as const,
      id: i + 1,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { n: String(i + 1), name: p.name },
    })),
  };
}

let pick: ((lngLat: [number, number]) => void) | null = null;

/** Marks the places (replacing earlier marks). `onPick` runs with a place's [lng, lat] when it is clicked. */
export function showPlaces(map: MapboxMap, places: MarkedPlace[], onPick: (lngLat: [number, number]) => void): void {
  pick = onPick;
  const data = placeFeatures(places) as unknown as GeoJSONSourceSpecification["data"];
  const source = map.getSource(PLACES_SOURCE) as GeoJSONSource | undefined;
  if (source && map.getLayer(PLACES_LAYER)) {
    source.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
    return;
  }
  clearPlaces(map);
  map.addSource(PLACES_SOURCE, { type: "geojson", data });
  if (!map.hasImage(PIN_IMAGE)) map.addImage(PIN_IMAGE, pinImage(), { pixelRatio: 2 });
  const paper = token("--color-paper");
  const ink = token("--color-ink");
  // The names first, so the pins draw over them.
  map.addLayer({
    id: PLACES_NAMES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    slot: "top",
    minzoom: PLACES_MIN_ZOOM,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT,
      "text-size": 12,
      "text-anchor": "left",
      // Beside the pin's head.
      "text-offset": [1, HEAD_EM * (11 / 12)],
      "text-max-width": 14,
      // Earlier places in the list win where two names would touch.
      "symbol-sort-key": ["to-number", ["get", "n"]],
    },
    paint: {
      "text-color": paper,
      "text-halo-color": ink,
      "text-halo-width": 1.4,
      "text-emissive-strength": 1,
      // Seen through the 3D buildings and the region columns.
      "text-occlusion-opacity": 1,
    },
  });
  map.addLayer({
    id: PLACES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    slot: "top",
    minzoom: PLACES_MIN_ZOOM,
    layout: {
      "icon-image": PIN_IMAGE,
      "icon-anchor": "bottom",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "n"],
      "text-font": FONT,
      "text-size": 11,
      "text-offset": [0, HEAD_EM],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "symbol-sort-key": ["-", 0, ["to-number", ["get", "n"]]],
    },
    paint: {
      "text-color": paper,
      "icon-emissive-strength": 1,
      "text-emissive-strength": 1,
      "icon-occlusion-opacity": 1,
      "text-occlusion-opacity": 1,
    },
  });
  map.addInteraction("chat-places-click", {
    type: "click",
    target: { layerId: PLACES_LAYER },
    handler: (e) => {
      const g = e.feature?.geometry;
      if (g?.type === "Point") pick?.(g.coordinates as [number, number]);
    },
  });
  map.addInteraction("chat-places-enter", {
    type: "mouseenter",
    target: { layerId: PLACES_LAYER },
    handler: () => {
      map.getCanvas().style.cursor = "pointer";
    },
  });
  map.addInteraction("chat-places-leave", {
    type: "mouseleave",
    target: { layerId: PLACES_LAYER },
    handler: () => {
      map.getCanvas().style.cursor = "";
      return false;
    },
  });
}

/** Removes the marks, if any. */
export function clearPlaces(map: MapboxMap): void {
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const id of [PLACES_LAYER, PLACES_NAMES_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(PLACES_SOURCE)) map.removeSource(PLACES_SOURCE);
  pick = null;
}
