import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { token } from "../theme.ts";
import { windPose } from "../../shared/wind.ts";
import { offset } from "../../shared/buildSite.ts";

/*
 * "Bangun di sini" in 3D: the generated models (scripts/build-models.ts, served from /models/) standing on
 * the terrain. A PLTS is one model per mounting table inside its land outline; a PLTB is a tower and a
 * spinning rotor per turbine. Models are glTF in metres; Mapbox places them on the ground (elevation
 * reference "ground"), so they follow the hills.
 */

const MODELS = {
  "solar-table": "/models/solar-table.glb",
  "turbine-tower": "/models/turbine-tower.glb",
  "turbine-rotor": "/models/turbine-rotor.glb",
} as const;

const SOURCE = "farm";
const LAND_SOURCE = "farm-land";
const LAYERS = { land: "farm-land", edge: "farm-edge", tables: "farm-tables", towers: "farm-towers", rotors: "farm-rotors", wind: "farm-wind" } as const;
/** Degrees the rotor turns per second at full speed. A real 4,5 MW rotor turns at about 10 rpm. */
const ROTOR_DEG_PER_S = 60;

export type Farm =
  | { kind: "sun"; tables: [number, number][]; land: [number, number][] }
  | { kind: "wind"; sites: [number, number][]; spin: number; fromDeg?: number | null; speedMs?: number };

let spinFrame = 0;

const points = (coords: [number, number][]) => ({
  type: "FeatureCollection" as const,
  features: coords.map((c, i) => ({ type: "Feature" as const, id: i, properties: {}, geometry: { type: "Point" as const, coordinates: c } })),
});

function addModels(map: MapboxMap, kind: Farm["kind"]) {
  // Register on demand: unused preloaded models may be released with a previous model bucket.
  const ids = kind === "sun" ? ["solar-table"] as const : ["turbine-tower", "turbine-rotor"] as const;
  for (const id of ids) if (!map.hasModel(id)) map.addModel(id, MODELS[id]);
}

/** Draws the farm (replacing any shown), or removes it with `null`. */
export function showFarm(map: MapboxMap, farm: Farm | null): void {
  if (farm?.kind === "wind" && map.getLayer(LAYERS.towers) && map.getLayer(LAYERS.rotors)) {
    (map.getSource(SOURCE) as GeoJSONSource).setData(points(farm.sites));
    updateWind(map, farm);
    return;
  }
  removeFarm(map);
  if (!farm) return;
  addModels(map, farm.kind);
  const common = {
    "model-type": "common-3d",
    "model-cast-shadows": true,
    "model-receive-shadows": true,
    "model-elevation-reference": "ground",
  } as const;

  if (farm.kind === "sun") {
    map.addSource(LAND_SOURCE, {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...farm.land, farm.land[0]!]] } },
    });
    map.addLayer({
      id: LAYERS.land,
      type: "fill",
      source: LAND_SOURCE,
      slot: "top",
      paint: { "fill-color": token("--color-fuel-surya"), "fill-opacity": 0.12, "fill-emissive-strength": 1 },
    });
    map.addLayer({
      id: LAYERS.edge,
      type: "line",
      source: LAND_SOURCE,
      slot: "top",
      paint: { "line-color": token("--color-fuel-surya"), "line-width": 2, "line-dasharray": [2, 1.5], "line-emissive-strength": 1 },
    });
    map.addSource(SOURCE, { type: "geojson", data: points(farm.tables) });
    // Every table is drawn at every distance: Mapbox's density reduction thinned the far rows to stripes.
    map.addLayer({
      id: LAYERS.tables,
      type: "model",
      source: SOURCE,
      slot: "top",
      layout: { "model-id": "solar-table", "model-allow-density-reduction": false },
      paint: { ...common },
    });
    return;
  }

  map.addSource(SOURCE, { type: "geojson", data: points(farm.sites) });
  const turbinePaint = { ...common, "model-color": token("--color-ink"), "model-color-mix-intensity": 0.45 };
  const pose = windPose(farm.fromDeg ?? 0);
  map.addLayer({ id: LAYERS.towers, type: "model", source: SOURCE, slot: "top", layout: { "model-id": "turbine-tower", "model-allow-density-reduction": false }, paint: { ...turbinePaint, "model-rotation": pose.towerRotation } });
  map.addLayer({
    id: LAYERS.rotors,
    type: "model",
    source: SOURCE,
    slot: "top",
    layout: { "model-id": "turbine-rotor", "model-allow-density-reduction": false },
    paint: { ...turbinePaint, "model-translation": pose.hub, "model-rotation": pose.rotorRotation },
  });
  updateWind(map, farm);
}

