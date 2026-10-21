import type { BuildingInput } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import type { ForecastHour } from "../../shared/pvForecast.ts";
import { climatologyKey, type Climatology } from "./nasaPower.ts";
import { weatherKey } from "./openMeteo.ts";
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

const inflight = new Map<string, Promise<unknown>>();

/**
 * Runs `start` once per key at a time: callers that arrive while a call for the same key is still running
 * share its result (or its failure) instead of sending the same upstream request again.
 */
function once<T>(key: string, start: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = start().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
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

/** Peak sun hours used when NASA POWER is down and nothing is cached. */
export const FALLBACK_PSH = 4.2;
const FALLBACK_NOTE = `Data radiasi matahari NASA POWER sedang tidak tersedia, jadi dipakai asumsi ${FALLBACK_PSH.toLocaleString("id-ID")} jam puncak matahari per hari (perkiraan).`;

const WEATHER_TTL_MS = 60 * 60 * 1000;

/**
 * NASA POWER climatology for a point, read through `solar_climatology` (it never expires: it is a
 * 25-year average). When the live call fails and nothing is cached, returns the seed value with a
 * `fallback` note; that result is not stored. Never throws.
 */
export async function cachedClimatology(
  deps: Pick<AppDeps, "db" | "nasa">,
  lat: number,
  lng: number,
): Promise<Climatology & { fallback?: string }> {
  const key = climatologyKey(lat, lng);
  try {
    const hit = await deps.db.climatologyGet(key);
    if (hit) return hit;
  } catch (err) {
    warn("climatology cache read failed", err);
  }
  let fresh: Climatology;
  try {
    fresh = await once(`nasa:${key}`, () => deps.nasa(lat, lng));
  } catch (err) {
    warn("nasa power lookup failed", err);
    return { pshByMonth: Array<number>(12).fill(FALLBACK_PSH), pshYear: FALLBACK_PSH, fallback: FALLBACK_NOTE };
  }
  try {
    await deps.db.climatologySet(key, lat, lng, fresh);
  } catch (err) {
    warn("climatology cache write failed", err);
  }
  return fresh;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isForecastHour(v: unknown): v is ForecastHour {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.time === "string" &&
    isFiniteNumber(h.ghiWm2) &&
    isFiniteNumber(h.cloudPct) &&
    isFiniteNumber(h.precipMm) &&
    isFiniteNumber(h.weatherCode)
  );
}

/** The cached forecast hours, or null when the payload is missing, empty or not made of valid hours. */
function asHours(payload: Record<string, unknown> | undefined): ForecastHour[] | null {
  const hours = payload?.hours;
  return Array.isArray(hours) && hours.length > 0 && hours.every(isForecastHour) ? hours : null;
}

/**
 * Seven-day forecast for a point, read through `weather_cache` (fresh for one hour).
 * When the live call fails, a cached forecast of any age is returned with `stale: true`.
 * Returns null only when the live call fails and nothing is cached. Never throws.
 */
export async function cachedForecast(
  deps: Pick<AppDeps, "db" | "meteo">,
  lat: number,
  lng: number,
  nowMs = Date.now(),
): Promise<{ hours: ForecastHour[]; stale: boolean } | null> {
  const key = weatherKey(lat, lng);
  let cached: { hours: ForecastHour[]; fetchedAt: Date } | null = null;
  try {
    const row = await deps.db.cacheGetAged("weather_cache", key);
    const hours = asHours(row?.payload);
    if (row && hours) cached = { hours, fetchedAt: row.fetchedAt };
  } catch (err) {
    warn("weather cache read failed", err);
  }
  if (cached && nowMs - cached.fetchedAt.getTime() < WEATHER_TTL_MS) {
    return { hours: cached.hours, stale: false };
  }
  try {
    const hours = await once(`meteo:${key}`, () => deps.meteo(lat, lng));
    if (hours.length === 0) throw new Error("empty forecast");
    try {
      await deps.db.cacheSet("weather_cache", key, { hours });
    } catch (err) {
      warn("weather cache write failed", err);
    }
    return { hours, stale: false };
  } catch (err) {
    warn("open-meteo lookup failed", err);
    return cached ? { hours: cached.hours, stale: true } : null;
  }
}
