/** One address or place found for a search (Mapbox Geocoding v6, forward). */
export interface GeocodeHit {
  /** The first line: the street and number, or the place name. */
  name: string;
  /** The rest of the address: district, city, province. */
  place: string;
  lng: number;
  lat: number;
  type: string;
}
export type GeocodeLookup = (query: string) => Promise<GeocodeHit[]>;

const TIMEOUT_MS = 5000;
/** Kalimantan Timur's bounding box, a little wider than its land, so searches stay in the province. */
export const KALTIM_BBOX = "113.8,-2.6,119.1,2.7";
/** Results lean toward Samarinda, the capital, when the text fits several places. */
const PROXIMITY = "117.15,-0.5";
const TYPES = "address,street,neighborhood,locality,place,district";

interface GeocodeFeature {
  geometry?: { coordinates?: unknown };
  properties?: { name?: unknown; place_formatted?: unknown; full_address?: unknown; feature_type?: unknown };
}

/**
 * Address and place search inside Kalimantan Timur, in Indonesian. Two Mapbox APIs answer together: the
 * Search Box API knows places people name their home by (housing estates, campuses, shops, mosques), and
 * Geocoding v6 knows the administrative places (kelurahan, kecamatan, cities); Mapbox has few house-level
 * addresses in Kaltim. Places come first, duplicates by name are dropped. Results are temporary: shown on
 * our Mapbox map, never stored (Mapbox terms). Throws only when both fail; messages never hold the URL.
 */
export function createGeocodeLookup(token: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): GeocodeLookup {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const call = async (path: string, params: Record<string, string>): Promise<GeocodeFeature[]> => {
    let res: Response;
    try {
      res = await doFetch(`https://api.mapbox.com${path}?${new URLSearchParams({ ...params, access_token: token })}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "Geocoding: request timed out" : "Geocoding: request failed");
    }
    if (!res.ok) throw new Error(`Geocoding: HTTP ${res.status}`);
    return ((await res.json()) as { features?: GeocodeFeature[] }).features ?? [];
  };
  return async (query) => {
    if (!token) throw new Error("Geocoding: MAPBOX_TOKEN is not set");
    const common = { q: query, bbox: KALTIM_BBOX, proximity: PROXIMITY, language: "id", limit: "5" };
    const [places, admin] = await Promise.allSettled([
      call("/search/searchbox/v1/forward", { ...common, country: "ID" }),
      call("/search/geocode/v6/forward", { ...common, country: "id", types: TYPES }),
    ]);
    if (places.status === "rejected" && admin.status === "rejected") throw admin.reason;
    const hits = [...(places.status === "fulfilled" ? hitsFrom(places.value) : []), ...(admin.status === "fulfilled" ? hitsFrom(admin.value) : [])];
    const seen = new Set<string>();
    return hits
      .filter((h) => {
        const key = `${h.name.toLowerCase()}|${h.place.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  };
}
/** Reads a Geocoding v6 answer, dropping features without a name or a point. */
export function hitsFrom(features: GeocodeFeature[]): GeocodeHit[] {
  return features.flatMap((f) => {
    const c = f.geometry?.coordinates;
    const p = f.properties;
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number" || typeof p?.name !== "string" || !p.name) return [];
    return [
      {
        name: p.name,
        place: typeof p.place_formatted === "string" ? p.place_formatted : "",
        lng: c[0],
        lat: c[1],
        type: typeof p.feature_type === "string" ? p.feature_type : "",
      },
    ];
  });
}
