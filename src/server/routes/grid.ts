import type { AppDeps } from "../app.ts";
import { type RouteTable, json, safe } from "../http.ts";

export function gridRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/grid": { GET: safe(async () => json(await deps.db.getGridMix())) },
    // The kg CO2 per car km, tree, phone charge and flight: the province sheet turns its total into these.
    "/api/equivalents": { GET: safe(async () => json(await deps.db.getEquivalentFactors())) },
  };
}
