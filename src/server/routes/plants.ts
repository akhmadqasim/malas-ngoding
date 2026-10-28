import type { AppDeps } from "../app.ts";
import { type RouteTable, json, safe } from "../http.ts";

export function plantRoutes(deps: AppDeps): RouteTable {
  return { "/api/plants": { GET: safe(async () => json(await deps.db.listPlants())) } };
}
