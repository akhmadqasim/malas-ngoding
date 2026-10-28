import { Popup, type GeoJSONSource, type Map as MapboxMap } from "mapbox-gl";
import type { PemdaHomes } from "../../shared/auth.ts";
import { token } from "../theme.ts";
import { ARCHITECTURE_LAYER, setArchitectureRoofs } from "./architecture.ts";
import { footprintContains } from "./buildings.ts";
import { roofPlacement } from "./footprintLayout.ts";
import { suppressOccupiedBuildingDesign } from "./buildingDesign.ts";

/*
 * The government dashboard's map: homes whose owners agreed to share them, as anonymous dots. Solar yellow
 * for a home that wants rooftop solar, a quiet grey for the rest. Above the columns, so they read at the
 * province view too; they grow with zoom so a street of them stays apart.
 */

const SOURCE = "pemda-homes";
const LAYER = "pemda-homes";
const PV_SOURCE = "pemda-installed-pv";
const PV_MODEL = "rooftop-pv";
const POPUP = "pemda-home-details";
const popups = new WeakMap<MapboxMap, Popup>();
type Footprint = { id?: string | number; geometry: { type: string; coordinates?: unknown }; properties?: Record<string, unknown> | null };
const pvStates = new WeakMap<MapboxMap, { homes: PemdaHomes; update: () => void; signature: string }>();

/** Only persisted, consenting homes marked installed receive a rooftop model. Interest is never enough. */
export function installedSolarPoints(homes: PemdaHomes, footprints: Footprint[] = []) {
  const occupied = new Set<string | number>();
  return { type: "FeatureCollection" as const, features: homes.features.filter(f => f.properties.installed).flatMap(f => {
    const building = footprints.find(b => footprintContains(b.geometry, f.geometry.coordinates));
    // OSM and Mapbox footprints can differ. Keep the database marker, but never float panels over a road.
    if (!building) return [];
    if (building.id != null && occupied.has(building.id)) return [];
    const placement = roofPlacement(building.geometry, 7);
    if (!placement) return [];
    if (building.id != null) occupied.add(building.id);
    const at = placement.at;
    const scale = Math.min(1.6, placement.width / 4.15);
    return [{ ...f, geometry: { ...f.geometry, coordinates: at }, properties: { ...f.properties,
      buildingId: building.id ?? null, rotation: [0, 0, placement.angle],
      translation: [0, 0, Math.max(3, Number(building.properties?.height) || f.properties.heightM || 3) + 0.25], scale: [scale, scale, 1] } }];
  }) };
}

function renderInstalledPanels(map: MapboxMap, data: ReturnType<typeof installedSolarPoints> | null): void {
  suppressOccupiedBuildingDesign(map, data?.features.flatMap(f => f.properties.buildingId == null ? [] : [f.properties.buildingId]) ?? []);
  setArchitectureRoofs(map, "solar", data?.features.flatMap(f => f.properties.buildingId == null ? [] : [{ id: f.properties.buildingId, roof: "flat" as const }]) ?? []);
  if (!data?.features.length) {
    if (map.getLayer(PV_SOURCE)) map.removeLayer(PV_SOURCE);
    if (map.getSource(PV_SOURCE)) map.removeSource(PV_SOURCE);
    return;
  }
  const source = map.getSource(PV_SOURCE) as GeoJSONSource | undefined;
  if (source) { source.setData(data); return; }
  if (!map.hasModel(PV_MODEL)) map.addModel(PV_MODEL, "/models/rooftop-pv.glb");
  map.addSource(PV_SOURCE, { type: "geojson", data });
  map.addLayer({ id: PV_SOURCE, type: "model", source: PV_SOURCE, slot: "middle", minzoom: 16,
    layout: { "model-id": PV_MODEL, "model-allow-density-reduction": false },
    paint: { "model-type": "common-3d", "model-elevation-reference": "ground", "model-cast-shadows": true,
      "model-translation": ["get", "translation"], "model-scale": ["get", "scale"], "model-rotation": ["get", "rotation"] } });
}

function showInstalledPanels(map: MapboxMap, homes: PemdaHomes | null): void {
  let state = pvStates.get(map);
  if (!homes) {
    if (state) { map.off("idle", state.update); map.off("moveend", state.update); }
    pvStates.delete(map);
    renderInstalledPanels(map, null);
    return;
  }
  if (!state) {
    state = { homes, signature: "", update: () => {
      const current = pvStates.get(map);
      if (!current) return;
      const footprints = map.getZoom() >= 16 && map.getLayer(ARCHITECTURE_LAYER)
        ? map.queryRenderedFeatures({ layers: [ARCHITECTURE_LAYER] }) as unknown as Footprint[] : [];
      const data = installedSolarPoints(current.homes, footprints);
      const signature = JSON.stringify(data);
      if (signature === current.signature) return;
      current.signature = signature;
      renderInstalledPanels(map, data);
    } };
    pvStates.set(map, state);
    map.on("idle", state.update);
    map.on("moveend", state.update);
  }
  state.homes = homes;
  state.signature = "";
  state.update();
}

export function showHomes(map: MapboxMap, homes: PemdaHomes | null): void {
  popups.get(map)?.remove();
  popups.delete(map);
  showInstalledPanels(map, homes);
  if (!homes) {
    map.removeInteraction(POPUP);
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    return;
  }
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined;
  if (source) {
    source.setData(homes as never);
    return;
  }
  map.addSource(SOURCE, { type: "geojson", data: homes as never });
  map.addLayer({
    id: LAYER,
    type: "circle",
    source: SOURCE,
    slot: "top",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 5, 16, 8],
      "circle-color": ["case", ["get", "installed"], token("--color-pv-installed"), ["get", "interested"], token("--color-fuel-surya"), token("--color-paper-muted")],
      "circle-stroke-color": token("--color-ink"),
      "circle-stroke-width": 1.2,
      "circle-emissive-strength": 1,
      "circle-pitch-alignment": "map",
    },
  });
  map.addInteraction(POPUP, { type: "click", target: { layerId: LAYER }, handler: e => {
    const feature = e.feature;
    if (!feature || feature.geometry.type !== "Point") return false;
    const p = feature.properties;
    const el = document.createElement("div");
    el.className = "pemda-home-popup";
    const title = document.createElement("strong");
    title.textContent = p.installed ? "PLTS sudah terpasang" : p.interested ? "Berminat memasang PLTS" : "Belum tercatat memasang PLTS";
    const body = document.createElement("p");
    body.textContent = p.installed ? `Kapasitas: ${p.installedKwp == null ? "belum diisi" : `${Number(p.installedKwp).toLocaleString("id-ID")} kWp`}. Laporan pemilik, belum diverifikasi.` : "Status dari rumah yang terdaftar di database.";
    const source = document.createElement("p");
    source.textContent = p.demo ? "DATA DEMO — status dan kapasitas sintetis." : "Data rumah dibagikan atas izin pemilik.";
    el.append(title, body, source);
    const popup = new Popup({ offset: 12, maxWidth: "280px" }).setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(el).addTo(map);
    popups.get(map)?.remove();
    popups.set(map, popup);
    return true;
  } });
}
