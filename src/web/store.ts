import type { Map as MapboxMap } from "mapbox-gl";
import { create } from "zustand";
import { type LightMode, type LightPreset, lightModeFromQuery, resolvePreset } from "./map/effects.ts";
import type { BuildingEstimate } from "../shared/types.ts";

export type Metric = "co2" | "kwh";
export type LayerKey = "regions" | "plants" | "buildings";
export type RainMode = "auto" | "on" | "off";
export type PanelTab = "energi" | "emisi" | "surya" | "cuaca";
/** Where a hover preview comes from: the pointer over a column on the map, or a row of the region list. */
export type HoverOrigin = "map" | "list";

export interface AppState {
  map: MapboxMap | null;
  selectedRegionId: string | null;
  /** The region under the pointer, on the map or in the region list. Drives the column lift and the legend needle. */
  hoveredRegionId: string | null;
  /** Who set `hoveredRegionId`. Only a map hover shows the tooltip at the pointer. */
  hoverOrigin: HoverOrigin | null;
  selectedBuilding: BuildingEstimate | null;
  metric: Metric;
  layers: Record<LayerKey, boolean>;
  rain: RainMode;
  /** The presenter's light choice (Cahaya: Otomatis, Siang, Malam), or a `?cahaya=` pin. */
  lightMode: LightMode;
  /** The light preset the map shows now; MapView keeps it in step with `lightMode` and the clock. */
  lightPreset: LightPreset;
  panelTab: PanelTab;
  chatOpen: boolean;

  setMap: (map: MapboxMap | null) => void;
  /** Selects a region (or goes back to all with `null`). Either way the hover preview has done its job and ends. */
  selectRegion: (id: string | null) => void;
  setHoveredRegion: {
    (id: string, origin: HoverOrigin): void;
    (id: null): void;
  };
  /**
   * Ends the list's hover preview (of row `id`, when given). A row or the map that took the hover over
   * meanwhile keeps it.
   */
  endListHover: (id?: string) => void;
  setSelectedBuilding: (building: BuildingEstimate | null) => void;
  setMetric: (metric: Metric) => void;
  setLayer: (layer: LayerKey, visible: boolean) => void;
  setRain: (mode: RainMode) => void;
  setLightMode: (mode: LightMode) => void;
  setLightPreset: (preset: LightPreset) => void;
  setPanelTab: (tab: PanelTab) => void;
  setChatOpen: (open: boolean) => void;
}

/** The light a `?cahaya=` link asked for ("auto" without one). The Cahaya switch's Otomatis returns to it. */
export const linkedLightMode: LightMode = typeof window === "undefined" ? "auto" : lightModeFromQuery(window.location.search);

export const useAppStore = create<AppState>()((set) => ({
  map: null,
  selectedRegionId: null,
  hoveredRegionId: null,
  hoverOrigin: null,
  selectedBuilding: null,
  metric: "co2",
  layers: { regions: true, plants: true, buildings: true },
  rain: "auto",
  lightMode: linkedLightMode,
  lightPreset: resolvePreset(linkedLightMode, new Date()),
  panelTab: "energi",
  chatOpen: false,

  setMap: (map) => set({ map }),
  selectRegion: (selectedRegionId) => set({ selectedRegionId, hoveredRegionId: null, hoverOrigin: null }),
  setHoveredRegion: (hoveredRegionId: string | null, origin?: HoverOrigin) =>
    set({ hoveredRegionId, hoverOrigin: hoveredRegionId === null ? null : (origin ?? null) }),
  endListHover: (id) =>
    set((s) =>
      s.hoverOrigin === "list" && (id === undefined || s.hoveredRegionId === id) ? { hoveredRegionId: null, hoverOrigin: null } : s,
    ),
  setSelectedBuilding: (selectedBuilding) => set({ selectedBuilding }),
  setMetric: (metric) => set({ metric }),
  setLayer: (layer, visible) => set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
  setRain: (rain) => set({ rain }),
  setLightMode: (lightMode) => set({ lightMode }),
  setLightPreset: (lightPreset) => set({ lightPreset }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
}));
