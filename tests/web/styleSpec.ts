/*
 * Mapbox's own style-spec (expression parser and validators), so tests can check a paint expression or a
 * fog the way setPaintProperty and setFog will. The bundle ships its types as index.d.ts, which the
 * `.es.js` subpath does not point at, hence the cast.
 */
// @ts-expect-error -- no declaration next to index.es.js; typed through index.d.ts below.
import * as bundle from "mapbox-gl/dist/style-spec/index.es.js";
import type * as StyleSpec from "mapbox-gl/dist/style-spec/index.d.ts";

export const styleSpec = bundle as typeof StyleSpec;

/** Parse errors of `value` for a style property spec (empty when Mapbox accepts it). */
export function expressionErrors(value: unknown, property: unknown): string[] {
  const parsed = styleSpec.expression.createPropertyExpression(value, property as Parameters<typeof styleSpec.expression.createPropertyExpression>[1]);
  return parsed.result === "error" ? parsed.value.map((e) => e.message) : [];
}
