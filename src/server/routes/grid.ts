import type { AppDeps } from "../index.ts";
import { type RouteTable, json, safe } from "../http.ts";

export function gridRoutes(deps: AppDeps): RouteTable {
  return { "/api/grid": { GET: safe(async () => json(await deps.db.getGridMix())) } };
}
