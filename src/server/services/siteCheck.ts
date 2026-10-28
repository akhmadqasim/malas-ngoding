/** What Mapbox Streets shows within a radius of a point: what a farm must not be built on. */
export interface SiteCheck {
  /** Building footprints within the radius (Tilequery returns at most 50). */
  buildings: number;
  /** Land use that is people's: housing, shops, industry, schools, hospitals, cemeteries. */
  settlement: boolean;
  /** Sea, lakes or rivers. */
  water: boolean;
  /** National parks and wetlands (swamp, peat), Mapbox Streets `landuse_overlay`. */
  protectedLand: boolean;
}
export type SiteLookup = (lng: number, lat: number, radiusM: number) => Promise<SiteCheck>;

const TIMEOUT_MS = 5000;
/** Mapbox Streets v8 `landuse` classes that mean people live or work there. */
const SETTLED = new Set(["residential", "commercial_area", "industrial", "school", "hospital", "cemetery", "parking", "airport"]);
/** Mapbox Streets v8 `landuse_overlay` classes a farm must stay out of. */
const PROTECTED = new Set(["national_park", "wetland", "wetland_noveg"]);

interface TilequeryFeature {
  properties?: { class?: unknown; tilequery?: { layer?: unknown } };
}

/**
 * Checks a farm site with the Mapbox Tilequery API on Mapbox Streets v8 (layers building, landuse,
 * landuse_overlay and water). Throws on network errors, timeouts and non-2xx answers; messages never contain the URL, so the
 * token cannot leak into logs.
 */
export function createSiteLookup(token: string, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): SiteLookup {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  return async (lng, lat, radiusM) => {
    if (!token) throw new Error("Tilequery: MAPBOX_TOKEN is not set");
    const url =
      `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
      `?radius=${Math.round(radiusM)}&layers=building,landuse,landuse_overlay,water&limit=50&access_token=${encodeURIComponent(token)}`;
    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "Tilequery: request timed out" : "Tilequery: request failed");
    }
    if (!res.ok) throw new Error(`Tilequery: HTTP ${res.status}`);
    const body = (await res.json()) as { features?: TilequeryFeature[] };
    return checkFrom(body.features ?? []);
  };
}

/** Reads a Tilequery answer into a site check. */
export function checkFrom(features: TilequeryFeature[]): SiteCheck {
  let buildings = 0;
  let settlement = false;
  let water = false;
  let protectedLand = false;
  for (const f of features) {
    const layer = f.properties?.tilequery?.layer;
    if (layer === "building") buildings++;
    else if (layer === "water") water = true;
    else if (layer === "landuse" && typeof f.properties?.class === "string" && SETTLED.has(f.properties.class)) settlement = true;
    else if (layer === "landuse_overlay" && typeof f.properties?.class === "string" && PROTECTED.has(f.properties.class)) protectedLand = true;
  }
  return { buildings, settlement, water, protectedLand };
}

/** A site is clear when nothing people use or water is within the radius. */
export const isClear = (c: SiteCheck) => c.buildings === 0 && !c.settlement && !c.water && !c.protectedLand;
