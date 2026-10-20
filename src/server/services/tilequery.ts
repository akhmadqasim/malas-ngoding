export interface PoiHit {
  class: string;
  type: string;
  name: string | null;
  distanceM: number;
}
export type PoiLookup = (lng: number, lat: number) => Promise<PoiHit | null>;

const RADIUS_M = 25;
const TIMEOUT_MS = 4000;

interface TilequeryFeature {
  properties?: {
    class?: unknown;
    type?: unknown;
    name?: unknown;
    tilequery?: { distance?: unknown };
  };
}

/**
 * Nearest Mapbox Streets POI within 25 m of a point, or null when there is none.
 * Throws on network errors, timeouts and non-2xx answers; the caller decides the fallback.
 * Error messages never contain the request URL, so the token cannot leak into logs.
 */
export function createPoiLookup(
  token: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): PoiLookup {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  return async (lng, lat) => {
    if (!token) throw new Error("Tilequery: MAPBOX_TOKEN is not set");
    const url =
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?radius=${RADIUS_M}&layers=poi_label&limit=5&access_token=${encodeURIComponent(token)}`;

    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "Tilequery: request timed out" : "Tilequery: request failed");
    }
    if (!res.ok) throw new Error(`Tilequery: HTTP ${res.status}`);

    const body = (await res.json()) as { features?: TilequeryFeature[] };
    let best: PoiHit | null = null;
    for (const f of body.features ?? []) {
      const p = f.properties;
      const distance = Number(p?.tilequery?.distance);
      if (!p || typeof p.class !== "string" || !Number.isFinite(distance) || distance > RADIUS_M) continue;
      if (best && distance >= best.distanceM) continue;
      best = {
        class: p.class,
        type: typeof p.type === "string" ? p.type : "",
        name: typeof p.name === "string" && p.name ? p.name : null,
        distanceM: distance,
      };
    }
    return best;
  };
}
