import { beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import { actionChips, actionLabel, regionName } from "../../src/web/chat/actionLabels.ts";
import type { MarkedPlace } from "../../src/web/chat/placesLayer.ts";
import { type ActionTarget, BUILDING_ZOOM, runAction } from "../../src/web/map/actions.ts";
import { useAppStore } from "../../src/web/store.ts";
import type { BuildingEstimate } from "../../src/shared/types.ts";

interface Flight {
  center: [number, number];
  zoom: number;
  pitch?: number;
  duration?: number;
}

function fakeMap() {
  const flights: Flight[] = [];
  const moveStart: (() => void)[] = [];
  const map = {
    flyTo: (o: Flight) => flights.push(o),
    isMoving: () => false,
    once: (_type: string, f: () => void) => void moveStart.push(f),
    off: () => {},
    /** MapView starting its region flight. */
    startMoving: () => moveStart.splice(0).forEach((f) => f()),
    getPitch: () => 55,
    getBearing: () => -14,
    cameraForBounds: () => undefined,
  };
  return { map: map as unknown as MapboxMap, flights, startMoving: map.startMoving };
}

const BUILDING = { featureId: "b1", type: "sekolah" } as unknown as BuildingEstimate;

let flights: Flight[];
let startMoving: () => void;
let marked: { places: MarkedPlace[]; pick: (lngLat: [number, number]) => void } | null;
let centroids: string[];
let target: ActionTarget;

beforeEach(() => {
  const fake = fakeMap();
  flights = fake.flights;
  startMoving = fake.startMoving;
  marked = null;
  centroids = [];
  useAppStore.setState({
    map: fake.map,
    selectedRegionId: null,
    selectedBuilding: null,
    metric: "co2",
    layers: { regions: true, plants: true, buildings: true },
    rain: "auto",
    panelTab: "energi",
  });
  // Lane buildings has not landed in this lane: no selectBuildingAt unless a test adds one.
  useAppStore.setState({ selectBuildingAt: undefined } as never);
  target = {
    getState: () => useAppStore.getState(),
    regionCentroid: async (id) => {
      centroids.push(id);
      return [117.15, -0.5];
    },
    showPlaces: (_map, places, pick) => {
      marked = { places, pick };
    },
    reducedMotion: () => false,
  };
});

const state = () => useAppStore.getState();

describe("runAction", () => {
  test("fly_to_region selects the region (MapView flies) and closes the building panel", async () => {
    useAppStore.setState({ selectedBuilding: BUILDING });
    expect(await runAction({ name: "fly_to_region", input: { region: "samarinda" } }, target)).toBe(true);
    expect(state().selectedRegionId).toBe("samarinda");
    expect(state().selectedBuilding).toBeNull();
    expect(flights).toHaveLength(0);
  });

  test("fly_to_region for the region already selected flies there again", async () => {
    useAppStore.setState({ selectedRegionId: "samarinda" });
    expect(await runAction({ name: "fly_to_region", input: { region: "samarinda" } }, target)).toBe(true);
    expect(centroids).toEqual(["samarinda"]);
    expect(flights[0]?.center).toEqual([117.15, -0.5]);
  });

  test("a building picked right after a region waits for the region flight to start, then takes over", async () => {
    await runAction({ name: "fly_to_region", input: { region: "kutai-kartanegara" } }, target);
    let landed = false;
    const picking = runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target).then(() => (landed = true));
    await Bun.sleep(20);
    expect(landed).toBe(false);
    startMoving();
    await picking;
    expect(flights.at(-1)?.center).toEqual([117.1, -0.5]);
  });

  test("show_all_regions goes back to the province with nothing selected", async () => {
    useAppStore.setState({ selectedRegionId: "samarinda", selectedBuilding: BUILDING });
    expect(await runAction({ name: "show_all_regions", input: {} }, target)).toBe(true);
    expect(state().selectedRegionId).toBeNull();
    expect(state().selectedBuilding).toBeNull();
  });

  test("show_all_regions with nothing selected flies back to the overview", async () => {
    expect(await runAction({ name: "show_all_regions", input: {} }, target)).toBe(true);
    expect(flights[0]).toMatchObject({ zoom: 6.55, bearing: -14 });
  });

  test("fly_to flies to the point, tilted at building zoom", async () => {
    expect(await runAction({ name: "fly_to", input: { lng: 117.1, lat: -0.5, zoom: 17 } }, target)).toBe(true);
    expect(flights[0]).toMatchObject({ center: [117.1, -0.5], zoom: 17, pitch: 60, duration: 2000 });
  });

  test("fly_to jumps when the user prefers reduced motion", async () => {
    await runAction({ name: "fly_to", input: { lng: 117.1, lat: -0.5, zoom: 10 } }, { ...target, reducedMotion: () => true });
    expect(flights[0]?.duration).toBe(0);
  });

  test("select_building_at calls lane buildings' selectBuildingAt when it exists", async () => {
    const asked: [number, number][] = [];
    useAppStore.setState({ selectBuildingAt: async (at: [number, number]) => void asked.push(at) } as never);
    expect(await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target)).toBe(true);
    expect(asked).toEqual([[117.151, -0.501]]);
    expect(flights).toHaveLength(0);
  });

  test("select_building_at without lane buildings still flies to the building", async () => {
    expect(await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target)).toBe(true);
    expect(flights[0]).toMatchObject({ center: [117.151, -0.501], zoom: BUILDING_ZOOM, pitch: 60 });
  });

  test("a failing building lookup does not throw into the chat", async () => {
    useAppStore.setState({
      selectBuildingAt: async () => {
        throw new Error("estimate failed");
      },
    } as never);
    expect(await runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target)).toBe(false);
  });

  test("toggle_layer, set_metric, set_rain and open_tab go to the store", async () => {
    await runAction({ name: "toggle_layer", input: { layer: "plants", visible: false } }, target);
    await runAction({ name: "set_metric", input: { metric: "kwh" } }, target);
    await runAction({ name: "set_rain", input: { mode: "on" } }, target);
    await runAction({ name: "open_tab", input: { tab: "surya" } }, target);
    expect(state().layers.plants).toBe(false);
    expect(state().metric).toBe("kwh");
    expect(state().rain).toBe("on");
    expect(state().panelTab).toBe("surya");
  });

  test("mark_places marks the places, and picking one selects the building there", async () => {
    const places = [
      { name: "SMA Negeri 1", lng: 117.151, lat: -0.501 },
      { name: "SD Negeri 2", lng: 117.16, lat: -0.49 },
    ];
    expect(await runAction({ name: "mark_places", input: { label: "sekolah", places } }, target)).toBe(true);
    expect(marked?.places).toEqual(places);
    marked?.pick([117.16, -0.49]);
    expect(flights[0]).toMatchObject({ center: [117.16, -0.49], zoom: BUILDING_ZOOM });
  });

  test.each([
    [{ name: "fly_to", input: { lng: "x", lat: 0, zoom: 3 } }],
    [{ name: "fly_to_region", input: {} }],
    [{ name: "toggle_layer", input: { layer: "roads", visible: true } }],
    [{ name: "set_metric", input: { metric: "money" } }],
    [{ name: "mark_places", input: { places: [{ name: 3 }] } }],
    [{ name: "launch_rocket", input: {} }],
  ])("an unusable action %j does nothing", async (action) => {
    const before = { ...state() };
    expect(await runAction(action as never, target)).toBe(false);
    expect(flights).toHaveLength(0);
    expect(state().metric).toBe(before.metric);
    expect(state().layers).toEqual(before.layers);
  });

  test("without a map, camera actions report that nothing happened", async () => {
    useAppStore.setState({ map: null });
    expect(await runAction({ name: "fly_to", input: { lng: 117, lat: 0, zoom: 9 } }, target)).toBe(false);
  });
});

