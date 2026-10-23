import type { ExpressionSpecification, Map as MapboxMap } from "mapbox-gl";
import { token } from "../theme.ts";

export const ARCHITECTURE_LAYER = "city-architecture";
const SOURCE = "city-architecture";
type RoofOverride = { id: string | number; roof: "flat" | "hipped" | "gabled" | "parapet" | "mansard" | "skillion" | "pyramidal" };
const roofOverrides = new WeakMap<MapboxMap, Map<string, RoofOverride[]>>();

/** Selection details and registered PV roofs share one expression, so neither erases the other. */
export function hasSolarRoof(map: MapboxMap, id: string | number): boolean {
  return roofOverrides.get(map)?.get("solar")?.some(entry => entry.id === id) ?? false;
}

export function setArchitectureRoofs(map: MapboxMap, owner: "selection" | "solar" | "district" | "preview", overrides: RoofOverride[]): void {
  let groups = roofOverrides.get(map);
  if (!groups) { groups = new Map(); roofOverrides.set(map, groups); }
  groups.set(owner, overrides);
  if (!map.getLayer(ARCHITECTURE_LAYER)) return;
  const entries = [...(groups.get("preview") ?? []), ...(groups.get("solar") ?? []), ...(groups.get("selection") ?? []), ...(groups.get("district") ?? [])];
  const expression: unknown[] = ["case"];
  for (const entry of entries) expression.push(["==", ["id"], entry.id], entry.roof);
  expression.push(architectureRoofs);
  map.setLayoutProperty(ARCHITECTURE_LAYER, "building-roof-shape", entries.length ? expression as ExpressionSpecification : architectureRoofs);
}

// Reuse the original footprints and measured heights. Architectural details are illustrative.
const height: ExpressionSpecification = ["max", 3, ["to-number", ["get", "height"], 3]];
const variant: ExpressionSpecification = ["%", ["to-number", ["id"], 0], 5];
const knownType: ExpressionSpecification = ["downcase", ["to-string", ["coalesce", ["get", "type"], ["get", "building"], ""]]];
export const architectureRoofs: ExpressionSpecification = ["case", [">=", height, 18], "parapet",
  ["match", knownType, ["warehouse", "industrial", "hangar"], "gabled", ["office", "commercial", "hospital", "hotel"], "parapet",
    ["school", "university", "civic"], "hipped", ["mosque", "church", "place_of_worship"], "pyramidal",
    ["match", variant, 0, "gabled", 1, "hipped", 2, "mansard", 3, "hipped", "gabled"]]];

export function architectureColor(highlight: string, selected: string): ExpressionSpecification {
  return ["case", ["boolean", ["feature-state", "select"], false], selected,
    ["boolean", ["feature-state", "highlight"], false], highlight,
    ["match", variant, 0, token("--color-building-sand"), 1, token("--color-building-stone"), 2, token("--color-building-slate"), 3, token("--color-building-clay"), token("--color-building-sage")]];
}

export function addArchitecture(map: MapboxMap): void {
  if (!map.getSource(SOURCE)) {
    map.addSource(SOURCE, { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
  }
  if (!map.getLayer(ARCHITECTURE_LAYER)) map.addLayer({
    id: ARCHITECTURE_LAYER, type: "building", source: SOURCE, "source-layer": "building", slot: "middle", minzoom: 14,
    filter: ["!=", ["get", "extrude"], "false"],
    layout: {
      "building-height": height,
      "building-base": ["max", 0, ["to-number", ["get", "min_height"], 0]],
      "building-roof-shape": architectureRoofs,
      "building-facade": true,
      "building-facade-floors": ["max", 1, ["round", ["/", height, 3.2]]],
      "building-facade-unit-width": 3.5,
      "building-facade-window": [0.65, 0.55],
    },
    paint: {
      "building-color": architectureColor(token("--color-ink-faint"), token("--color-outline-light")),
      "building-cast-shadows": true,
      "building-ambient-occlusion-intensity": 0.5,
      "building-facade-emissive-chance": 0.25,
    },
  });
  // At city zoom the custom layer replaces the block buildings, while the original 2D map stays intact.
  map.setConfigProperty("basemap", "show3dBuildings", false);
}

export function removeArchitecture(map: MapboxMap): void {
  roofOverrides.delete(map);
  if (map.getLayer(ARCHITECTURE_LAYER)) map.removeLayer(ARCHITECTURE_LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
