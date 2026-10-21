import type { Map as MapboxMap } from "mapbox-gl";
import { create } from "zustand";
import type { BuildingEstimate } from "../shared/types.ts";

export type Metric = "co2" | "kwh";
export type LayerKey = "regions" | "plants" | "buildings";
export type RainMode = "auto" | "on" | "off";
export type PanelTab = "energi" | "emisi" | "surya" | "cuaca";

export interface AppState {
  map: MapboxMap | null;
  selectedRegionId: string | null;
  /** The region under the pointer, on the map or in the region list. Drives the column lift and the legend needle. */
  hoveredRegionId: string | null;
  selectedBuilding: BuildingEstimate | null;
  metric: Metric;
  layers: Record<LayerKey, boolean>;
  rain: RainMode;
  panelTab: PanelTab;
  chatOpen: boolean;

  setMap: (map: MapboxMap | null) => void;
  selectRegion: (id: string | null) => void;
  setHoveredRegion: (id: string | null) => void;
  setSelectedBuilding: (building: BuildingEstimate | null) => void;
  setMetric: (metric: Metric) => void;
  setLayer: (layer: LayerKey, visible: boolean) => void;
  setRain: (mode: RainMode) => void;
  setPanelTab: (tab: PanelTab) => void;
  setChatOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  map: null,
  selectedRegionId: null,
  hoveredRegionId: null,
  selectedBuilding: null,
  metric: "co2",
  layers: { regions: true, plants: true, buildings: true },
  rain: "auto",
  panelTab: "energi",
  chatOpen: false,

  setMap: (map) => set({ map }),
  selectRegion: (selectedRegionId) => set({ selectedRegionId }),
  setHoveredRegion: (hoveredRegionId) => set({ hoveredRegionId }),
  setSelectedBuilding: (selectedBuilding) => set({ selectedBuilding }),
  setMetric: (metric) => set({ metric }),
  setLayer: (layer, visible) => set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
  setRain: (rain) => set({ rain }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
}));
