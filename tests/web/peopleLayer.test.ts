import { expect, test } from "bun:test";
import { walkLanes } from "../../src/web/map/peopleLayer.ts";
import { footprintContains } from "../../src/web/map/buildings.ts";

const box = (half: number) => ({ geometry: { type: "Polygon", coordinates: [[[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]]] } });
test("walk routes stay off the building, including the whole path and a body clearance", () => {
  const building = box(0.00015);
  const lanes = walkLanes([0, 0], [building]);
  expect(lanes).toHaveLength(3);
  expect(new Set(lanes.map(l => l.role)).size).toBe(3);
  for (const lane of lanes) for (let i = 0; i <= 100; i++) {
    const p: [number, number] = [lane.start[0] + (lane.end[0] - lane.start[0]) * i / 100, lane.start[1] + (lane.end[1] - lane.start[1]) * i / 100];
    expect(footprintContains(building.geometry, p)).toBe(false);
  }
});
test("a completely occupied area gets no people walking through its walls", () => {
  expect(walkLanes([0, 0], [box(0.01)])).toEqual([]);
});
test("repeat views build the same three local walk routes", () => {
  expect(walkLanes([117, -0.5], [])).toEqual(walkLanes([117, -0.5], []));
});
