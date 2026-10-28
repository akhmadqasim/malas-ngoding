import type { AppDeps } from "../index.ts";
import type { WindResponse } from "../../shared/wind.ts";
import { witaMs } from "../../shared/pvForecast.ts";
import { weatherKey } from "../services/openMeteo.ts";
import { type RouteTable, error, json, safe } from "../http.ts";

/** One-minute bounded cache and request coalescing; failure never labels old wind as fresh. */
export function windRoutes(deps: AppDeps): RouteTable {
  const cache = new Map<string, WindResponse>();
  const inflight = new Map<string, Promise<WindResponse>>();
  return { "/api/wind": { GET: safe(async req => {
    const params = new URL(req.url).searchParams;
    const lat = params.get("lat")?.trim() ? Number(params.get("lat")) : NaN;
    const lng = params.get("lng")?.trim() ? Number(params.get("lng")) : NaN;
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return error("Koordinat angin tidak valid.", 400);
    const key = weatherKey(lat, lng), now = Date.now();
    const saved = cache.get(key);
    if (saved && now - Date.parse(saved.fetchedAt) < 60_000 && now - witaMs(saved.current.wind.time) < 45 * 60_000) return json(saved);
    if (!deps.wind) return error("Sumber angin belum tersedia.", 503);
    try {
      let pending = inflight.get(key);
      if (!pending) {
        pending = deps.wind(lat, lng).then(wind => {
          const result: WindResponse = { current: { wind }, stale: false, fetchedAt: new Date().toISOString(), source: "Open-Meteo" };
          if (cache.size >= 256) cache.delete(cache.keys().next().value!);
          cache.set(key, result);
          return result;
        }).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return json(await pending);
    } catch {
      if (saved && now - witaMs(saved.current.wind.time) <= 45 * 60_000) return json({ ...saved, stale: true });
      return error("Angin terkini tidak tersedia. Mencoba kembali otomatis.", 503);
    }
  }) } };
}
