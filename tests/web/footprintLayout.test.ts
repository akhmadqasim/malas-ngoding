import { expect, test } from "bun:test";
import { pointInRings, projectedFootprint, roofPlacement } from "../../src/web/map/footprintLayout.ts";
import { facadeDetails } from "../../src/web/map/buildingDetails.ts";
import { square } from "./fakeBuildingMap.ts";

test("roof placement stays inside a concave footprint and out of its courtyard", () => {
  const geometry = { type: "Polygon", coordinates: [
    [[0, 0], [0.0005, 0], [0.0005, 0.00015], [0.0002, 0.00015], [0.0002, 0.0005], [0, 0.0005], [0, 0]],
    [[0.00004, 0.0002], [0.0001, 0.0002], [0.0001, 0.0003], [0.00004, 0.0003], [0.00004, 0.0002]],
  ] };
  const placement = roofPlacement(geometry)!;
  expect(placement).not.toBeNull();
  const projected = projectedFootprint(geometry)!;
  const x = (placement.at[0] - projected.origin[0]) * 111195 * Math.cos(projected.origin[1] * Math.PI / 180);
  const y = (placement.at[1] - projected.origin[1]) * 111195;
  const angle = -placement.angle * Math.PI / 180;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const dx = sx * placement.width / 2, dy = sy * placement.width / 2;
    expect(pointInRings(projected.rings, [x + dx * Math.cos(angle) - dy * Math.sin(angle), y + dx * Math.sin(angle) + dy * Math.cos(angle)])).toBe(true);
  }
});

test("large facade geometry is deduplicated and has a bounded window count", () => {
  const feature = { id: 10, geometry: square(117, 0, 0.001), properties: { height: 30 } };
  const once = facadeDetails([feature]);
  const repeated = facadeDetails([feature, feature, feature]);
  expect(repeated.data.features.length).toBe(once.data.features.length);
  expect(once.data.features.length).toBeGreaterThan(50);
  expect(once.roofs[0]!.roof).toBe("parapet");
  expect(facadeDetails(Array.from({ length: 100 }, (_, id) => ({ ...feature, id }))).data.features.length).toBeLessThanOrEqual(2600);
  expect(once.data.features.every(f => f.properties.top <= 30 && f.properties.top > f.properties.base)).toBe(true);
});

test("degenerate and multipart footprints do not receive a floating roof model", () => {
  expect(roofPlacement({ type: "MultiPolygon", coordinates: [] })).toBeNull();
  expect(roofPlacement({ type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] })).toBeNull();
});
