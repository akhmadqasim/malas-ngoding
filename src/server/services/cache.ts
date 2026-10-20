import type { BuildingInput } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import type { PoiHit } from "./tilequery.ts";

/** POI cache key: coordinates rounded to 5 decimals (about 1 m). */
export function poiCacheKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Estimate cache key: the feature, the user overrides, the footprint (nearest m2) and the client POI
 * class. A changed footprint or POI for the same feature id therefore recomputes.
 */
export function estimateCacheKey(
  input: Pick<BuildingInput, "featureId" | "typeOverride" | "floorsOverride" | "footprintM2" | "poiClass">,
): string {
  return [
    input.featureId,
    input.typeOverride ?? "",
    input.floorsOverride ?? "",
    Math.round(input.footprintM2),
    input.poiClass ?? "",
  ].join("|");
}

function warn(what: string, err: unknown): void {
  console.warn(`${what}:`, err instanceof Error ? err.message : "unknown error");
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
  } catch (err) {
    // A broken cache must not break the estimate; fall through to the live lookup.
    warn("poi cache read failed", err);
  }
  let poi: PoiHit | null;
  try {
    poi = await deps.poi(lng, lat);
  } catch (err) {
    warn("poi lookup failed", err);
    return { poi: null, degraded: true };
  }
  try {
    await deps.db.cacheSet("poi_cache", key, { poi });
  } catch (err) {
    // The result is still valid, it just is not stored.
    warn("poi cache write failed", err);
  }
  return { poi, degraded: false };
}
