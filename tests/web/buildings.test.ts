import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildingColors,
  buildingInputFrom,
  centroidOf,
  clearBuildingSelection,
  disableBuildingInteraction,
  enableBuildingInteraction,
  footprintOf,
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
  "--color-paper-muted": "#a7adb5",
  "--color-paper-bright": "#f5f2ea",
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
  test("ink on a light ground, paper on a dark one; the selection stands out more than the hover", () => {
    expect(buildingColors("light")).toEqual({ highlight: "#626973", select: "#1c222c" });
    expect(buildingColors("dark")).toEqual({ highlight: "#a7adb5", select: "#f5f2ea" });
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

describe("selectBuildingAt (the chat's select building action)", () => {
  test("flies there, picks the building under the point and reports it", async () => {
    const f = fakeMap({ zoom: 8, rendered: [school] });
    const picked: BuildingInput[] = [];
    enableBuildingInteraction(f.map, (input) => picked.push(input), "dark");
    expect(await selectBuildingAt(f.map, 117.1602, -0.4998)).toBe(true);
    expect(f.map.getZoom()).toBe(17.5);
    expect(f.states.get(8)?.select).toBe(true);
    expect(picked[0]?.featureId).toBe("mapbox:8");
  });

  test("false when no building is there", async () => {
    const f = fakeMap({ zoom: 8, rendered: [] });
    enableBuildingInteraction(f.map, () => {}, "dark");
    expect(await selectBuildingAt(f.map, 117.1602, -0.4998)).toBe(false);
  });

  test("false before the interaction is enabled", async () => {
    const f = fakeMap();
    expect(await selectBuildingAt(f.map, 117.1602, -0.4998)).toBe(false);
  });
});
