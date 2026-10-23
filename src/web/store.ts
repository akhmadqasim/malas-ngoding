import type { Map as MapboxMap } from "mapbox-gl";
import { create } from "zustand";
import { type LightMode, type LightPreset, lightModeFromQuery, resolvePreset } from "./map/effects.ts";
import type { BuildingEstimate, BuildingInput, BuildingType } from "../shared/types.ts";
import { api, type PotentialCollection } from "./api.ts";
import type { StoryTrack } from "./story/steps.ts";
import type { Home, PemdaHomes, User } from "../shared/auth.ts";
import { buildingViewPadding, PLACE_SEARCH_RADIUS_PX, selectBuildingAt as pickBuildingOnMap } from "./map/buildings.ts";

export type Metric = "co2" | "kwh";
export type LayerKey = "regions" | "plants" | "buildings";
export type RainMode = "auto" | "on" | "off";
export type PanelTab = "energi" | "emisi" | "surya" | "cuaca" | "sensor";
/** What the renewable potential map shows: solar irradiance or wind speed. */
export type PotentialKind = "sun" | "wind";
/** A simulated farm: PLTS of `size` MWp or `size` wind turbines, at a spot of a potential cell. */
export interface BuildSite {
  wind?: { speedMs: number; fromDeg: number; time: string; stale: boolean };
  kind: PotentialKind;
  at: [number, number];
  cellId: number;
  size: number;
  /** How far the site check moved the farm from the spot asked for, km (0 when that spot was clear). */
  movedKm: number;
}
/**
 * Where the building panel is: closed, waiting for the first estimate, showing one, failed, or "empty"
 * when a select-building request found no building at the point.
 */
export type BuildingStatus = "idle" | "loading" | "ready" | "error" | "empty";
/** What the user changed in the building panel: the type and the number of floors. */
export type BuildingOverride = { typeOverride?: BuildingType; floorsOverride?: number };
/**
 * What a place search knows about the building it points at (the chat's find_places): its type, used when
 * no POI sits at the building itself, and its name, shown in the panel.
 */
export type BuildingHint = { type?: BuildingType; name?: string };

