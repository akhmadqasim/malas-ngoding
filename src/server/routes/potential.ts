import assumptions from "../../../data/seed/re-assumptions.json";
import costs from "../../../data/seed/solar-costs.json";
import type { PotentialAssumptions } from "../../shared/potential.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, json, safe } from "../http.ts";

/**
 * The renewable potential map: NASA POWER cells over Kalimantan Timur, clipped to its land, with their
 * region and nearest plant (db.potentialCells, PostGIS). The grid is static seed data, so the answer is
 * built once per server run.
 */
export function potentialRoutes(deps: AppDeps): RouteTable {
  let cells: ReturnType<AppDeps["db"]["potentialCells"]> | null = null;
  return {
    "/api/potential": {
      GET: safe(async () => {
        cells ??= deps.db.potentialCells();
        try {
          // CO2 a new PLTS or PLTB avoids: the Kepmen ESDM 163.K/2021 factor for them in the Mahakam system.
          return json({ ...(await cells), assumptions: assumptions as PotentialAssumptions, avoidedKgPerKwh: costs.solarFactorKgPerKwh });
        } catch (err) {
          // A failed query is not kept: the next request tries again.
          cells = null;
          throw err;
        }
      }),
    },
  };
}
