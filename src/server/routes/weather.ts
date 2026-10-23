import { type ForecastHour, isRainyHour, pvFromForecast, summariseDays, witaMs } from "../../shared/pvForecast.ts";
import type { PvHour } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { cachedForecast } from "../services/cache.ts";


export interface CurrentConditions {
  raining: boolean;
  cloudPct: number;
  precipMm: number;
  isDay: boolean;
}

/** Conditions from the forecast hour nearest to `nowMs`. It is daytime when that hour has sunshine. */
export function currentConditions(hours: ForecastHour[], nowMs: number): CurrentConditions {
  let best: ForecastHour | undefined;
  let bestGap = Infinity;
  for (const h of hours) {
    const gap = Math.abs(witaMs(h.time) - nowMs);
    if (gap < bestGap) {
      best = h;
      bestGap = gap;
    }
  }
  if (!best) return { raining: false, cloudPct: 0, precipMm: 0, isDay: false };
  return {
    raining: isRainyHour(best),
    cloudPct: best.cloudPct,
    precipMm: best.precipMm,
    isDay: best.ghiWm2 > 0,
  };
}

export function weatherRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/weather": {
      GET: safe(async (req) => {
        const q = new URL(req.url).searchParams;
        // Number("") is 0, so an empty or missing parameter must be rejected before converting.
        const read = (name: string) => (q.get(name)?.trim() ? Number(q.get(name)) : NaN);
        const lat = read("lat");
        const lng = read("lng");
        const kWp = read("kWp");
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) return error("Lintang (lat) tidak valid.", 400);
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) return error("Bujur (lng) tidak valid.", 400);
        if (!Number.isFinite(kWp) || kWp < 0) return error("Kapasitas panel (kWp) harus berupa angka 0 atau lebih.", 400);

        const nowMs = Date.now();
        const forecast = await cachedForecast(deps, lat, lng, nowMs);
        if (!forecast) return error("Prakiraan cuaca sedang tidak tersedia", 503);

        const hours: PvHour[] = pvFromForecast(forecast.hours, kWp);
        return json({
          hours,
          days: summariseDays(hours),
          current: currentConditions(forecast.hours, nowMs),
          stale: forecast.stale,
        });
      }),
    },
  };
}
