import type { Map as MapboxMap } from "mapbox-gl";
import { create } from "zustand";
import { type LightMode, type LightPreset, lightModeFromQuery, resolvePreset } from "./map/effects.ts";
import type { BuildingEstimate, BuildingInput, BuildingType } from "../shared/types.ts";
import { api } from "./api.ts";
import { buildingViewPadding, selectBuildingAt as pickBuildingOnMap } from "./map/buildings.ts";

export type Metric = "co2" | "kwh";
export type LayerKey = "regions" | "plants" | "buildings";
export type RainMode = "auto" | "on" | "off";
export type PanelTab = "energi" | "emisi" | "surya" | "cuaca";
/**
 * Where the building panel is: closed, waiting for the first estimate, showing one, failed, or "empty"
 * when a select-building request found no building at the point.
 */
export type BuildingStatus = "idle" | "loading" | "ready" | "error" | "empty";
/** What the user changed in the building panel: the type and the number of floors. */
export type BuildingOverride = { typeOverride?: BuildingType; floorsOverride?: number };

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
  /** Where the selected building is, [lng, lat] (its centre). Solar, weather and the chat use it. */
  selectedBuildingAt: [number, number] | null;
  /** The estimate request of the selected building, with the user's overrides. */
  buildingInput: BuildingInput | null;
  buildingStatus: BuildingStatus;
  /** An estimate with the user's new type or floors is on its way; the panel keeps the last numbers meanwhile. */
  buildingUpdating: boolean;
  /** The Indonesian message for the "error" and "empty" states. */
  buildingError: string | null;
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
  /** Sets the selected building and where it is; `null` clears both. */
  setSelectedBuilding: (building: BuildingEstimate | null, at?: [number, number] | null) => void;
  /** Opens the panel for a clicked building and fetches its estimate. */
  openBuilding: (input: BuildingInput) => Promise<void>;
  /** Re-estimates the selected building with the user's type or floors. */
  overrideBuilding: (override: BuildingOverride) => Promise<void>;
  /** Asks for the estimate again after a failure. */
  retryBuilding: () => Promise<void>;
  closeBuilding: () => void;
  /**
   * Selects the building at a point as a click would (the chat's "select building" action): flies the
   * camera there, opens the panel and fetches the estimate. With no building at the point the panel says
   * so (status "empty").
   */
  selectBuildingAt: (lngLat: [number, number]) => Promise<void>;
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

/** Only the newest building request may update the panel; an older one that answers late is dropped. */
let buildingRequest = 0;

const NO_BUILDING = "Tidak ada gedung di titik itu. Coba perbesar peta lalu klik gedungnya langsung.";
const NO_MAP = "Peta belum siap. Tunggu sebentar lalu coba lagi.";

export const useAppStore = create<AppState>()((set, get) => ({
  map: null,
  selectedRegionId: null,
  hoveredRegionId: null,
  hoverOrigin: null,
  selectedBuilding: null,
  selectedBuildingAt: null,
  buildingInput: null,
  buildingStatus: "idle",
  buildingUpdating: false,
  buildingError: null,
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
  setSelectedBuilding: (selectedBuilding, at) =>
    set((s) => ({
      selectedBuilding,
      selectedBuildingAt: selectedBuilding === null ? null : at === undefined ? s.selectedBuildingAt : at,
    })),
  openBuilding: (input) => estimate(input, false),
  overrideBuilding: async (override) => {
    const { buildingInput, selectedBuilding } = get();
    if (!buildingInput) return;
    const next = { ...buildingInput, ...override };
    // A new type gets that type's usual floors, unless the user set the floors too.
    if (override.typeOverride !== undefined && override.floorsOverride === undefined) delete next.floorsOverride;
    await estimate(next, selectedBuilding !== null);
  },
  retryBuilding: async () => {
    const { buildingInput } = get();
    if (buildingInput) await estimate(buildingInput, false);
  },
  closeBuilding: () => {
    buildingRequest++;
    set({
      selectedBuilding: null,
      selectedBuildingAt: null,
      buildingInput: null,
      buildingStatus: "idle",
      buildingUpdating: false,
      buildingError: null,
    });
  },
  selectBuildingAt: async ([lng, lat]) => {
    const run = ++buildingRequest;
    set({
      selectedBuilding: null,
      selectedBuildingAt: [lng, lat],
      buildingInput: null,
      buildingStatus: "loading",
      buildingUpdating: false,
      buildingError: null,
    });
    const map = get().map;
    // The map reports the building it finds through openBuilding (enableBuildingInteraction's onSelect).
    const found = map ? await pickBuildingOnMap(map, lng, lat, buildingViewPadding()) : false;
    if (found || run !== buildingRequest) return;
    set({ buildingStatus: "empty", buildingError: map ? NO_BUILDING : NO_MAP });
  },
  setMetric: (metric) => set({ metric }),
  setLayer: (layer, visible) => set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
  setRain: (rain) => set({ rain }),
  setLightMode: (lightMode) => set({ lightMode }),
  setLightPreset: (lightPreset) => set({ lightPreset }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
}));

/** Fetches the estimate for `input`; `keep` leaves the shown numbers up while it loads (an override). */
async function estimate(input: BuildingInput, keep: boolean): Promise<void> {
  const run = ++buildingRequest;
  useAppStore.setState(
    keep
      ? { buildingInput: input, buildingUpdating: true, buildingError: null }
      : {
          buildingInput: input,
          selectedBuildingAt: [input.lng, input.lat],
          selectedBuilding: null,
          buildingStatus: "loading",
          buildingUpdating: false,
          buildingError: null,
        },
  );
  try {
    const building = await api.estimateBuilding(input);
    if (run !== buildingRequest) return;
    useAppStore.setState({ selectedBuilding: building, buildingStatus: "ready", buildingUpdating: false });
  } catch (err) {
    if (run !== buildingRequest) return;
    useAppStore.setState({
      buildingStatus: "error",
      buildingUpdating: false,
      buildingError: err instanceof Error ? err.message : "Perkiraan gedung gagal dimuat.",
    });
  }
}
