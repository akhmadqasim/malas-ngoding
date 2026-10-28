import type { Map as MapboxMap, TargetFeature } from "mapbox-gl";
import type { BuildingType } from "../../shared/types.ts";
import { ARCHITECTURE_LAYER, hasSolarRoof, setArchitectureRoofs } from "./architecture.ts";
import { roofPlacement } from "./footprintLayout.ts";

const SOURCE = "building-design";
const MODEL_IDS = ["mosque-roof"];
const modelBuildings = new WeakMap<MapboxMap, string | number>();

export function suppressOccupiedBuildingDesign(map: MapboxMap, ids: (string | number)[]): void {
  const id = modelBuildings.get(map);
  if (id != null && ids.includes(id)) clearBuildingDesign(map);
}

/** Religious buildings only get a mosque dome when the place name identifies a mosque. */
export function designFor(type: BuildingType, name = "") {
  const mosque = type === "ibadah" && /\b(masjid|mesjid|mosque|musala|mus[hs]olla|mushala)\b/i.test(name);
  if (mosque) return { roof: "flat", model: "mosque-roof" } as const;
  if (type === "ibadah") return { roof: "pyramidal", model: null } as const;
  if (type === "gudang" || type === "industri") return { roof: "gabled", model: null } as const;
  if (type === "sekolah" || type === "kampus" || type === "pemerintahan") return { roof: "hipped", model: null } as const;
  if (type === "rumah") return { roof: "hipped", model: null } as const;
  if (type === "ruko") return { roof: "skillion", model: null } as const;
  return { roof: "parapet", model: null } as const;
}

export function clearBuildingDesign(map: MapboxMap): void {
  modelBuildings.delete(map);
  if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  setArchitectureRoofs(map, "selection", []);
}

export function showBuildingDesign(map: MapboxMap, feature: TargetFeature, type: BuildingType, name: string | null): void {
  clearBuildingDesign(map);
  if (!map.getLayer(ARCHITECTURE_LAYER) || feature.id == null) return;
  const design = designFor(type, name ?? "");
  setArchitectureRoofs(map, "selection", [{ id: feature.id, roof: design.roof }]);
  if (!design.model || hasSolarRoof(map, feature.id) || feature.geometry.type !== "Polygon") return;
  const placement = roofPlacement(feature.geometry, 30);
  if (!placement) return;
  const { at, width: scale, angle } = placement;
  const height = Math.max(3, Number(feature.properties?.height) || 3);
  for (const id of MODEL_IDS) if (!map.hasModel(id)) map.addModel(id, `/models/${id}.glb`);
  map.addSource(SOURCE, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: at } } });
  modelBuildings.set(map, feature.id);
  map.addLayer({ id: SOURCE, type: "model", source: SOURCE, slot: "middle", minzoom: 15,
    layout: { "model-id": design.model }, paint: { "model-type": "common-3d", "model-elevation-reference": "ground",
      "model-translation": [0, 0, height + 0.15], "model-scale": [scale, scale, scale], "model-rotation": [0, 0, angle],
      "model-cast-shadows": true, "model-receive-shadows": true } });
}