/** Where a hover preview comes from: the pointer over a column on the map, or a row of the region list. */
export type HoverOrigin = "map" | "list";
/** Live weather at the view centre (map/autoRain.ts): whether it rains there now, and where it was checked. */
export interface LiveRain {
  raining: boolean;
  at: [number, number];
}
/** The rooftop solar size simulated for a building (SolarTab), so the Cuaca tab forecasts the same panels. */
export interface SolarSizing {
  featureId: string;
  kWp: number;
}

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
  /** The place name a select-building request came with (BuildingHint), shown as the panel's title. */
  buildingName: string | null;
  metric: Metric;
  layers: Record<LayerKey, boolean>;
  rain: RainMode;
  /** The presenter's light choice (Cahaya: Otomatis, Siang, Malam), or a `?cahaya=` pin. */
  lightMode: LightMode;
  /** The light preset the map shows now; MapView keeps it in step with `lightMode` and the clock. */
  lightPreset: LightPreset;
  panelTab: PanelTab;
  chatOpen: boolean;
  /** Rain at the view centre at city zoom, or null when unknown (farther out, or the forecast failed). */
  liveRain: LiveRain | null;
  solarSizing: SolarSizing | null;
  /** The province rooftop solar scenario card is open. */
  scenarioOpen: boolean;
  /** The share of each region's electricity from rooftop PV in the scenario, 0..SCENARIO_MAX_SHARE. */
  scenarioShare: number;
  /**
   * Per region, the factor its CO2 column is scaled by: the share of CO2 left under the open scenario, or the
   * CO2 at the twin's hour against an average hour. Null when neither is open.
   */
  scenarioScale: ReadonlyMap<string, number> | null;
  /** The digital twin's day (hour by hour, from the live forecast) is open in the sheet. */
  twinOpen: boolean;
  /** The WITA hour the twin shows ("2026-10-22T14:00"); the map's light follows it. Null when closed. */
  twinTime: string | null;
  /** The renewable potential map is open: grid cells replace the region columns. */
  potentialOpen: boolean;
  potentialKind: PotentialKind;
  /** The grid cell picked on the map or in the list, or null. */
  potentialCellId: number | null;
  /** The grid cells (fetched by the potential view) and where each sits on the shown scale (0..1). */
  potentialCells: PotentialCollection | null;
  potentialScale: ReadonlyMap<number, number> | null;
  /** Where the user last clicked a cell on the map ([lng, lat]), the spot a farm would be built. */
  potentialClickAt: [number, number] | null;
  /** The simulated farm of "Bangun di sini", drawn in 3D, or null. */
  buildSite: BuildSite | null;
  /**
   * The guided story: open with no track while the visitor chooses one, then the track and its step.
   * Null when closed.
   */
  story: { track: StoryTrack | null; step: number } | null;
  /** The signed-in account, or null for a guest; `authChecked` turns true once /api/auth/me has answered. */
  user: User | null;
  authChecked: boolean;
  /** The sign-in dialog is open. */
  loginOpen: boolean;
  /** The signed-in resident's home, or null when none is marked yet (or for other accounts). */
  home: Home | null;
  /** The resident's "Rumah saya" view or the government's dashboard is open in the sheet. */
  homeOpen: boolean;
  homeGoal: "benefit" | "monitor" | null;
  pemdaOpen: boolean;
  pemdaGoal: "priority" | "adoption" | "reports";
  setPemdaGoal: (value: "priority" | "adoption" | "reports") => void;
  /** Government: the consenting homes shown as points on the map, or null when hidden. */
  pemdaHomes: PemdaHomes | null;
  /** A question handed to the chat box (it takes it and clears this), or null. */
  chatDraft: string | null;
  /** The landing page is up ("open") until the visitor picks where to start; the intro flight waits for it. */
  landing: "open" | "done";
  /** A place picked on the landing page: the camera goes there once the intro has landed. */
  pendingPlace: { at: [number, number]; label: string } | null;
  /** A searched place with no building at its point: the hint asks to click the roof nearby. */
  placeHint: string | null;

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
  /** Opens the panel for a clicked building and fetches its estimate. Clicking the open one again does nothing. */
  openBuilding: (input: BuildingInput) => Promise<void>;
  /** Re-estimates the selected building with the user's type or floors. */
  overrideBuilding: (override: BuildingOverride) => Promise<void>;
  /** Asks for the estimate again after a failure. */
  retryBuilding: () => Promise<void>;
  closeBuilding: () => void;
  /**
   * Selects the building at a point as a click would (the chat's "select building" action): flies the
   * camera there, opens the panel and fetches the estimate. With no building at the point the panel says
   * so (status "empty"). A `hint` from a place search gives the type when no POI sits at the building and
   * names the place in the panel. A newer click, select or close during the flight wins; so does a camera
   * move by the user (a gesture on the map, a region selection, a map tool), which closes the panel.
   */
  selectBuildingAt: (lngLat: [number, number], hint?: BuildingHint) => Promise<void>;
  setMetric: (metric: Metric) => void;
  setLayer: (layer: LayerKey, visible: boolean) => void;
  setRain: (mode: RainMode) => void;
  setLightMode: (mode: LightMode) => void;
  setLightPreset: (preset: LightPreset) => void;
  setPanelTab: (tab: PanelTab) => void;
  setChatOpen: (open: boolean) => void;
  setLiveRain: (live: LiveRain | null) => void;
  setSolarSizing: (sizing: SolarSizing | null) => void;
  /** Opens the scenario card (the columns show CO2, which the scenario changes) or closes it (the columns rise back). */
  setScenarioOpen: (open: boolean) => void;
  setScenarioShare: (share: number) => void;
  setScenarioScale: (scale: ReadonlyMap<string, number> | null) => void;
  /** Opens the twin (the columns show CO2, the scenario closes) or closes it (columns and light come back). */
  setTwinOpen: (open: boolean) => void;
  setTwinTime: (time: string | null) => void;
  /** Opens the potential map (the scenario and the twin close) or closes it (the columns come back). */
  setPotentialOpen: (open: boolean) => void;
  setPotentialKind: (kind: PotentialKind) => void;
  setPotentialCell: (id: number | null) => void;
  setPotentialData: (cells: PotentialCollection, scale: ReadonlyMap<number, number>) => void;
  /** Picks a cell from a map click, keeping the spot clicked. */
  pickPotentialAt: (id: number, at: [number, number]) => void;
  setBuildSite: (site: BuildSite | null) => void;
  setStory: (story: { track: StoryTrack | null; step: number } | null) => void;
  setUser: (user: User | null) => void;
  setLoginOpen: (open: boolean) => void;
  setHome: (home: Home | null) => void;
  /** Opens "Rumah saya" (the province views close) or closes it. */
  setHomeOpen: (open: boolean) => void;
  setHomeGoal: (goal: "benefit" | "monitor" | null) => void;
  /** Opens the government dashboard (the province views close) or closes it (its points go too). */
  setPemdaOpen: (open: boolean) => void;
  setPemdaHomes: (homes: PemdaHomes | null) => void;
  setChatDraft: (text: string | null) => void;
  /** Leaves the landing page, with a place to go to (a searched address or the device location) or none. */
  finishLanding: (place?: { at: [number, number]; label: string } | null) => void;
  setPendingPlace: (place: { at: [number, number]; label: string } | null) => void;
  setPlaceHint: (label: string | null) => void;
}

