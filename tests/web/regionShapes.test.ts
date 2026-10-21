import { describe, expect, test } from "bun:test";
import type { RegionCollection } from "../../src/web/api.ts";
import { calmShapes, regionAt, ringArea, simplifyRing } from "../../src/web/map/regionShapes.ts";

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

describe("the region under a point", () => {
  const fc = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { id: "ring" }, geometry: { type: "Polygon", coordinates: [square(0, 0, 4), square(1, 1, 2)] } },
      { type: "Feature", properties: { id: "islands" }, geometry: { type: "MultiPolygon", coordinates: [[square(10, 0, 1)], [square(12, 0, 1)]] } },
    ],
  } as unknown as RegionCollection;

  test("finds the region whose shape holds the point, any part of it", () => {
    expect(regionAt(fc, 0.5, 0.5)).toBe("ring");
    expect(regionAt(fc, 12.5, 0.5)).toBe("islands");
  });

  test("a point in a hole, or at sea, is in no region", () => {
    expect(regionAt(fc, 2, 2)).toBeNull();
    expect(regionAt(fc, 11.5, 0.5)).toBeNull();
  });
});
