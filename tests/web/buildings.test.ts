import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildingColors,
  buildingInputFrom,
  centroidOf,
  clearBuildingSelection,
  disableBuildingInteraction,
  enableBuildingInteraction,
  footprintOf,
  polygonContains,
  selectBuildingAt,
  TERRAIN_OFF_ZOOM,
  TERRAIN_ON_ZOOM,
  terrainWanted,
} from "../../src/web/map/buildings.ts";
import { clearTokenCache } from "../../src/web/theme.ts";
import type { BuildingInput } from "../../src/shared/types.ts";
import { type Feature, fakeBuildingMap as fakeMap, square } from "./fakeBuildingMap.ts";

describe("terrain follows the zoom with hysteresis", () => {
  test("on until past the off line, then off until back under the on line", () => {
    expect(terrainWanted(10, true)).toBe(true);
    expect(terrainWanted(13, true)).toBe(true);
    expect(terrainWanted(TERRAIN_OFF_ZOOM + 0.01, true)).toBe(false);
    expect(terrainWanted(13, false)).toBe(false);
    expect(terrainWanted(TERRAIN_ON_ZOOM + 0.01, false)).toBe(false);
    expect(terrainWanted(TERRAIN_ON_ZOOM - 0.01, false)).toBe(true);
    expect(TERRAIN_ON_ZOOM).toBeLessThan(TERRAIN_OFF_ZOOM);
  });
});

describe("the estimate request comes from the clicked building", () => {
  test("id, centre, footprint and height", () => {
    const input = buildingInputFrom({ id: 330758404, geometry: square(117.15, -0.5, 0.0002), properties: { height: 21.7 } });
    expect(input).not.toBeNull();
    expect(input!.featureId).toBe("mapbox:330758404");
    expect(input!.lng).toBeCloseTo(117.1501, 6);
    expect(input!.lat).toBeCloseTo(-0.4999, 6);
    // 0.0002 degrees is about 22 m: about 494 m2.
    expect(input!.footprintM2).toBeGreaterThan(480);
    expect(input!.footprintM2).toBeLessThan(500);
    expect(input!.heightM).toBe(21.7);
  });

  test("without an id the key is the rounded centre", () => {
    const input = buildingInputFrom({ geometry: square(117.15, -0.5, 0.0002), properties: {} });
    expect(input!.featureId).toBe("at:117.15010,-0.49990");
    expect(input!.heightM).toBeNull();
  });

  test("a missing or broken height is unknown, not zero", () => {
    expect(buildingInputFrom({ id: 1, geometry: square(0, 0, 0.0001), properties: { height: "x" } })!.heightM).toBeNull();
    expect(buildingInputFrom({ id: 1, geometry: square(0, 0, 0.0001), properties: null })!.heightM).toBeNull();
  });

  test("a multipolygon counts every part; its centre is the largest part's", () => {
    const big = square(0, 0, 0.0004).coordinates;
    const small = square(0.001, 0.001, 0.0001).coordinates;
    const geometry = { type: "MultiPolygon", coordinates: [small, big] };
    expect(footprintOf(geometry)).toBeCloseTo(footprintOf(square(0, 0, 0.0004)) + footprintOf(square(0.001, 0.001, 0.0001)), 6);
    expect(centroidOf(geometry)).toEqual([0.0002, 0.0002]);
  });

  test("a point or line is not a building", () => {
    expect(buildingInputFrom({ id: 1, geometry: { type: "Point", coordinates: [0, 0] } })).toBeNull();
    expect(buildingInputFrom({ id: 1, geometry: { type: "Polygon", coordinates: [] } })).toBeNull();
  });
});

const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, getComputedStyle: g.getComputedStyle, window: g.window };
const TOKENS: Record<string, string> = {
  "--color-ink-faint": "#626973",
  "--color-outline-light": "#1c222c",
  "--color-paper": "#ece9e2",
  "--color-co2-4": "#ebc082",
};
beforeEach(() => {
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: (name: string) => TOKENS[name] ?? "" });
  g.window = { matchMedia: () => ({ matches: true }) };
  clearTokenCache();
});
afterEach(() => {
  g.document = saved.document;
  g.getComputedStyle = saved.getComputedStyle;
  g.window = saved.window;
  clearTokenCache();
});

describe("building colours follow the ground tone", () => {
  test("ink on a light ground; on a dark one a paper hover and an amber selection", () => {
    expect(buildingColors("light")).toEqual({ highlight: "#626973", select: "#1c222c" });
    expect(buildingColors("dark")).toEqual({ highlight: "#ece9e2", select: "#ebc082" });
  });
});

const house: Feature = { id: 7, geometry: square(117.15, -0.5, 0.0002), properties: { height: 3 } };
const school: Feature = { id: 8, geometry: square(117.16, -0.5, 0.0005), properties: { height: 9 } };

