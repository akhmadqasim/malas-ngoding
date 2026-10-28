import type { AppDeps } from "../app.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { GENERATION_BUDGET_MS, recommendationsFor } from "../services/recommendations.ts";
import { requireRole, sameOriginProblem } from "../services/session.ts";

const NOT_FOUND = "Wilayah tidak ditemukan";
/**
 * Bun closes a connection after 10 s without a byte written, and a Claude answer takes longer. Keep the
 * connection open for the whole generation budget plus time for the data lookups (Bun allows up to 255 s).
 */
const IDLE_TIMEOUT_S = Math.ceil(GENERATION_BUDGET_MS / 1000) + 20;

export function recommendationRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/recommendations/:regionId": {
      GET: safe(async (req, server) => {
        server.timeout(req, IDLE_TIMEOUT_S);
        const out = await recommendationsFor(deps, String(req.params.regionId));
        return out ? json(out) : error(NOT_FOUND, 404);
      }),
    },
    "/api/recommendations/:regionId/refresh": {
      POST: safe(async (req, server) => {
        // Regenerating costs a Claude call, so only a signed-in government account may ask for it.
        const origin = sameOriginProblem(req);
        if (origin) return origin;
        const auth = await requireRole(deps.db, req, "pemda");
        if ("res" in auth) return auth.res;
        server.timeout(req, IDLE_TIMEOUT_S);
        const out = await recommendationsFor(deps, String(req.params.regionId), { refresh: true });
        return out ? json(out) : error(NOT_FOUND, 404);
      }),
    },
  };
}
