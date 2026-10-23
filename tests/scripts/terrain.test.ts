import { describe, expect, test } from "bun:test";
import {
  decodeTerrarium,
  metersPerPixel,
  pointInPolygon,
  slopeDegrees,
} from "../../scripts/build-terrain";

describe("terrarium decode", () => {
  test("known values", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 0)).toBe(100);
    expect(decodeTerrarium(128, 10, 128)).toBeCloseTo(10.5, 6);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });
});

describe("metersPerPixel", () => {
  test("equator and 2 degrees at zoom 10", () => {
    expect(metersPerPixel(0)).toBeCloseTo(152.874, 2);
    expect(metersPerPixel(2)).toBeCloseTo(152.874 * Math.cos((2 * Math.PI) / 180), 2);
  });
});

describe("slopeDegrees", () => {
  const dx = 30;
  const plane = (gx: number, gy: number) => {
    const n: number[] = [];
    for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) n.push(100 + gx * c * dx + gy * -r * dx);
    return n;
  };
  test("flat is zero", () => {
    expect(slopeDegrees(plane(0, 0), dx, dx)).toBeCloseTo(0, 9);
  });
  test("10 percent grade is about 5.71 degrees, in any direction", () => {
    expect(slopeDegrees(plane(0.1, 0), dx, dx)).toBeCloseTo(5.711, 2);
    expect(slopeDegrees(plane(0, 0.1), dx, dx)).toBeCloseTo(5.711, 2);
    expect(slopeDegrees(plane(-0.1, 0), dx, dx)).toBeCloseTo(5.711, 2);
  });
});

describe("pointInPolygon", () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  test("outline and hole", () => {
    expect(pointInPolygon(2, 2, [outer, hole])).toBe(true);
    expect(pointInPolygon(5, 5, [outer, hole])).toBe(false);
    expect(pointInPolygon(11, 5, [outer, hole])).toBe(false);
    expect(pointInPolygon(5, 5, [outer])).toBe(true);
  });
});
