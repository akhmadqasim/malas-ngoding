import { describe, expect, test } from "bun:test";
import { polygonAreaM2 } from "../../src/shared/estimate.ts";

const square = (lng: number, lat: number, d: number) => [
  [
    [lng, lat],
    [lng + d, lat],
    [lng + d, lat + d],
    [lng, lat + d],
    [lng, lat],
  ],
];

describe("polygonAreaM2", () => {
  test("a 0.001 degree square at the equator is about 12,364 m2 (within 1%)", () => {
    expect(Math.abs(polygonAreaM2(square(0, 0, 0.001)) - 12_364) / 12_364).toBeLessThan(0.01);
  });

  test("winding order does not matter", () => {
    const ring = square(117.15, -0.5, 0.001)[0]!;
    expect(polygonAreaM2([[...ring].reverse()])).toBeCloseTo(polygonAreaM2([ring]), 6);
  });

  test("a square in Samarinda is a little smaller than at the equator (cos of latitude)", () => {
    const a = polygonAreaM2(square(117.15, -0.5, 0.001));
    expect(a).toBeGreaterThan(12_200);
    expect(a).toBeLessThan(polygonAreaM2(square(0, 0, 0.001)));
  });

  test("holes are subtracted", () => {
    const outer = square(0, 0, 0.002)[0]!;
    const hole = square(0.0005, 0.0005, 0.001)[0]!;
    const whole = polygonAreaM2([outer]);
    expect(polygonAreaM2([outer, hole])).toBeCloseTo(whole - polygonAreaM2([hole]), 3);
  });

  test("an unclosed ring is treated as closed", () => {
    const open = square(0, 0, 0.001)[0]!.slice(0, 4);
    expect(polygonAreaM2([open])).toBeCloseTo(polygonAreaM2(square(0, 0, 0.001)), 6);
  });

  test("empty, degenerate or broken input gives 0, never NaN", () => {
    expect(polygonAreaM2([])).toBe(0);
    expect(polygonAreaM2([[]])).toBe(0);
    expect(polygonAreaM2([[[0, 0], [1, 1]]])).toBe(0);
    expect(polygonAreaM2([[[0, 0], [Number.NaN, 0], [0, 1]]])).toBe(0);
  });
});
