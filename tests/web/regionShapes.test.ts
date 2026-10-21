import { describe, expect, test } from "bun:test";
import type { RegionCollection } from "../../src/web/api.ts";
import { calmShapes, ringArea, simplifyRing } from "../../src/web/map/regionShapes.ts";

const square = (x: number, y: number, s: number) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

describe("calmer region shapes for the columns", () => {
  test("tiny islands next to the main land are dropped, big parts stay", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "kk" },
          geometry: { type: "MultiPolygon", coordinates: [[square(0, 0, 1)], [square(2, 0, 0.05)], [square(4, 0, 0.5)]] },
        },
      ],
    } as unknown as RegionCollection;
    const out = calmShapes(fc).features[0]!.geometry;
    expect(out.type).toBe("MultiPolygon");
    expect(out.coordinates).toHaveLength(2);
    expect(calmShapes(fc).features[0]!.properties).toEqual(fc.features[0]!.properties);
  });

  test("small zigzags vanish, real corners stay", () => {
    const ring = [[0, 0], [0.5, 0.001], [1, 0], [1, 1], [0, 1], [0, 0]];
    const out = simplifyRing(ring);
    expect(out).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    expect(ringArea(out)).toBeCloseTo(1, 6);
  });
});
