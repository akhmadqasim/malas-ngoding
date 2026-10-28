import type { PemdaSummary } from "../../shared/auth.ts";
import { type Handler, error, json } from "../http.ts";
import type { AppDeps } from "../index.ts";
import { requireRole } from "../services/session.ts";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Wraps a government-only handler: 401 signed out, 403 for other roles, friendly 500 on a failure. */
function pemdaOnly(deps: AppDeps, handler: () => Promise<Response>): Handler {
  return async (req) => {
    try {
      const auth = await requireRole(deps.db, req, "pemda");
      if ("res" in auth) return auth.res;
      return await handler();
    } catch (err) {
      console.error(`${req.method} ${new URL(req.url).pathname} failed:`, err instanceof Error ? err.message : "unknown error");
      return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
    }
  };
}

/** What the local government sees of registered homes: counts and anonymous points, never names or emails. */
export function pemdaRoutes(deps: AppDeps) {
  return {
    "/api/pemda/summary": {
      GET: pemdaOnly(deps, async () => {
        const summary = await deps.db.pemdaSummary();
        const { demoHomes } = summary;
        // Sums of kWp carry float noise (36.300000000000004); keep three decimals.
        const regions = summary.regions.map((r) => ({ ...r, potentialKwp: round3(r.potentialKwp), installedKwp: round3(r.installedKwp), verified: r.verified ?? 0, verifiedKwp: round3(r.verifiedKwp ?? 0) }));
        const sum = (pick: (r: (typeof regions)[number]) => number) => regions.reduce((acc, r) => acc + pick(r), 0);
        const body: PemdaSummary = {
          regions,
          totals: {
            homes: sum((r) => r.homes),
            interested: sum((r) => r.interested),
            installed: sum((r) => r.installed),
            installedKwp: round3(sum((r) => r.installedKwp)),
            verified: sum((r) => r.verified),
            verifiedKwp: round3(sum((r) => r.verifiedKwp)),
            potentialKwp: round3(sum((r) => r.potentialKwp)),
            kwhYear: sum((r) => r.kwhYear),
          },
          demoHomes,
        };
        return json(body);
      }),
    },
    "/api/pemda/homes": {
      GET: pemdaOnly(deps, async () => json(await deps.db.pemdaHomes())),
    },
  };
}
