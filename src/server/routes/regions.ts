import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";

export function regionRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/regions": { GET: safe(async () => json(await deps.db.regionGeoJSON())) },
    "/api/regions/:id": {
      GET: safe(async (req) => {
        const region = await deps.db.regionById(String(req.params.id));
        return region ? json(region) : error("Wilayah tidak ditemukan", 404);
      }),
    },
  };
}
