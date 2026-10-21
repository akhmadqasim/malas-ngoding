import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapboxMap } from "mapbox-gl";
import { token } from "../theme.ts";

// The places the AI chat found (find_places), marked on the map: numbered ink dots with a paper edge, as
// the chat lists them, with their names beside them. A click on one selects the building there.

export interface MarkedPlace {
  name: string;
  lng: number;
  lat: number;
}

export const PLACES_SOURCE = "chat-places";
export const PLACES_LAYER = "chat-places";
export const PLACES_NAMES_LAYER = "chat-place-names";
const FONT = ["DIN Pro Medium", "Arial Unicode MS Bold"];
const DOT_IMAGE = "chat-place-dot";
const INTERACTIONS = ["chat-places-click", "chat-places-enter", "chat-places-leave"] as const;
/** Dot size in CSS px. */
const DOT_PX = 22;

/** An ink disc with a paper edge, drawn at 2x for sharp edges. */
function dotImage(): ImageData {
  const size = DOT_PX * 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = token("--color-paper");
  ctx.fill();
  ctx.beginPath();
  ctx.arc(r, r, r - 4, 0, Math.PI * 2);
  ctx.fillStyle = token("--color-ink");
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
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
  if (!map.hasImage(DOT_IMAGE)) map.addImage(DOT_IMAGE, dotImage(), { pixelRatio: 2 });
  const paper = token("--color-paper");
  const ink = token("--color-ink");
  // The names first, so the dots draw over them.
  map.addLayer({
    id: PLACES_NAMES_LAYER,
    type: "symbol",
    source: PLACES_SOURCE,
    slot: "top",
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT,
      "text-size": 12,
      "text-anchor": "left",
      "text-offset": [1.1, 0],
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
    layout: {
      "icon-image": DOT_IMAGE,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "n"],
      "text-font": FONT,
      "text-size": 11,
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