/** The light a `?cahaya=` link asked for ("auto" without one). The Cahaya switch's Otomatis returns to it. */
export const linkedLightMode: LightMode = typeof window === "undefined" ? "auto" : lightModeFromQuery(window.location.search);

/** The session key that remembers the landing page was passed, so a reload in the same tab skips it. */
export const LANDING_SEEN_KEY = "malas:landing-seen";

/** Open, unless this tab passed it already or the link asks to go straight to the map (`?langsung`). */
function initialLanding(): "open" | "done" {
  if (typeof window === "undefined") return "done";
  if (new URLSearchParams(window.location.search).has("langsung")) return "done";
  try {
    return sessionStorage.getItem(LANDING_SEEN_KEY) ? "done" : "open";
  } catch {
    return "open";
  }
}

/** Resolves once the landing page is done (at once when it already is). */
export function landingDone(): Promise<void> {
  if (useAppStore.getState().landing === "done") return Promise.resolve();
  return new Promise((resolve) => {
    const off = useAppStore.subscribe((s) => {
      if (s.landing === "done") {
        off();
        resolve();
      }
    });
  });
}

/** Only the newest building request may update the panel; an older one that answers late is dropped. */
let buildingRequest = 0;
/**
 * Counts region selections and map tool moves. A chat building pick that sees it change during its flight
 * gives up: the presenter (or a newer answer) has sent the camera elsewhere.
 */
let cameraClaims = 0;

