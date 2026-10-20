import type { BuildingInput } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import type { PoiHit } from "./tilequery.ts";

/** POI cache key: coordinates rounded to 5 decimals (about 1 m). */
export function poiCacheKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/** Estimate cache key: the feature plus the user overrides that change the result. */
export function estimateCacheKey(input: Pick<BuildingInput, "featureId" | "typeOverride" | "floorsOverride">): string {
  return `${input.featureId}|${input.typeOverride ?? ""}|${input.floorsOverride ?? ""}`;
}

/**
 * Nearest POI for a point, read through `poi_cache`. "No POI here" is cached too.
 * When the live lookup fails (timeout, upstream down) `poi` is null, `degraded` is true and
 * nothing is cached, so callers can avoid storing a result built without POI data.
 */
export async function cachedPoi(
  deps: Pick<AppDeps, "db" | "poi">,
  lng: number,
  lat: number,
): Promise<{ poi: PoiHit | null; degraded: boolean }> {
  const key = poiCacheKey(lng, lat);
  try {
    const hit = await deps.db.cacheGet("poi_cache", key);
    if (hit) return { poi: (hit.poi as PoiHit | null) ?? null, degraded: false };
  } catch {
    // A broken cache must not break the estimate; fall through to the live lookup.
  }
  let poi: PoiHit | null;
  try {
    poi = await deps.poi(lng, lat);
  } catch {
    return { poi: null, degraded: true };
  }
  try {
    await deps.db.cacheSet("poi_cache", key, { poi });
  } catch {
    // Ignore: the result is still valid, it just is not stored.
  }
  return { poi, degraded: false };
}
