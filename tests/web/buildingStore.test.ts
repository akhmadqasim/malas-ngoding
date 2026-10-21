import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BuildingEstimate, BuildingInput } from "../../src/shared/types.ts";
import { disableBuildingInteraction, enableBuildingInteraction } from "../../src/web/map/buildings.ts";
import { useAppStore } from "../../src/web/store.ts";
import { clearTokenCache } from "../../src/web/theme.ts";
import { fakeBuildingMap, square } from "./fakeBuildingMap.ts";

const state = () => useAppStore.getState();
const realFetch = globalThis.fetch;
const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, getComputedStyle: g.getComputedStyle, window: g.window };

const input = (featureId: string, extra: Partial<BuildingInput> = {}): BuildingInput => ({
  featureId,
  lng: 117.15,
  lat: -0.5,
  footprintM2: 120,
  heightM: null,
  ...extra,
});
const estimateFor = (body: BuildingInput): BuildingEstimate => ({
  featureId: body.featureId,
  type: body.typeOverride ?? "rumah",
  typeSource: body.typeOverride ? "user" : "footprint",
  floors: body.floorsOverride ?? 1,
  floorAreaM2: body.footprintM2 * (body.floorsOverride ?? 1),
  kwhYear: 1000,
  kwhMonth: 83,
  co2KgYear: 1140,
  bySource: [],
  equivalents: [],
  region: { id: "samarinda", name: "Samarinda" },
  assumptions: [],
});

/** Requests the store sent, and a way to answer each one later (in any order). */
let requests: { body: BuildingInput; answer: (ok?: boolean) => void }[] = [];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  requests = [];
  globalThis.fetch = ((_url: string, init: RequestInit) =>
    new Promise<Response>((resolve) => {
      const body = JSON.parse(String(init.body)) as BuildingInput;
      requests.push({
        body,
        answer: (ok = true) =>
          resolve(ok ? Response.json(estimateFor(body)) : Response.json({ error: "Database sedang tidak bisa dihubungi." }, { status: 503 })),
      });
    })) as unknown as typeof fetch;
  g.document = { documentElement: {}, querySelector: () => null };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#000000" });
  g.window = { matchMedia: () => ({ matches: true }), innerWidth: 1600, innerHeight: 900 };
  clearTokenCache();
  state().closeBuilding();
  useAppStore.setState({ map: null });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  g.document = saved.document;
  g.getComputedStyle = saved.getComputedStyle;
  g.window = saved.window;
  clearTokenCache();
});

describe("the selected building and where it is", () => {
  test("setSelectedBuilding sets both, and null clears both", () => {
    const b = estimateFor(input("a"));
    state().setSelectedBuilding(b, [117.1, -0.4]);
    expect(state().selectedBuilding).toBe(b);
    expect(state().selectedBuildingAt).toEqual([117.1, -0.4]);
    state().setSelectedBuilding(null);
    expect(state().selectedBuildingAt).toBeNull();
  });
});

describe("opening a building", () => {
  test("loads, then shows the estimate at the building's centre", async () => {
    const done = state().openBuilding(input("a", { lng: 117.2, lat: -0.45 }));
    expect(state().buildingStatus).toBe("loading");
    expect(state().selectedBuildingAt).toEqual([117.2, -0.45]);
    requests[0]!.answer();
    await done;
    expect(state().buildingStatus).toBe("ready");
    expect(state().selectedBuilding?.featureId).toBe("a");
  });

  test("a late answer for an older building never replaces the newer one", async () => {
    const first = state().openBuilding(input("a"));
    const second = state().openBuilding(input("b"));
    requests[1]!.answer();
    await second;
    requests[0]!.answer();
    await first;
    expect(state().selectedBuilding?.featureId).toBe("b");
  });

  test("a failure shows the server's message; Coba lagi asks again", async () => {
    const done = state().openBuilding(input("a"));
    requests[0]!.answer(false);
    await done;
    expect(state().buildingStatus).toBe("error");
    expect(state().buildingError).toBe("Database sedang tidak bisa dihubungi.");
    const retry = state().retryBuilding();
    expect(state().buildingStatus).toBe("loading");
    requests[1]!.answer();
    await retry;
    expect(state().buildingStatus).toBe("ready");
  });

  test("closing drops everything, and an answer still on its way is ignored", async () => {
    const done = state().openBuilding(input("a"));
    state().closeBuilding();
    requests[0]!.answer();
    await done;
    expect(state().buildingStatus).toBe("idle");
    expect(state().selectedBuilding).toBeNull();
    expect(state().selectedBuildingAt).toBeNull();
  });
});

describe("the user's type and floors", () => {
  test("an override keeps the numbers up while it loads, then shows the new estimate", async () => {
    const open = state().openBuilding(input("a"));
    requests[0]!.answer();
    await open;
    const floors = state().overrideBuilding({ floorsOverride: 3 });
    expect(state().buildingUpdating).toBe(true);
    expect(state().selectedBuilding?.floors).toBe(1);
    expect(requests[1]!.body.floorsOverride).toBe(3);
    requests[1]!.answer();
    await floors;
    expect(state().buildingUpdating).toBe(false);
    expect(state().selectedBuilding?.floors).toBe(3);
  });

  test("a new type drops an earlier floor count, so the type's usual floors apply", async () => {
    const open = state().openBuilding(input("a"));
    requests[0]!.answer();
    await open;
    const floors = state().overrideBuilding({ floorsOverride: 5 });
    requests[1]!.answer();
    await floors;
    const type = state().overrideBuilding({ typeOverride: "sekolah" });
    expect(requests[2]!.body.typeOverride).toBe("sekolah");
    expect(requests[2]!.body.floorsOverride).toBeUndefined();
    requests[2]!.answer();
    await type;
    expect(state().selectedBuilding?.type).toBe("sekolah");
  });
});

describe("selectBuildingAt (the chat's select building action)", () => {
  const school = { id: 8, geometry: square(117.16, -0.5, 0.0005), properties: { height: 9 } };

  test("without a map the panel says the map is not ready", async () => {
    await state().selectBuildingAt([117.16, -0.5]);
    expect(state().buildingStatus).toBe("empty");
    expect(state().buildingError).toContain("Peta belum siap");
  });

  test("finds the building on the map, opens the panel and fetches its estimate", async () => {
    const f = fakeBuildingMap({ zoom: 8, rendered: [school] });
    enableBuildingInteraction(f.map, (i) => void state().openBuilding(i), "dark");
    useAppStore.setState({ map: f.map });
    const done = state().selectBuildingAt([117.1602, -0.4998]);
    expect(state().buildingStatus).toBe("loading");
    expect(state().selectedBuildingAt).toEqual([117.1602, -0.4998]);
    await done;
    expect(requests[0]!.body.featureId).toBe("mapbox:8");
    requests[0]!.answer();
    await flush();
    expect(state().buildingStatus).toBe("ready");
    expect(state().selectedBuildingAt).toEqual([requests[0]!.body.lng, requests[0]!.body.lat]);
    disableBuildingInteraction(f.map);
  });

  test("no building at the point: the panel says so", async () => {
    const f = fakeBuildingMap({ zoom: 8, rendered: [] });
    enableBuildingInteraction(f.map, (i) => void state().openBuilding(i), "dark");
    useAppStore.setState({ map: f.map });
    await state().selectBuildingAt([117.1602, -0.4998]);
    expect(state().buildingStatus).toBe("empty");
    expect(state().buildingError).toContain("Tidak ada gedung");
    expect(requests).toHaveLength(0);
    disableBuildingInteraction(f.map);
  });
});
