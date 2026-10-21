import { beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import { actionChips, actionLabel, regionName } from "../../src/web/chat/actionLabels.ts";
import type { MarkedPlace } from "../../src/web/chat/placesLayer.ts";
import { type ActionTarget, actionQueue, fitMarkedPlaces, needsPlacesFit, runAction } from "../../src/web/map/actions.ts";
import { flyToRegion } from "../../src/web/map/camera.ts";
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
    on: (type: string, f: () => void) => void (type === "movestart" && moveStart.push(f)),
    once: (type: string, f: () => void) => void (type === "movestart" && moveStart.push(f)),
    off: () => {},
    /** A camera move that is not a region flight: the idle sway turning the bearing one frame. */
    swayFrame: () => moveStart.splice(0).forEach((f) => f()),
    getPitch: () => 55,
    getBearing: () => -14,
    getZoom: () => 6.55,
    // A building drawn at x 900 of a 1366 x 768 canvas.
    project: () => ({ x: 900, y: 300 }),
    getCanvas: () => ({ clientWidth: 1366, clientHeight: 768 }),
    easeTo: (o: Flight) => flights.push(o),
    cameraForBounds: () => undefined,
  };
  return { map: map as unknown as MapboxMap, flights, swayFrame: map.swayFrame };
}

const BUILDING = { featureId: "b1", type: "sekolah" } as unknown as BuildingEstimate;

let flights: Flight[];
let picked: [number, number][];
/** MapView starting its region flight (on the map in the store now). */
const startMoving = () => flyToRegion(useAppStore.getState().map!, [117.15, -0.5]);
let swayFrame: () => void;
let marked: { places: MarkedPlace[]; pick: (lngLat: [number, number]) => void } | null;
let centroids: string[];
let target: ActionTarget;

beforeEach(() => {
  const fake = fakeMap();
  flights = fake.flights;
  swayFrame = fake.swayFrame;
  marked = null;
  centroids = [];
  useAppStore.setState({
    map: fake.map,
    selectedRegionId: null,
    selectedBuilding: null,
    selectedBuildingAt: null,
    buildingStatus: "idle",
    metric: "co2",
    layers: { regions: true, plants: true, buildings: true },
    rain: "auto",
    panelTab: "energi",
  });
  picked = [];
  // The building lookup itself is lane buildings' (tests/web/buildingStore.test.ts); here it only records.
  useAppStore.setState({
    selectBuildingAt: async (at: [number, number]) => {
      picked.push(at);
      useAppStore.setState({ buildingStatus: "loading" });
    },
  });
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
    viewPadding: () => undefined,
    tabShown: async () => true,
  };
});

const state = () => useAppStore.getState();

