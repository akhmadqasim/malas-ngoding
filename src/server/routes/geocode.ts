import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { createRateLimiter, type RateLimiter, rateLimited } from "../services/rateLimit.ts";

/** Searches typed letter by letter: generous, but a script cannot spend the Mapbox quota. */
export const GEOCODE_LIMIT = { limit: 60, windowMs: 60_000 };
const MAX_QUERY = 120;

/** GET /api/geocode?q=: addresses and places in Kalimantan Timur for the search box (never stored). */
export function geocodeRoutes(deps: Pick<AppDeps, "geocode">, limiter: RateLimiter = createRateLimiter(GEOCODE_LIMIT)): RouteTable {
  return {
    "/api/geocode": {
      GET: safe(async (req, server) => {
        const limited = rateLimited(limiter, req, server);
        if (limited) return limited;
        const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/;/g, " ");
        if (q.length < 3) return error("Ketik minimal 3 huruf alamat atau nama tempat.", 400);
        try {
          return json({ hits: await deps.geocode(q.slice(0, MAX_QUERY)) });
        } catch {
          return error("Pencarian alamat sedang gagal. Coba lagi sebentar lagi.", 503);
        }
      }),
    },
  };
}