describe("action labels", () => {
  test("region ids read as names", () => {
    expect(regionName("kutai-kartanegara")).toBe("Kutai Kartanegara");
    expect(regionName("samarinda")).toBe("Samarinda");
  });

  test("each action has a short Indonesian label", () => {
    expect(actionLabel({ name: "fly_to_region", input: { region: "penajam-paser-utara" } })).toBe("Penajam Paser Utara");
    expect(actionLabel({ name: "toggle_layer", input: { layer: "plants", visible: false } })).toBe("Pembangkit disembunyikan");
    expect(actionLabel({ name: "set_metric", input: { metric: "kwh" } })).toBe("Warna menurut listrik");
    expect(actionLabel({ name: "set_rain", input: { mode: "on" } })).toBe("Hujan nyala");
    expect(actionLabel({ name: "open_tab", input: { tab: "surya" } })).toBe("Tab Surya");
    expect(actionLabel({ name: "mark_places", input: { label: "sekolah", places: [{}, {}, {}] } })).toBe("3 sekolah ditandai");
    expect(actionLabel({ name: "select_building_at", input: { lng: 1, lat: 1 } })).toBe("Gedung dipilih");
  });

  test("one button per label, in first order, replaying the latest action", () => {
    const chips = actionChips([
      { name: "fly_to_region", input: { region: "samarinda" } },
      { name: "set_metric", input: { metric: "co2" } },
      { name: "select_building_at", input: { lng: 1, lat: 1 } },
      { name: "select_building_at", input: { lng: 2, lat: 2 } },
    ]);
    expect(chips.map((c) => c.label)).toEqual(["Samarinda", "Warna menurut emisi CO2", "Gedung dipilih"]);
    expect(chips[2]?.action.input).toEqual({ lng: 2, lat: 2 });
  });
});