describe("runAction", () => {
  test("fly_to_region selects the region (MapView flies) and closes the building panel", async () => {
    useAppStore.setState({ selectedBuilding: BUILDING, selectedBuildingAt: [117.1, -0.5], buildingStatus: "ready" });
    expect(await runAction({ name: "fly_to_region", input: { region: "samarinda" } }, target)).toBe("ok");
    expect(state().selectedRegionId).toBe("samarinda");
    expect(state().selectedBuilding).toBeNull();
    expect(state().buildingStatus).toBe("idle");
    expect(flights).toHaveLength(0);
  });

  test("fly_to_region for the region already selected flies there again", async () => {
    useAppStore.setState({ selectedRegionId: "samarinda" });
    expect(await runAction({ name: "fly_to_region", input: { region: "samarinda" } }, target)).toBe("ok");
    expect(centroids).toEqual(["samarinda"]);
    expect(flights[0]?.center).toEqual([117.15, -0.5]);
  });

  test("a building picked right after a region waits for the region flight to start, then takes over", async () => {
    await runAction({ name: "fly_to_region", input: { region: "kutai-kartanegara" } }, target);
    let landed = false;
    const picking = runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target).then(() => (landed = true));
    await Bun.sleep(20);
    expect(landed).toBe(false);
    expect(picked).toEqual([]);
    startMoving();
    await picking;
    expect(picked).toEqual([[117.1, -0.5]]);
  });

  test("an idle sway frame during that wait does not count as the region flight", async () => {
    await runAction({ name: "fly_to_region", input: { region: "kutai-kartanegara" } }, target);
    const picking = runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target);
    await Bun.sleep(10);
    swayFrame();
    await Bun.sleep(10);
    expect(picked).toEqual([]);
    startMoving();
    await picking;
    expect(picked).toEqual([[117.1, -0.5]]);
  });

  test("with the region already open, a building picked right after re-flying there takes the camera over", async () => {
    // The review's repro: Samarinda open, then "Tunjukkan gedung sekolah di Samarinda".
    useAppStore.setState({ selectedRegionId: "samarinda" });
    let release: () => void = () => {};
    const slowCentroid = new Promise<[number, number]>((r) => (release = () => r([117.15, -0.5])));
    const t: ActionTarget = { ...target, regionCentroid: () => slowCentroid };
    const queue = actionQueue();
    const region = queue(() => runAction({ name: "fly_to_region", input: { region: "samarinda" } }, t));
    const building = queue(() => runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, t));
    await Bun.sleep(20);
    expect(picked).toEqual([]); // waits for the region flight to start
    release();
    expect(await region).toBe("ok");
    expect(await building).toBe("ok");
    expect(flights.map((f) => f.center)).toEqual([[117.15, -0.5]]); // the region flight, then the pick
    expect(picked).toEqual([[117.1, -0.5]]);
  });

  test("a pick that a flight cut short is tried once more", async () => {
    let calls = 0;
    useAppStore.setState({
      selectBuildingAt: async (at) => {
        calls++;
        picked.push(at);
        useAppStore.setState({ buildingStatus: calls === 1 ? "empty" : "loading" });
      },
    });
    expect(await runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target)).toBe("ok");
    expect(picked).toHaveLength(2);
  });

  test("a pick the presenter interrupted is not tried again and leaves the camera alone", async () => {
    // The store gave up (a drag, wheel, key, region click or map tool during the flight) and closed the panel.
    useAppStore.setState({
      selectBuildingAt: async (at) => {
        picked.push(at);
        useAppStore.setState({ buildingStatus: "idle" });
      },
    });
    expect(await runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target)).toBe("failed");
    expect(picked).toHaveLength(1);
    expect(flights).toHaveLength(0);
  });

  test("a place the chat found is selected with its type and name", async () => {
    const hints: unknown[] = [];
    useAppStore.setState({ selectBuildingAt: (async (_at: [number, number], hint?: unknown) => void hints.push(hint)) as never });
    const places = [{ name: "SMA Negeri 1", lng: 117.151, lat: -0.501, type: "sekolah" }];
    await runAction({ name: "mark_places", input: { label: "sekolah", places } }, target);
    await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target);
    await runAction({ name: "select_building_at", input: { lng: 117.2, lat: -0.5 } }, target);
    expect(hints).toEqual([{ type: "sekolah", name: "SMA Negeri 1" }, undefined]);
  });

  test("the fit after an answer waits for the region flight that answer started", async () => {
    const places = [
      { name: "RS A", lng: 117.0, lat: -0.4 },
      { name: "RS B", lng: 117.2, lat: -0.6 },
    ];
    const cameras: unknown[] = [];
    useAppStore.setState({
      map: { ...(useAppStore.getState().map as object), cameraForBounds: (b: unknown) => (cameras.push(b), { center: [117.1, -0.5], zoom: 11 }) } as never,
    });
    await runAction({ name: "fly_to_region", input: { region: "kutai-kartanegara" } }, target);
    await runAction({ name: "mark_places", input: { label: "rumah sakit", places } }, target);
    const fit = fitMarkedPlaces(target);
    await Bun.sleep(20);
    expect(cameras).toHaveLength(0); // MapView's region flight has not started yet
    startMoving();
    expect(await fit).toBe(true);
    expect(cameras).toHaveLength(1);
  });

  test("marked places come into view when their button is pressed, or when the answer never went to one", async () => {
    const places = [
      { name: "RS A", lng: 117.0, lat: -0.4 },
      { name: "RS B", lng: 117.2, lat: -0.6 },
    ];
    const fit = { ...target };
    const cameras: unknown[] = [];
    useAppStore.setState({
      map: {
        ...(useAppStore.getState().map as object),
        cameraForBounds: (b: unknown) => (cameras.push(b), { center: [117.1, -0.5], zoom: 11 }),
      } as never,
    });
    await runAction({ name: "mark_places", input: { label: "rumah sakit", places } }, fit);
    expect(cameras).toHaveLength(0); // during the answer the camera is left alone
    await runAction({ name: "mark_places", input: { label: "rumah sakit", places } }, fit, { replay: true });
    expect(cameras).toEqual([
      [
        [117.0, -0.6],
        [117.2, -0.4],
      ],
    ]);
    expect(await fitMarkedPlaces(fit)).toBe(true);
    expect(needsPlacesFit([{ name: "fly_to_region", input: {} }, { name: "mark_places", input: {} }])).toBe(true);
    expect(needsPlacesFit([{ name: "mark_places", input: {} }, { name: "select_building_at", input: {} }])).toBe(false);
    expect(needsPlacesFit([{ name: "set_metric", input: {} }])).toBe(false);
  });

  test("show_all_regions goes back to the province with nothing selected", async () => {
    useAppStore.setState({ selectedRegionId: "samarinda", selectedBuilding: BUILDING, buildingStatus: "ready" });
    expect(await runAction({ name: "show_all_regions", input: {} }, target)).toBe("ok");
    expect(state().selectedRegionId).toBeNull();
    expect(state().selectedBuilding).toBeNull();
    expect(state().buildingStatus).toBe("idle");
  });

  test("show_all_regions with nothing selected flies back to the overview", async () => {
    expect(await runAction({ name: "show_all_regions", input: {} }, target)).toBe("ok");
    expect(flights[0]).toMatchObject({ zoom: 6.55, bearing: -14 });
  });

  test("fly_to flies to the point, tilted at building zoom", async () => {
    expect(await runAction({ name: "fly_to", input: { lng: 117.1, lat: -0.5, zoom: 17 } }, target)).toBe("ok");
    expect(flights[0]).toMatchObject({ center: [117.1, -0.5], zoom: 17, pitch: 60, duration: 2000 });
  });

  test("camera moves keep the point clear of the open panels", async () => {
    const padding = { top: 24, bottom: 24, left: 384, right: 400 };
    await runAction({ name: "fly_to", input: { lng: 117.1, lat: -0.5, zoom: 16 } }, { ...target, viewPadding: () => padding });
    expect((flights[0] as Flight & { padding?: unknown }).padding).toEqual(padding);
  });

  test("fly_to jumps when the user prefers reduced motion", async () => {
    await runAction({ name: "fly_to", input: { lng: 117.1, lat: -0.5, zoom: 10 } }, { ...target, reducedMotion: () => true });
    expect(flights[0]?.duration).toBe(0);
  });

  test("select_building_at selects the building through the store (it flies and opens the panel)", async () => {
    expect(await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target)).toBe("ok");
    expect(picked).toEqual([[117.151, -0.501]]);
  });

  test("when no building could be picked far from the point, it still flies there", async () => {
    useAppStore.setState({ selectBuildingAt: async () => useAppStore.setState({ buildingStatus: "empty" }) });
    expect(await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target)).toBe("failed");
    expect(flights[0]).toMatchObject({ center: [117.151, -0.501], zoom: 17.5, pitch: 60 });
  });

  test("a selected building under the chat panel slides out from under it", async () => {
    useAppStore.setState({ selectBuildingAt: async (at) => useAppStore.setState({ buildingStatus: "ready", selectedBuildingAt: at }) });
    const padding = { top: 24, bottom: 24, left: 360, right: 772 }; // the clear strip ends at x 594
    await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, { ...target, viewPadding: () => padding });
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ center: [117.151, -0.501], padding });
  });

  test("a building that was found leaves the camera to lane buildings", async () => {
    useAppStore.setState({ selectBuildingAt: async () => useAppStore.setState({ buildingStatus: "loading" }) });
    await runAction({ name: "select_building_at", input: { lng: 117.151, lat: -0.501 } }, target);
    expect(flights).toHaveLength(0);
  });

  test("a failing building lookup does not throw into the chat", async () => {
    useAppStore.setState({
      selectBuildingAt: async () => {
        throw new Error("estimate failed");
      },
    });
    expect(await runAction({ name: "select_building_at", input: { lng: 117.1, lat: -0.5 } }, target)).toBe("failed");
  });

  test("open_tab reports a failure when the panel cannot show that tab", async () => {
    expect(await runAction({ name: "open_tab", input: { tab: "surya" } }, { ...target, tabShown: async () => false })).toBe("failed");
    expect(state().panelTab).toBe("surya");
    expect(actionChips([{ name: "open_tab", input: { tab: "surya" } }], ["failed"])).toEqual([
      { label: "Tab belum bisa dibuka", index: 0, failed: true },
    ]);
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
    expect(await runAction({ name: "mark_places", input: { label: "sekolah", places } }, target)).toBe("ok");
    expect(marked?.places).toEqual(places);
    marked?.pick([117.16, -0.49]);
    await Bun.sleep(0);
    expect(picked).toEqual([[117.16, -0.49]]);
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
    expect(await runAction(action as never, target)).toBe("skipped");
    expect(flights).toHaveLength(0);
    expect(state().metric).toBe(before.metric);
    expect(state().layers).toEqual(before.layers);
  });

  test("without a map, camera actions report that nothing happened", async () => {
    useAppStore.setState({ map: null });
    expect(await runAction({ name: "fly_to", input: { lng: 117, lat: 0, zoom: 9 } }, target)).toBe("skipped");
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
    expect(chips[2]?.index).toBe(3);
  });

  test("a button only claims what happened: a failed pick says so, a skipped action has no button", () => {
    const actions = [
      { name: "fly_to_region", input: { region: "samarinda" } },
      { name: "mark_places", input: { label: "sekolah", places: [{}, {}] } },
      { name: "select_building_at", input: { lng: 1, lat: 1 } },
    ] as const;
    expect(actionChips([...actions], ["ok", "skipped", "failed"])).toEqual([
      { label: "Samarinda", index: 0, failed: false },
      { label: "Gedung tidak ditemukan", index: 2, failed: true },
    ]);
    // Tried again from its button, and this time it worked.
    expect(actionChips([...actions], ["ok", "ok", "ok"]).map((c) => c.label)).toEqual(["Samarinda", "2 sekolah ditandai", "Gedung dipilih"]);
    // Still running: the button says what it is doing, not that it worked.
    expect(actionChips([...actions], ["ok", "ok"]).at(-1)).toEqual({ label: "Mencari gedung…", index: 2, failed: false });
    // Kept from before outcomes were recorded: counts as done.
    expect(actionChips([...actions]).at(-1)).toEqual({ label: "Gedung dipilih", index: 2, failed: false });
  });
});