/** The user moved the camera with a map tool: a chat building pick in flight gives up. */
export function claimCamera(): void {
  cameraClaims++;
}

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
  buildingName: null,
  metric: "co2",
  layers: { regions: true, plants: true, buildings: true },
  rain: "auto",
  lightMode: linkedLightMode,
  lightPreset: resolvePreset(linkedLightMode, new Date()),
  panelTab: "energi",
  chatOpen: false,
  liveRain: null,
  solarSizing: null,
  scenarioOpen: false,
  scenarioShare: 0.2,
  scenarioScale: null,
  twinOpen: false,
  twinTime: null,
  potentialOpen: false,
  potentialKind: "sun",
  potentialCellId: null,
  potentialCells: null,
  potentialScale: null,
  potentialClickAt: null,
  buildSite: null,
  story: null,
  user: null,
  authChecked: false,
  loginOpen: false,
  home: null,
  homeOpen: false,
  homeGoal: null,
  pemdaOpen: false,
  pemdaGoal: "priority",
  setPemdaGoal: pemdaGoal => set({pemdaGoal}),
  pemdaHomes: null,
  chatDraft: null,
  landing: initialLanding(),
  pendingPlace: null,
  placeHint: null,

  setMap: (map) => set({ map }),
  selectRegion: (selectedRegionId) => {
    cameraClaims++;
    set({ selectedRegionId, hoveredRegionId: null, hoverOrigin: null });
  },
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
  openBuilding: async (input) => {
    const { buildingInput, buildingStatus } = get();
    // The building already open: keep its numbers and the user's changes instead of loading it again.
    if (buildingInput?.featureId === input.featureId && (buildingStatus === "ready" || buildingStatus === "loading")) return;
    // A clicked roof answers the "click your roof" hint.
    set({ buildingName: null, placeHint: null });
    await estimate(input, false);
  },
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
      buildingName: null,
    });
  },
  selectBuildingAt: async ([lng, lat], hint) => {
    const run = ++buildingRequest;
    set({
      selectedBuilding: null,
      selectedBuildingAt: [lng, lat],
      buildingInput: null,
      buildingStatus: "loading",
      buildingUpdating: false,
      buildingError: null,
      buildingName: hint?.name?.trim() || null,
    });
    const map = get().map;
    const claims = cameraClaims;
    let userMoved = false;
    // A drag, wheel or key on the map, a region click or a map tool during the flight: the presenter has the
    // camera now, so the pick gives up and the panel closes instead of flying back to the building.
    const tookOver = () => userMoved || claims !== cameraClaims;
    const stale = () => run !== buildingRequest || tookOver();
    // A named place from a search may point at its yard or the street: look a little further around it.
    const searchRadiusPx = hint ? PLACE_SEARCH_RADIUS_PX : undefined;
    const input = map
      ? await pickBuildingOnMap(map, lng, lat, {
          padding: buildingViewPadding(),
          isStale: stale,
          searchRadiusPx,
          onUserMove: () => (userMoved = true),
        })
      : null;
    if (run !== buildingRequest) return;
    if (tookOver()) {
      get().closeBuilding();
      return;
    }
    if (!input) {
      set({ buildingStatus: "empty", buildingError: map ? NO_BUILDING : NO_MAP });
      return;
    }
    await estimate(hint?.type ? { ...input, typeHint: hint.type } : input, false);
  },
  setMetric: (metric) => set({ metric }),
  setLayer: (layer, visible) => set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
  setRain: (rain) => set({ rain }),
  setLightMode: (lightMode) => set({ lightMode }),
  setLightPreset: (lightPreset) => set({ lightPreset }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setLiveRain: (liveRain) => set({ liveRain }),
  setSolarSizing: (solarSizing) => set({ solarSizing }),
  setScenarioOpen: (scenarioOpen) =>
    set(
      scenarioOpen
        ? { scenarioOpen, twinOpen: false, twinTime: null, potentialOpen: false, homeOpen: false, pemdaOpen: false, metric: "co2" }
        : { scenarioOpen, scenarioScale: null },
    ),
  setTwinOpen: (twinOpen) =>
    set(twinOpen ? { twinOpen, scenarioOpen: false, potentialOpen: false, homeOpen: false, pemdaOpen: false, metric: "co2" } : { twinOpen, twinTime: null, scenarioScale: null }),
  setPotentialOpen: (potentialOpen) =>
    set(
      potentialOpen
        ? { potentialOpen, scenarioOpen: false, twinOpen: false, twinTime: null, scenarioScale: null, homeOpen: false, pemdaOpen: false }
        : { potentialOpen, potentialCellId: null, potentialClickAt: null, buildSite: null },
    ),
  setPotentialKind: (potentialKind) => set({ potentialKind, buildSite: null }),
  setPotentialCell: (potentialCellId) => set({ potentialCellId, potentialClickAt: null, buildSite: null }),
  setPotentialData: (potentialCells, potentialScale) => set({ potentialCells, potentialScale }),
  pickPotentialAt: (potentialCellId, potentialClickAt) => set({ potentialCellId, potentialClickAt, buildSite: null }),
  setBuildSite: (buildSite) => set({ buildSite }),
  setStory: (story) => set({ story }),
  // Signing out (or in as someone else) drops what belonged to the last account.
  setUser: (user) =>
    set((s) => (user?.id === s.user?.id ? { user, authChecked: true } : { user, authChecked: true, home: null, homeOpen: false, homeGoal: null, pemdaGoal: "priority", pemdaOpen: false, pemdaHomes: null })),
  setLoginOpen: (loginOpen) => set({ loginOpen }),
  setHome: (home) => set({ home }),
  setHomeGoal: (homeGoal) => set({ homeGoal }),
  setHomeOpen: (homeOpen) =>
    set(homeOpen ? { homeOpen, pemdaOpen: false, scenarioOpen: false, twinOpen: false, twinTime: null, potentialOpen: false, scenarioScale: null } : { homeOpen }),
  setPemdaOpen: (pemdaOpen) =>
    set(
      pemdaOpen
        ? { pemdaOpen, homeOpen: false, scenarioOpen: false, twinOpen: false, twinTime: null, potentialOpen: false, scenarioScale: null }
        : { pemdaOpen, pemdaHomes: null },
    ),
  setPemdaHomes: (pemdaHomes) => set({ pemdaHomes }),
  setChatDraft: (chatDraft) => set({ chatDraft }),
  finishLanding: (place = null) => {
    try {
      sessionStorage.setItem(LANDING_SEEN_KEY, "1");
    } catch {
      // Private mode or blocked storage: the landing shows again next time, which is fine.
    }
    set({ landing: "done", pendingPlace: place });
  },
  setPendingPlace: (pendingPlace) => set({ pendingPlace }),
  setPlaceHint: (placeHint) => set({ placeHint }),
  setTwinTime: (twinTime) => set({ twinTime }),
  setScenarioShare: (scenarioShare) => set({ scenarioShare }),
  setScenarioScale: (scenarioScale) => set({ scenarioScale }),
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
