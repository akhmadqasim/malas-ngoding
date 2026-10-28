import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { offset } from "../../shared/buildSite.ts";
import { footprintContains } from "./buildings.ts";
import { ARCHITECTURE_LAYER } from "./architecture.ts";

const SOURCE = "illustrative-people";
const ROLES = ["warga", "pemda", "teknisi"] as const;
type Point = [number, number];
export type WalkLane = { role: typeof ROLES[number]; start: Point; end: Point; bearing: number };
type Footprint = { geometry: { type: string; coordinates?: unknown } };
const scenes = new WeakMap<MapboxMap, { owner: object; lanes: WalkLane[] }>();

/** Reject every sampled body position intersecting a building; do not place a person on the selected roof. */
export function walkLanes(at: Point, buildings: Footprint[]): WalkLane[] {
  const lanes: WalkLane[] = [];
  for (const [roleIndex, role] of ROLES.entries()) {
    search: for (const radius of [14, 25, 40, 65]) { candidate: for (let angle = 0; angle < 360; angle += 45) {
      const bearing = (angle + roleIndex * 120) % 360, radians = bearing * Math.PI / 180;
      const center = offset(at, Math.sin(radians) * radius, Math.cos(radians) * radius);
      if (lanes.some(l => Math.hypot(l.start[0] - center[0], l.start[1] - center[1]) < 0.00006)) continue;
      const start = offset(center, -Math.cos(radians) * 4, Math.sin(radians) * 4);
      const end = offset(center, Math.cos(radians) * 4, -Math.sin(radians) * 4);
      for (let step = 0; step <= 8; step++) {
        const p: Point = [start[0] + (end[0] - start[0]) * step / 8, start[1] + (end[1] - start[1]) * step / 8];
        for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (buildings.some(b => footprintContains(b.geometry, offset(p, x!, y!)))) continue candidate;
      }
      lanes.push({ role, start, end, bearing: (bearing + 90) % 360 }); break search;
    } }
  }
  return lanes;
}

/** Three illustrative virtual actors near the monitored building. Local lanes are not real pedestrian tracking. */
export function showPeople(map: MapboxMap, at: Point): () => void {
  const owner = {};
  let lanes: WalkLane[] = [], frame = 0, last = 0, disposed = false;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const data = (now: number) => ({ type: "FeatureCollection" as const, features: lanes.map((lane, i) => {
    const elapsed = reduced ? 0 : now / 1000 + i * 3;
    const travel = elapsed / 8 % 2, forward = travel <= 1, progress = forward ? travel : 2 - travel;
    const coordinates = lane.start.map((n, k) => n + (lane.end[k]! - n) * progress);
    const pose = reduced ? "stand" : Math.floor(elapsed * 4) % 2 ? "step-a" : "step-b";
    return { type: "Feature" as const, id: i, geometry: { type: "Point" as const, coordinates }, properties: {
      model: `person-${lane.role}-${pose}`, rotation: [0, 0, (lane.bearing + (forward ? 0 : 180)) % 360] } };
  }) });
  const rebuild = () => {
    if (disposed || map.getZoom() < 17.3 || !map.getLayer(ARCHITECTURE_LAYER)) return;
    const buildings = map.queryRenderedFeatures({ layers: [ARCHITECTURE_LAYER] }) as unknown as Footprint[];
    // Empty tiles do not prove the ground is clear. Wait for the building layer to load.
    if (!buildings.length) return;
    lanes = walkLanes(at, buildings).filter(lane => [lane.start, lane.end].every(point => !map.queryRenderedFeatures(map.project(point)).some(f => f.sourceLayer === "water")));
    scenes.set(map, { owner, lanes });
    if (!map.getSource(SOURCE)) {
      for (const role of ROLES) for (const pose of ["stand", "step-a", "step-b"]) {
        const id = `person-${role}-${pose}`; if (!map.hasModel(id)) map.addModel(id, `/models/${id}.glb`);
      }
      map.addSource(SOURCE, { type: "geojson", data: data(performance.now()) });
      map.addLayer({ id: SOURCE, type: "model", source: SOURCE, slot: "top", minzoom: 17.3,
        layout: { "model-id": ["get", "model"], "model-allow-density-reduction": false },
        paint: { "model-type": "common-3d", "model-elevation-reference": "ground", "model-scale": [1.75, 1.75, 1.75], "model-rotation": ["get", "rotation"], "model-cast-shadows": true, "model-receive-shadows": true } });
    }
    (map.getSource(SOURCE) as GeoJSONSource).setData(data(performance.now()));
  };
  const turn = (now: number) => {
    if (disposed || scenes.get(map)?.owner !== owner) return;
    if (!document.hidden && map.getZoom() >= 17.3 && now - last > 125) { (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(data(now)); last = now; }
    frame = requestAnimationFrame(turn);
  };
  scenes.set(map, { owner, lanes });
  map.on("moveend", rebuild); map.once("idle", rebuild); rebuild();
  if (!reduced) frame = requestAnimationFrame(turn);
  return () => {
    disposed = true; cancelAnimationFrame(frame); map.off("moveend", rebuild); map.off("idle", rebuild);
    if (scenes.get(map)?.owner !== owner) return;
    scenes.delete(map);
    if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  };
}
export function peopleFocus(map: MapboxMap): Point | null {
  const lane = scenes.get(map)?.lanes[0];
  return lane ? [(lane.start[0] + lane.end[0]) / 2, (lane.start[1] + lane.end[1]) / 2] : null;
}
