import { describe, expect, test } from "bun:test";
import { columnZoomScale, FLATTEN, FLATTEN_SELECTED, flattenShare, intensities, selectedZoomScale } from "../../src/web/map/columns.ts";
import { styleSpec } from "./styleSpec.ts";

/** Evaluates a zoom expression the way Mapbox does for a paint property. */
function atZoom(expression: unknown, zoom: number): number {
  const parsed = styleSpec.expression.createPropertyExpression(expression, styleSpec.latest.paint_symbol["symbol-z-offset"] as never);
  if (parsed.result !== "success") throw new Error("invalid expression");
  return parsed.value.evaluate({ zoom } as never) as number;
}

describe("the flattening of the columns", () => {
  test("flattenShare is the curve the column layers interpolate, for the shared and the selected column", () => {
    for (const zoom of [5, 6.6, 7.3, 8, 9, 9.5, 10, 10.4, 11, 12, 14]) {
      expect(flattenShare(zoom) * 50_000).toBeCloseTo(atZoom(columnZoomScale(50_000), zoom), 6);
      expect(flattenShare(zoom, FLATTEN_SELECTED) * 50_000).toBeCloseTo(atZoom(selectedZoomScale(50_000), zoom), 6);
    }
  });

  test("full height at the province view, nothing left at city zoom", () => {
    expect(flattenShare(6.55)).toBe(1);
    expect(flattenShare(FLATTEN.at(-1)![0])).toBe(0);
    expect(flattenShare(10.4, FLATTEN_SELECTED)).toBe(0);
  });
});

describe("intensities with the rooftop solar scenario", () => {
  const r = (id: string, kwhYear: number) => ({
    id,
    name: id,
    kind: "kota" as const,
    kwhYear,
    co2KgYear: kwhYear,
    population: null,
    customers: null,
    electrificationPct: null,
    villagesNoPln: null,
    estimated: true,
  });
  const regions = [r("a", 100), r("b", 25)];

  test("a CO2 scale shrinks against the unscaled maximum, so the tallest column sinks too", () => {
    const scale = new Map([
      ["a", 0.25],
      ["b", 1],
    ]);
    const t = intensities(regions, "co2", scale);
    expect(t.get("a")).toBeCloseTo(0.5);
    expect(t.get("b")).toBeCloseTo(0.5);
  });

  test("the kWh columns ignore the scale", () => {
    const t = intensities(regions, "kwh", new Map([["a", 0.25]]));
    expect(t.get("a")).toBe(1);
  });
});