import { describe, expect, test } from "bun:test";
import { columnZoomScale, FLATTEN, FLATTEN_SELECTED, flattenShare, selectedZoomScale } from "../../src/web/map/columns.ts";
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
