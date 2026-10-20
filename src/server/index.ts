import type { Server } from "bun";
import indexHtml from "../web/index.html";
import * as db from "./db.ts";
import { env } from "./env.ts";
import { error, json } from "./http.ts";
import { buildingRoutes } from "./routes/buildings.ts";
import { configRoutes } from "./routes/config.ts";
import { gridRoutes } from "./routes/grid.ts";
import { plantRoutes } from "./routes/plants.ts";
import { regionRoutes } from "./routes/regions.ts";
import { createPoiLookup, type PoiLookup } from "./services/tilequery.ts";

/** Dependencies injected into the server. Grows as later tasks add services. */
export interface AppDeps {
  db: Pick<
    typeof db,
    | "regionAt"
    | "regionById"
    | "listRegions"
    | "regionGeoJSON"
    | "getGridMix"
    | "listPlants"
    | "getBuildingTypes"
    | "getEquivalentFactors"
    | "cacheGet"
    | "cacheSet"
  >;
  /** Nearest POI within 25 m, or null. Throws when the upstream fails. */
  poi: PoiLookup;
}

export function createServer(opts: { port: number; deps: AppDeps }): Server<undefined> {
  const { deps } = opts;
  return Bun.serve({
    port: opts.port,
    routes: {
      "/api/health": () => json({ ok: true, name: "Malas Ngoding" }),
      ...configRoutes(),
      ...regionRoutes(deps),
      ...plantRoutes(deps),
      ...gridRoutes(deps),
      ...buildingRoutes(deps),
      "/api/*": () => error("Endpoint tidak ditemukan", 404),
      "/*": indexHtml,
    },
    development: { hmr: true, console: true },
  });
}

if (import.meta.main) {
  const server = createServer({ port: env.port, deps: { db, poi: createPoiLookup(env.mapboxToken) } });
  console.log(`Malas Ngoding running at ${server.url}`);
}
