import { env } from "../env.ts";
import { type RouteTable, json } from "../http.ts";

export function configRoutes(): RouteTable {
  return {
    // The Mapbox token is a public (pk.) token meant for the browser.
    "/api/config": { GET: () => json({ mapboxToken: env.mapboxToken }) },
  };
}
