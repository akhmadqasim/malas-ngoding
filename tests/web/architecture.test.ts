import { afterEach, beforeEach, expect, test } from "bun:test";
import { addArchitecture, ARCHITECTURE_LAYER, removeArchitecture, setArchitectureRoofs } from "../../src/web/map/architecture.ts";
import { BUILDINGS } from "../../src/web/map/buildings.ts";
import { fakeBuildingMap } from "./fakeBuildingMap.ts";
import { clearTokenCache } from "../../src/web/theme.ts";

const globals = globalThis as unknown as Record<string, unknown>;
const original = { document: globals.document, getComputedStyle: globals.getComputedStyle };
beforeEach(() => {
  globals.document = { documentElement: {} };
  globals.getComputedStyle = () => ({ getPropertyValue: () => "#bca58d" });
  clearTokenCache();
});
afterEach(() => { Object.assign(globals, original); clearTokenCache(); });

test("changing a selected building does not erase the roofs of installed solar homes", () => {
  const { map } = fakeBuildingMap();
  addArchitecture(map);
  let roofs: unknown;
  map.setLayoutProperty = (_id, _name, value) => { roofs = value; return map; };
  setArchitectureRoofs(map, "solar", [{ id: 101, roof: "flat" }]);
  setArchitectureRoofs(map, "selection", [{ id: 202, roof: "gabled" }]);
  expect(JSON.stringify(roofs)).toContain("101");
  expect(JSON.stringify(roofs)).toContain("202");
  setArchitectureRoofs(map, "selection", []);
  expect(JSON.stringify(roofs)).toContain("101");
  expect(JSON.stringify(roofs)).not.toContain("202");
});

test("the rendered architecture and building interactions target the same layer", () => {
  const { map, config } = fakeBuildingMap();
  addArchitecture(map);
  expect(BUILDINGS).toEqual({ layerId: ARCHITECTURE_LAYER });
  expect(map.getLayer(ARCHITECTURE_LAYER)).toBeDefined();
  expect(config.show3dBuildings).toBe(false);
});

test("architecture can be initialized twice and rebuilt after a style reload", () => {
  const { map } = fakeBuildingMap();
  addArchitecture(map);
  const source = map.getSource(ARCHITECTURE_LAYER);
  addArchitecture(map);
  expect(map.getSource(ARCHITECTURE_LAYER)).toBe(source);
  removeArchitecture(map);
  expect(map.getSource(ARCHITECTURE_LAYER)).toBeUndefined();
  expect(map.getLayer(ARCHITECTURE_LAYER)).toBeUndefined();
  removeArchitecture(map);
  addArchitecture(map);
  expect(map.getLayer(ARCHITECTURE_LAYER)).toBeDefined();
});
