import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import { ARCHITECTURE_LAYER, setArchitectureRoofs } from "./architecture.ts";
import { pointInRings, projectedFootprint, type FootprintGeometry, type Point2 } from "./footprintLayout.ts";
import { token } from "../theme.ts";

const SOURCE = "architecture-facades";
type Feature = { id?: string | number; geometry: FootprintGeometry; properties?: Record<string, unknown> | null };
const states = new WeakMap<MapboxMap, { update: () => void; signature: string }>();

/** Full footprints keep their native building body. Windows are shallow facade inserts, never a second building. */
export function facadeDetails(features: Feature[]) {
  const unique = new Map<string, { feature: Feature; footprint: NonNullable<ReturnType<typeof projectedFootprint>> }>();
  for (const feature of features) {
    const footprint = projectedFootprint(feature.geometry);
    if (!footprint || footprint.area < 450 || footprint.area > 120000 || feature.id == null) continue;
    const key = `${feature.id}:${Number(feature.properties?.min_height) || 0}`;
    if (!unique.has(key) || unique.get(key)!.footprint.area < footprint.area) unique.set(key, { feature, footprint });
  }
  const windows: { type: "Feature"; properties: { base: number; top: number }; geometry: { type: "Polygon"; coordinates: Point2[][] } }[] = [];
  const roofs: { id: string | number; roof: "parapet" | "gabled" | "hipped" }[] = [];
  // Larger silhouettes get details without requiring a click, with a strict geometry budget.
  for (const { feature, footprint } of [...unique.values()].sort((a, b) => b.footprint.area - a.footprint.area).slice(0, 60)) {
    const height = Math.max(3, Number(feature.properties?.height) || 3);
    const base = Math.max(0, Number(feature.properties?.min_height) || 0);
    if (height <= base) continue;
    const long = Math.max(footprint.bounds.maxX - footprint.bounds.minX, footprint.bounds.maxY - footprint.bounds.minY);
    const short = Math.min(footprint.bounds.maxX - footprint.bounds.minX, footprint.bounds.maxY - footprint.bounds.minY);
    roofs.push({ id: feature.id!, roof: height >= 18 || footprint.area >= 1800 ? "parapet" : long > short * 1.8 ? "gabled" : "hipped" });
    const floors = Math.min(8, Math.max(1, Math.round((height - base) / 3.2)));
    const floorHeight = (height - base) / floors;
    const ring = footprint.rings[0]!;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!, b = ring[i + 1]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 3) continue;
      const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
      let nx = -uy, ny = ux;
      if (pointInRings(footprint.rings, [(a[0] + b[0]) / 2 + nx * 0.1, (a[1] + b[1]) / 2 + ny * 0.1])) { nx = -nx; ny = -ny; }
      const count = Math.min(18, Math.max(1, Math.floor(length / 4)));
      for (let j = 0; j < count; j++) for (let floor = 0; floor < floors; floor++) {
        if (windows.length >= 2600) break;
        const cx = a[0] + ux * length * (j + 0.5) / count, cy = a[1] + uy * length * (j + 0.5) / count;
        const half = Math.min(1.15, length / count * 0.32);
        const corners: Point2[] = [[cx - ux * half + nx * 0.025, cy - uy * half + ny * 0.025],
          [cx + ux * half + nx * 0.025, cy + uy * half + ny * 0.025],
          [cx + ux * half + nx * 0.09, cy + uy * half + ny * 0.09],
          [cx - ux * half + nx * 0.09, cy - uy * half + ny * 0.09]];
        const z = base + floor * floorHeight + floorHeight * 0.28;
        const coordinates = [...corners, corners[0]!].map(footprint.toLngLat);
        windows.push({ type: "Feature", properties: { base: z, top: z + Math.min(1.6, floorHeight * 0.48) }, geometry: { type: "Polygon", coordinates: [coordinates] } });
      }
    }
  }
  return { data: { type: "FeatureCollection" as const, features: windows }, roofs, buildings: unique.size };
}

export function enableBuildingDetails(map: MapboxMap): void {
  if (states.has(map)) return;
  const state = { signature: "", update: () => {
    if (!map.getLayer(ARCHITECTURE_LAYER)) return;
    const features = map.getZoom() >= 16.5 ? map.queryRenderedFeatures({ layers: [ARCHITECTURE_LAYER] }) as unknown as Feature[] : [];
    const details = facadeDetails(features);
    const signature = JSON.stringify(details);
    if (signature === state.signature) return;
    state.signature = signature;
    setArchitectureRoofs(map, "district", details.roofs);
    const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (source) { source.setData(details.data); return; }
    map.addSource(SOURCE, { type: "geojson", data: details.data });
    map.addLayer({ id: SOURCE, source: SOURCE, type: "fill-extrusion", slot: "middle", minzoom: 16.5,
      paint: { "fill-extrusion-color": token("--color-ink-faint"), "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"],
        "fill-extrusion-cast-shadows": false, "fill-extrusion-vertical-gradient": false } });
  } };
  states.set(map, state);
  map.on("idle", state.update);
  map.on("moveend", state.update);
}

export function removeBuildingDetails(map: MapboxMap): void {
  const state = states.get(map);
  if (state) { map.off("idle", state.update); map.off("moveend", state.update); }
  states.delete(map);
  if (map.getLayer(SOURCE)) map.removeLayer(SOURCE);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
