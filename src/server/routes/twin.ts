import profile from "../../../data/seed/load-profile.json";
import { type ForecastHour, witaMs } from "../../shared/pvForecast.ts";
import type { TwinBasis } from "../../shared/twin.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, json, safe } from "../http.ts";
import { cachedForecast } from "../services/cache.ts";

/** Hours the twin shows: the current WITA hour and the next 24. */
export const TWIN_HOURS = 25;
const HOUR_MS = 60 * 60 * 1000;

/** Forecast requests in flight at once. */
const CONCURRENCY = 3;

/**
 * A region whose forecast could not be read borrows the nearest region's (by label point), named in
 * `borrowedFrom`, so its sun is not silently zero; a region with neither keeps no hours.
 */
export function withNeighbourFallback(
  rows: { id: string; point: [number, number] | null; hours: ForecastHour[] }[],
): TwinBasis["regions"] {
  const have = rows.filter((r) => r.hours.length > 0 && r.point);
  return rows.map((r) => {
    if (r.hours.length > 0 || !r.point || have.length === 0) return { id: r.id, hours: r.hours };
    const [lng, lat] = r.point;
    const near = have.reduce((best, o) =>
      Math.hypot(o.point![0] - lng, o.point![1] - lat) < Math.hypot(best.point![0] - lng, best.point![1] - lat) ? o : best,
    );
    return { id: r.id, hours: near.hours, borrowedFrom: near.id };
  });
}

/** The forecast hours from the hour `nowMs` falls in, at most TWIN_HOURS of them. */
export function hoursFrom(hours: ForecastHour[], nowMs: number): ForecastHour[] {
  const start = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  return hours.filter((h) => witaMs(h.time) >= start).slice(0, TWIN_HOURS);
}

/**
 * What the twin's day needs (shared/twin.ts computes it in the browser, so playing the day needs no request
 * per hour): the Open-Meteo forecast at each region's label point from now (cached for an hour), the latest
 * grid emission factor and the daily load curve (an assumption, data/seed/load-profile.json).
 */
export async function twinBasis(deps: Pick<AppDeps, "db" | "meteo">, nowMs = Date.now()): Promise<TwinBasis> {
  const [regions, grid] = await Promise.all([deps.db.listRegions(), deps.db.getGridMix()]);
  let stale = false;
  const read = async (id: string) => {
    const point = await deps.db.regionLabelPoint(id);
    if (!point) return { id, point: null, hours: [] as ForecastHour[] };
    const forecast = await cachedForecast(deps, point[1], point[0], nowMs);
    if (!forecast || forecast.stale) stale = true;
    return { id, point, hours: forecast ? hoursFrom(forecast.hours, nowMs) : [] };
  };
  // A few at a time: Open-Meteo turns away ten requests fired at once.
  const rows: Awaited<ReturnType<typeof read>>[] = [];
  for (let i = 0; i < regions.length; i += CONCURRENCY) {
    rows.push(...(await Promise.all(regions.slice(i, i + CONCURRENCY).map((r) => read(r.id)))));
  }
  return {
    syncedAt: new Date(nowMs).toISOString(),
    stale,
    gridFactorKgPerKwh: grid.factorKgPerKwh,
    profile: { hourlyFactor: profile.hourlyFactor, source: profile.source },
    regions: withNeighbourFallback(rows),
  };
}

export function twinRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/twin": { GET: safe(async () => json(await twinBasis(deps))) },
  };
}
