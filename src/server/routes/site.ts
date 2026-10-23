import { offset } from "../../shared/buildSite.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { isClear, type SiteCheck } from "../services/siteCheck.ts";

/** Rings searched around the point asked for, km, and the directions on each ring. */
export const RINGS_KM = [0, 1.5, 3, 5, 8, 12, 16, 20, 25];
const BEARINGS = 8;
const MAX_RADIUS_M = 3000;

export interface SiteAnswer {
  /** The spot chosen: the point asked for when it is clear, else the nearest clear spot found. */
  at: [number, number];
  movedKm: number;
  /** False when no clear spot was found within the rings; `at` is then the point asked for. */
  clear: boolean;
  /** What is at the point asked for. */
  asked: SiteCheck;
}

/** The spots tried, nearest first: the point itself, then each ring all the way round. */
export function candidates(at: [number, number]): { at: [number, number]; km: number }[] {
  return RINGS_KM.flatMap((km) =>
    km === 0
      ? [{ at, km }]
      : Array.from({ length: BEARINGS }, (_, i) => {
          const a = (i / BEARINGS) * 2 * Math.PI;
          return { at: offset(at, Math.sin(a) * km * 1000, Math.cos(a) * km * 1000), km };
        }),
  );
}

/**
 * Finds a spot for a farm of radius `radiusM` near `at` that has no buildings, no settled land use and no
 * water within that radius (Mapbox Streets via Tilequery) and lies in Kalimantan Timur. One ring at a time,
 * its spots checked together; the first clear spot of the nearest ring wins.
 */
export async function findSite(deps: Pick<AppDeps, "site" | "db">, at: [number, number], radiusM: number): Promise<SiteAnswer> {
  const r = Math.min(Math.max(radiusM, 50), MAX_RADIUS_M);
  const all = candidates(at);
  let asked: SiteCheck | null = null;
  for (const km of RINGS_KM) {
    const ring = all.filter((c) => c.km === km);
    const checks = await Promise.all(
      ring.map(async (c) => {
        const [check, region] = await Promise.all([deps.site(c.at[0], c.at[1], r), deps.db.regionAt(c.at[0], c.at[1])]);
        return { ...c, check, inKaltim: region !== null };
      }),
    );
    if (km === 0) asked = checks[0]!.check;
    const hit = checks.find((c) => c.inKaltim && isClear(c.check));
    if (hit) return { at: hit.at, movedKm: hit.km, clear: true, asked: asked! };
  }
  return { at, movedKm: 0, clear: false, asked: asked! };
}

export function siteRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/site": {
      GET: safe(async (req) => {
        const q = new URL(req.url).searchParams;
        const read = (name: string) => (q.get(name)?.trim() ? Number(q.get(name)) : Number.NaN);
        const lng = read("lng");
        const lat = read("lat");
        const radius = read("radius");
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) return error("Lintang (lat) tidak valid.", 400);
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) return error("Bujur (lng) tidak valid.", 400);
        if (!Number.isFinite(radius) || radius <= 0) return error("Radius (radius) harus berupa angka lebih dari 0.", 400);
        try {
          return json(await findSite(deps, [lng, lat], radius));
        } catch {
          return error("Pengecekan lokasi ke Mapbox sedang gagal. Coba lagi sebentar lagi.", 503);
        }
      }),
    },
  };
}
