import { estimateBuilding } from "../../shared/estimate.ts";
import type { BuildingEstimate, BuildingInput, BuildingType } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { cachedPoi, estimateCacheKey } from "../services/cache.ts";

const BUILDING_TYPES: readonly BuildingType[] = [
  "rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus",
  "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri",
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isOptStr = (v: unknown) => v === undefined || v === null || typeof v === "string";

/** Validates the request body; returns the input or a message for the 400 response. */
function parseInput(body: unknown): { input: BuildingInput } | { problem: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { problem: "Data bangunan tidak valid." };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.featureId !== "string" || b.featureId.length === 0 || b.featureId.length > 200) {
    return { problem: "featureId harus berupa teks." };
  }
  if (!isNum(b.lng) || b.lng < -180 || b.lng > 180) return { problem: "Bujur (lng) tidak valid." };
  if (!isNum(b.lat) || b.lat < -90 || b.lat > 90) return { problem: "Lintang (lat) tidak valid." };
  if (!isNum(b.footprintM2)) return { problem: "Luas lantai dasar (footprintM2) harus berupa angka." };
  if (b.heightM !== undefined && b.heightM !== null && !isNum(b.heightM)) {
    return { problem: "Tinggi bangunan (heightM) harus berupa angka atau null." };
  }
  if (!isOptStr(b.poiClass) || !isOptStr(b.poiType)) return { problem: "poiClass dan poiType harus berupa teks." };
  if (b.typeOverride !== undefined && !BUILDING_TYPES.includes(b.typeOverride as BuildingType)) {
    return { problem: "Jenis bangunan (typeOverride) tidak dikenal." };
  }
  if (b.floorsOverride !== undefined && !isNum(b.floorsOverride)) {
    return { problem: "Jumlah lantai (floorsOverride) harus berupa angka." };
  }
  return {
    input: {
      featureId: b.featureId,
      lng: b.lng,
      lat: b.lat,
      footprintM2: b.footprintM2,
      heightM: (b.heightM as number | null | undefined) ?? null,
      poiClass: b.poiClass as string | null | undefined,
      poiType: b.poiType as string | null | undefined,
      typeOverride: b.typeOverride as BuildingType | undefined,
      floorsOverride: b.floorsOverride as number | undefined,
    },
  };
}

export function buildingRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/buildings/estimate": {
      POST: safe(async (req) => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return error("Isi permintaan bukan JSON yang valid.", 400);
        }
        const parsed = parseInput(body);
        if ("problem" in parsed) return error(parsed.problem, 400);
        const { input } = parsed;

        const cacheKey = estimateCacheKey(input);
        const cached = await deps.db.cacheGet("building_estimates", cacheKey);
        if (cached) return json(cached as unknown as BuildingEstimate);

        // A user-chosen type or a client-supplied POI makes the Tilequery call unnecessary.
        let degraded = false;
        if (!input.typeOverride && !input.poiClass) {
          const found = await cachedPoi(deps, input.lng, input.lat);
          degraded = found.degraded;
          if (found.poi) {
            input.poiClass = found.poi.class;
            input.poiType = found.poi.type;
          }
        }

        const [region, types, grid, equivalents] = await Promise.all([
          deps.db.regionAt(input.lng, input.lat),
          deps.db.getBuildingTypes(),
          deps.db.getGridMix(),
          deps.db.getEquivalentFactors(),
        ]);
        const estimate = estimateBuilding(input, { types, grid, equivalents, region });
        // Do not store an estimate built while Tilequery was down; the next call should retry it.
        if (!degraded) {
          await deps.db.cacheSet(
            "building_estimates",
            cacheKey,
            estimate as unknown as Record<string, unknown>,
            input as unknown as Record<string, unknown>,
          );
        }
        return json(estimate);
      }),
    },
  };
}
