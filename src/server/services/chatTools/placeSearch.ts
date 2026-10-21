import { KALTIM_AREA } from "./common.ts";

/** One place from the Mapbox Search Box category search. */
export interface PlaceHit {
  name: string;
  lng: number;
  lat: number;
  /** Street address with the city, or just the city when Mapbox has no street. */
  address: string | null;
  /** Metres from the point the search was near, when Mapbox says. */
  distanceM: number | null;
}

export interface PlaceQuery {
  /** A Mapbox canonical category id, for example "school". */
  category: string;
  /** Bias the results towards this point, [lng, lat]. Results always stay inside Kalimantan Timur. */
  near: [number, number];
  /** At most 25 (the API's limit). */
  limit: number;
  /** Canonical category ids to leave out, for example "driving_school" when looking for schools. */
  exclude?: string[];
}

/** Places of a category near a point, nearest first. Throws when the upstream fails. */
export type PlaceSearch = (query: PlaceQuery) => Promise<PlaceHit[]>;

const ENDPOINT = "https://api.mapbox.com/search/searchbox/v1/category/";
const TIMEOUT_MS = 5000;
const MAX_LIMIT = 25;
/** Places change slowly; an hour keeps a repeated demo question fast without a database table. */
const TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 200;
const CATEGORY_ID = /^[a-z_]{1,60}$/;

interface SearchFeature {
  geometry?: { coordinates?: unknown };
  properties?: { name?: unknown; full_address?: unknown; place_formatted?: unknown; distance?: unknown };
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

function toHit(f: SearchFeature): PlaceHit | null {
  const name = text(f.properties?.name);
  const coords = f.geometry?.coordinates;
  if (!name || !Array.isArray(coords)) return null;
  const [lng, lat] = coords as unknown[];
  if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const distance = f.properties?.distance;
  return {
    name,
    lng,
    lat,
    address: text(f.properties?.full_address) ?? text(f.properties?.place_formatted),
    distanceM: typeof distance === "number" && Number.isFinite(distance) ? distance : null,
  };
}

/**
 * The Mapbox Search Box category search (POIs by category), limited to Kalimantan Timur, in Indonesian,
 * with answers kept in memory for an hour. Error messages never contain the request URL, so the token
 * cannot leak into logs.
 */
export function createPlaceSearch(
  token: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): PlaceSearch {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; hits: PlaceHit[] }>();

  return async ({ category, near, limit, exclude = [] }) => {
    if (!token) throw new Error("Place search: MAPBOX_TOKEN is not set");
    if (!CATEGORY_ID.test(category) || !exclude.every((c) => CATEGORY_ID.test(c))) {
      throw new Error("Place search: invalid category id");
    }
    const size = Math.max(1, Math.min(MAX_LIMIT, Math.round(limit)));
    const [lng, lat] = near;
    // About 100 m: close enough to be the same question.
    const key = [category, lng.toFixed(3), lat.toFixed(3), size, exclude.join(",")].join("|");
    const kept = cache.get(key);
    if (kept && now() - kept.at < TTL_MS) return kept.hits;

    const a = KALTIM_AREA;
    const params = new URLSearchParams({
      language: "id",
      country: "id",
      limit: String(size),
      proximity: `${lng},${lat}`,
      bbox: `${a.minLng},${a.minLat},${a.maxLng},${a.maxLat}`,
    });
    if (exclude.length > 0) params.set("poi_category_exclusions", exclude.join(","));
    params.set("access_token", token);

    let res: Response;
    try {
      res = await doFetch(`${ENDPOINT}${category}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "Place search: request timed out" : "Place search: request failed");
    }
    if (!res.ok) throw new Error(`Place search: HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { features?: unknown } | null;
    // An answer that cannot be read is a failure, not "nothing found" (which would be kept for an hour).
    if (!body || !Array.isArray(body.features)) throw new Error("Place search: unreadable answer");
    const hits = (body.features as SearchFeature[]).map(toHit).filter((h): h is PlaceHit => h !== null);

    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now(), hits });
    return hits;
  };
}
