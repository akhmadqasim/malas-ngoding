import { env } from "../env.ts";
import { type RouteTable, json } from "../http.ts";

/** Mapbox public tokens start with "pk."; a secret ("sk.") token must never be sent to the browser. */
export function publicMapboxToken(token: string): string {
  return token.startsWith("pk.") ? token : "";
}

export function configRoutes(): RouteTable {
  return {
    "/api/config": { GET: () => json({ mapboxToken: publicMapboxToken(env.mapboxToken) }) },
  };
}
