import type { ExpressionSpecification, GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import type { PotentialCollection } from "../api.ts";
import { rampTokens, token } from "../theme.ts";
import type { PotentialKind } from "../store.ts";
import type { Tone } from "./effects.ts";

/*
 * The renewable potential map: the NASA POWER grid cells over Kalimantan Timur, flat on the ground and
 * coloured by the sun or wind value each cell has (`t`, 0..1 along the scale the sheet's legend shows). The
 * region columns step aside while it is open (MapView), so the cells read as one surface.
 */

const SOURCE = "potential";
const FILL = "potential-fill";
const LINE = "potential-line";
const PICKED = "potential-picked";
const INTERACTIONS = ["potential-click", "potential-enter", "potential-leave"] as const;

/** 0..1 per cell id: where its value sits on the legend's scale. */
export type CellScale = ReadonlyMap<number, number>;

interface State {
  map: MapboxMap;
  fc: PotentialCollection;
  scale: CellScale;
  kind: PotentialKind;
  tone: Tone;
}
let state: State | null = null;

function fillColor(kind: PotentialKind, tone: Tone): ExpressionSpecification {
  const stops = rampTokens(kind, tone);
  return ["interpolate", ["linear"], ["coalesce", ["get", "t"], 0], ...stops.flatMap((c, i) => [i / (stops.length - 1), c])];
}

/** The cells with their scale position baked in, so the fill needs no feature-state. */
function withScale(fc: PotentialCollection, scale: CellScale): PotentialCollection {
  return { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, t: scale.get(f.properties.id) ?? 0 } })) };
}

/** Adds the cells (or replaces them), coloured by `scale`. `onPick` gets the id of a clicked cell and the spot clicked. */
export function addPotential(map: MapboxMap, fc: PotentialCollection, kind: PotentialKind, scale: CellScale, tone: Tone, onPick: (id: number, at: [number, number]) => void): void {
  removePotential(map);
  state = { map, fc, scale, kind, tone };
  map.addSource(SOURCE, { type: "geojson", data: withScale(fc, scale) as never, promoteId: "id" });
  map.addLayer({
    id: FILL,
    type: "fill",
    source: SOURCE,
    slot: "middle",
    paint: {
      "fill-color": fillColor(kind, tone),
      // A faint tint up close, where a 3D farm stands on the ground and the land under it should show.
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["case", ["boolean", ["feature-state", "hover"], false], 0.92, 0.78],
        13.5,
        0.12,
      ],
      "fill-emissive-strength": 1,
      "fill-opacity-transition": { duration: 200 },
    },
  });
  map.addLayer({
    id: LINE,
    type: "line",
    source: SOURCE,
    slot: "middle",
    paint: { "line-color": token(tone === "light" ? "--color-ink" : "--color-paper"), "line-opacity": 0.35, "line-width": 0.8, "line-emissive-strength": 1 },
  });
  map.addLayer({
    id: PICKED,
    type: "line",
    source: SOURCE,
    slot: "middle",
    filter: ["==", ["get", "id"], -1],
    paint: { "line-color": token(tone === "light" ? "--color-ink" : "--color-paper-bright"), "line-width": 2.5, "line-emissive-strength": 1 },
  });

  let hovered: number | null = null;
  const setHover = (id: number | null) => {
    if (hovered !== null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
    hovered = id;
    if (id !== null) map.setFeatureState({ source: SOURCE, id }, { hover: true });
    map.getCanvas().style.cursor = id === null ? "" : "pointer";
  };
  map.addInteraction("potential-click", {
    type: "click",
    target: { layerId: FILL },
    handler: (e) => {
      const id = e.feature?.id;
      if (typeof id === "number") onPick(id, [e.lngLat.lng, e.lngLat.lat]);
    },
  });
  map.addInteraction("potential-enter", {
    type: "mouseenter",
    target: { layerId: FILL },
    handler: (e) => setHover(typeof e.feature?.id === "number" ? e.feature.id : null),
  });
  map.addInteraction("potential-leave", {
    type: "mouseleave",
    target: { layerId: FILL },
    handler: () => {
      setHover(null);
      return false;
    },
  });
}

/** Recolours the cells for another kind (sun or wind) and its scale. */
export function setPotentialKind(map: MapboxMap, kind: PotentialKind, scale: CellScale): void {
  if (!state || state.map !== map) return;
  state.kind = kind;
  state.scale = scale;
  (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(withScale(state.fc, scale) as never);
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, "fill-color", fillColor(kind, state.tone));
}

/** Outlines the picked cell, or none with `null`. */
export function setPotentialPicked(map: MapboxMap, id: number | null): void {
  if (map.getLayer(PICKED)) map.setFilter(PICKED, ["==", ["get", "id"], id ?? -1]);
}

/** Matches the ramp and the outlines to a light or dark ground. */
export function setPotentialTone(map: MapboxMap, tone: Tone): void {
  if (!state || state.map !== map || state.tone === tone) return;
  state.tone = tone;
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, "fill-color", fillColor(state.kind, tone));
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, "line-color", token(tone === "light" ? "--color-ink" : "--color-paper"));
  if (map.getLayer(PICKED)) map.setPaintProperty(PICKED, "line-color", token(tone === "light" ? "--color-ink" : "--color-paper-bright"));
}

export function removePotential(map: MapboxMap): void {
  for (const id of INTERACTIONS) map.removeInteraction(id);
  for (const id of [PICKED, LINE, FILL]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  map.getCanvas().style.cursor = "";
  if (state?.map === map) state = null;
}