describe("clicking buildings", () => {
  test("hover lights a building and shows a pointer; leaving clears both", () => {
    const f = fakeMap();
    enableBuildingInteraction(f.map, () => {}, "dark");
    f.interactions.get("building-enter")!({ feature: house });
    expect(f.states.get(7)).toEqual({ highlight: true });
    expect(f.canvas.style.cursor).toBe("pointer");
    f.interactions.get("building-leave")!({ feature: house });
    expect(f.states.get(7)).toEqual({ highlight: false });
    expect(f.canvas.style.cursor).toBe("");
  });

  test("a stale leave of the previous building does not clear the next one's hover", () => {
    const f = fakeMap();
    enableBuildingInteraction(f.map, () => {}, "dark");
    f.interactions.get("building-enter")!({ feature: house });
    f.interactions.get("building-enter")!({ feature: school });
    f.interactions.get("building-leave")!({ feature: house });
    expect(f.states.get(8)).toEqual({ highlight: true });
    expect(f.canvas.style.cursor).toBe("pointer");
  });

  test("a click selects one building at a time and reports its estimate request", () => {
    const f = fakeMap();
    const picked: BuildingInput[] = [];
    enableBuildingInteraction(f.map, (input) => picked.push(input), "light");
    expect(f.config).toEqual({ colorBuildingHighlight: "#626973", colorBuildingSelect: "#1c222c" });
    f.interactions.get("building-click")!({ feature: house });
    f.interactions.get("building-click")!({ feature: school });
    expect(f.states.get(7)?.select).toBe(false);
    expect(f.states.get(8)?.select).toBe(true);
    expect(picked.map((p) => p.featureId)).toEqual(["mapbox:7", "mapbox:8"]);
    clearBuildingSelection(f.map);
    expect(f.states.get(8)?.select).toBe(false);
  });

  test("disabling removes the interactions and the selection", () => {
    const f = fakeMap();
    enableBuildingInteraction(f.map, () => {}, "dark");
    f.interactions.get("building-click")!({ feature: house });
    disableBuildingInteraction(f.map);
    expect(f.interactions.size).toBe(0);
    expect(f.states.get(7)?.select).toBe(false);
  });
});

describe("terrain goes off at building zoom", () => {
  test("off when enabled at building zoom, back on when zooming out past the on line, off again going in", () => {
    const f = fakeMap({ zoom: 16 });
    enableBuildingInteraction(f.map, () => {}, "dark");
    expect(f.terrain()).toBeNull();
    f.setZoom(13);
    expect(f.terrain()).toBeNull();
    f.setZoom(12.5);
    expect(f.terrain()).toEqual({ source: "mapbox-dem", exaggeration: 1.4 });
    f.setZoom(13);
    expect(f.terrain()).not.toBeNull();
    f.setZoom(14);
    expect(f.terrain()).toBeNull();
  });

  test("disabling puts terrain back", () => {
    const f = fakeMap({ zoom: 16 });
    enableBuildingInteraction(f.map, () => {}, "dark");
    disableBuildingInteraction(f.map);
    expect(f.terrain()).not.toBeNull();
  });
});

describe("the building at a point", () => {
  test("polygonContains: inside, outside, and inside a hole counts as outside", () => {
    const outer = square(0, 0, 0.002).coordinates[0]!;
    const hole = square(0.0005, 0.0005, 0.001).coordinates[0]!;
    expect(polygonContains([outer], [0.001, 0.001])).toBe(true);
    expect(polygonContains([outer], [0.003, 0.001])).toBe(false);
    expect(polygonContains([outer, hole], [0.001, 0.001])).toBe(false);
    expect(polygonContains([outer, hole], [0.0002, 0.0002])).toBe(true);
    expect(polygonContains([], [0, 0])).toBe(false);
  });
});

describe("selectBuildingAt (the chat's select building action)", () => {
  // A neighbour whose wall is in front of the point at a pitched camera comes first in the query.
  const neighbour = { id: 9, geometry: square(117.1606, -0.4999, 0.0003), properties: { height: 12 } };

  test("flies there and picks the building whose footprint holds the point, not the frontmost one", async () => {
    const f = fakeMap({ zoom: 8, rendered: [neighbour, school] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    const input = await selectBuildingAt(f.map, 117.1602, -0.4998);
    expect(f.map.getZoom()).toBe(17.5);
    expect(input?.featureId).toBe("mapbox:8");
    expect(f.states.get(8)?.select).toBe(true);
    expect(f.states.get(9)?.select).toBeUndefined();
  });

  test("with no footprint holding the point, the nearest building centre close by", async () => {
    const f = fakeMap({ zoom: 8, rendered: [house, school] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    expect((await selectBuildingAt(f.map, 117.15995, -0.50005))?.featureId).toBe("mapbox:8");
  });

  test("null when no building is near the point", async () => {
    const f = fakeMap({ zoom: 8, rendered: [house] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    // The fake map projects 1 degree to 1000 px: the house is 50 px away, past the 28 px search radius.
    expect(await selectBuildingAt(f.map, 117.2, -0.5)).toBeNull();
  });

  test("a request that went stale during the flight selects nothing", async () => {
    const f = fakeMap({ zoom: 8, rendered: [school] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    expect(await selectBuildingAt(f.map, 117.1602, -0.4998, { isStale: () => true })).toBeNull();
    expect(f.states.get(8)).toBeUndefined();
  });

  test("null before the interaction is enabled", async () => {
    const f = fakeMap();
    expect(await selectBuildingAt(f.map, 117.1602, -0.4998)).toBeNull();
  });
});

describe("a click on empty ground", () => {
  test("closes the panel at building zoom, not from afar", () => {
    let closed = 0;
    const f = fakeMap({ zoom: 16 });
    enableBuildingInteraction(f.map, () => {}, "dark", () => closed++);
    f.interactions.get("building-background-click")!({});
    f.setZoom(12);
    f.interactions.get("building-background-click")!({});
    expect(closed).toBe(1);
  });
});

describe("a point from a place search", () => {
  test("may look further for the nearest building than a plain point", async () => {
    // 0.04 degrees = 40 px in the fake map: past 28 px, inside 80 px.
    const f = fakeMap({ zoom: 8, rendered: [school] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    expect(await selectBuildingAt(f.map, 117.2003, -0.4998)).toBeNull();
    expect((await selectBuildingAt(f.map, 117.2003, -0.4998, { searchRadiusPx: 80 }))?.featureId).toBe("mapbox:8");
  });
});