/** Keep model layers alive while weather changes; removing them during a GLB load can drop the model. */
function updateWind(map: MapboxMap, farm: Extract<Farm, { kind: "wind" }>): void {
  if (spinFrame) cancelAnimationFrame(spinFrame);
  spinFrame = 0;
  const pose = windPose(farm.fromDeg ?? 0);
  map.setPaintProperty(LAYERS.towers, "model-rotation", pose.towerRotation);
  map.setPaintProperty(LAYERS.rotors, "model-translation", pose.hub);
  map.setPaintProperty(LAYERS.rotors, "model-rotation", pose.rotorRotation);
  if (farm.fromDeg != null && farm.sites[0]) {
    const radians = pose.toDeg * Math.PI / 180;
    const center = farm.sites[0];
    const arrows = [-500, 0, 500].map(side => {
      const at = offset(center, Math.cos(radians) * side, -Math.sin(radians) * side);
      const end = offset(at, Math.sin(radians) * 320, Math.cos(radians) * 320);
      const tail = offset(at, -Math.sin(radians) * 320, -Math.cos(radians) * 320);
      const left = offset(end, -Math.sin(radians) * 100 + Math.cos(radians) * 65, -Math.cos(radians) * 100 - Math.sin(radians) * 65);
      const right = offset(end, -Math.sin(radians) * 100 - Math.cos(radians) * 65, -Math.cos(radians) * 100 + Math.sin(radians) * 65);
      return { type: "Feature" as const, properties: {}, geometry: { type: "MultiLineString" as const, coordinates: [[tail, end], [left, end, right]] } };
    });
    const data = { type: "FeatureCollection" as const, features: arrows };
    const source = map.getSource(LAYERS.wind) as GeoJSONSource | undefined;
    if (source) source.setData(data);
    else {
      map.addSource(LAYERS.wind, { type: "geojson", data });
      map.addLayer({ id: LAYERS.wind, type: "line", source: LAYERS.wind, slot: "top", paint: { "line-color": token("--color-fuel-air"), "line-width": 2, "line-opacity": 0.7, "line-emissive-strength": 1 } });
    }
  } else {
    if (map.getLayer(LAYERS.wind)) map.removeLayer(LAYERS.wind);
    if (map.getSource(LAYERS.wind)) map.removeSource(LAYERS.wind);
  }
  // The rotor spins about the nacelle axis (north-south); the speed follows the site's wind (0..1).
  const speed = Math.min(Math.max(farm.spin, 0), 1) * ROTOR_DEG_PER_S;
  if ((speed > 0 || (farm.speedMs ?? 0) > 0.2) && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let last = performance.now();
    let dashTime = last;
    let dash = 0;
    let angle = 0;
    const turn = (now: number) => {
      if (!map.getLayer(LAYERS.rotors)) return;
      angle = (angle + ((now - last) / 1000) * speed) % 360;
      last = now;
      map.setPaintProperty(LAYERS.rotors, "model-rotation", windPose(farm.fromDeg ?? 0, angle).rotorRotation);
      if (map.getLayer(LAYERS.wind) && now - dashTime > 200) {
        dash = (dash + 1) % 4; dashTime = now;
        map.setPaintProperty(LAYERS.wind, "line-dasharray", [[0, 4, 3], [1, 4, 2], [2, 4, 1], [3, 4, 0]][dash]!);
      }
      spinFrame = requestAnimationFrame(turn);
    };
    spinFrame = requestAnimationFrame(turn);
  }
}

export function removeFarm(map: MapboxMap): void {
  if (spinFrame) cancelAnimationFrame(spinFrame);
  spinFrame = 0;
  for (const id of Object.values(LAYERS)) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SOURCE, LAND_SOURCE]) if (map.getSource(id)) map.removeSource(id);
  if (map.getSource(LAYERS.wind)) map.removeSource(LAYERS.wind);
}
