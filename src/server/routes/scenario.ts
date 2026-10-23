import costs from "../../../data/seed/solar-costs.json";
import type { ScenarioBasis } from "../../shared/scenario.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, json, safe } from "../http.ts";
import { cachedClimatology, FALLBACK_PSH } from "../services/cache.ts";

/**
 * What the province rooftop solar scenario needs (shared/scenario.ts computes it in the browser, so the
 * slider answers without a request per step): panel cost, the avoided-emission factor, the grid's solar
 * share and NASA POWER sun hours at each region's label point (cached by `bun run warm`).
 */
export async function scenarioBasis(deps: Pick<AppDeps, "db" | "nasa">): Promise<ScenarioBasis> {
  const [regions, grid] = await Promise.all([deps.db.listRegions(), deps.db.getGridMix()]);
  const rows = await Promise.all(
    regions.map(async (r) => {
      const point = await deps.db.regionLabelPoint(r.id);
      if (!point) return { id: r.id, peakSunHours: FALLBACK_PSH, fallback: true };
      const climate = await cachedClimatology(deps, point[1], point[0]);
      return { id: r.id, peakSunHours: climate.pshYear, ...(climate.fallback ? { fallback: true } : {}) };
    }),
  );
  return {
    costRpPerKwp: costs.costRpPerKwp,
    solarFactorKgPerKwh: costs.solarFactorKgPerKwh,
    gridSolarShare: grid.shares.surya ?? 0,
    regions: rows,
  };
}

export function scenarioRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/scenario": { GET: safe(async () => json(await scenarioBasis(deps))) },
  };
}
