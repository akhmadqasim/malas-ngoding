import costs from "../../../data/seed/solar-costs.json";
import type { HomeAnswer, HomeInput } from "../../shared/auth.ts";
import { estimateBuilding } from "../../shared/estimate.ts";
import { simulateSolar } from "../../shared/solar.ts";
import type { BuildingType } from "../../shared/types.ts";
import type { HomeSave } from "../db.ts";
import { type Handler, error, failure, json } from "../http.ts";
import type { AppDeps } from "../index.ts";
import { isObject, readJson, requireRole, sameOriginProblem } from "../services/session.ts";

const BUILDING_TYPES: readonly BuildingType[] = [
  "rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus",
  "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri",
];

// The same limits the building estimate applies to a footprint and floors.
const MIN_FOOTPRINT_M2 = 10;
const MAX_FOOTPRINT_M2 = 50_000;
const MAX_FLOORS = 40;
const MAX_HEIGHT_M = 1000;
const MAX_KWH_MONTH = 10_000_000;
const MAX_BILL_RP_MONTH = 10_000_000_000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A number, or null for a missing value; undefined when something else was sent. */
const optNum = (v: unknown): number | null | undefined => (v === undefined || v === null ? null : isNum(v) ? v : undefined);

/** Validates the PUT body; returns the input or a message for the 400 response. */
export function parseHomeInput(body: unknown): { input: HomeInput } | { problem: string } {
  if (!isObject(body)) return { problem: "Data rumah tidak valid." };
  if (typeof body.featureId !== "string" || body.featureId.length === 0 || body.featureId.length > 200) {
    return { problem: "featureId harus berupa teks." };
  }
  if (!isNum(body.lng) || body.lng < -180 || body.lng > 180) return { problem: "Bujur (lng) tidak valid." };
  if (!isNum(body.lat) || body.lat < -90 || body.lat > 90) return { problem: "Lintang (lat) tidak valid." };
  if (!isNum(body.footprintM2) || body.footprintM2 < MIN_FOOTPRINT_M2 || body.footprintM2 > MAX_FOOTPRINT_M2) {
    return { problem: `Luas lantai dasar (footprintM2) harus berupa angka ${MIN_FOOTPRINT_M2} sampai ${MAX_FOOTPRINT_M2.toLocaleString("id-ID")} m2.` };
  }
  const heightM = optNum(body.heightM);
  if (heightM === undefined || (heightM !== null && (heightM < 0 || heightM > MAX_HEIGHT_M))) {
    return { problem: "Tinggi bangunan (heightM) harus berupa angka 0 sampai 1.000 atau null." };
  }
  if (typeof body.buildingType !== "string" || !BUILDING_TYPES.includes(body.buildingType as BuildingType)) {
    return { problem: "Jenis bangunan (buildingType) tidak dikenal." };
  }
  if (!isNum(body.floors) || !Number.isInteger(body.floors) || body.floors < 1 || body.floors > MAX_FLOORS) {
    return { problem: `Jumlah lantai (floors) harus berupa bilangan bulat 1 sampai ${MAX_FLOORS}.` };
  }
  const kwhMonth = optNum(body.kwhMonth);
  if (kwhMonth === undefined || (kwhMonth !== null && (kwhMonth <= 0 || kwhMonth > MAX_KWH_MONTH))) {
    return { problem: "Listrik per bulan (kwhMonth) harus berupa angka lebih dari 0 atau null." };
  }
  const billRpMonth = optNum(body.billRpMonth);
  if (billRpMonth === undefined || (billRpMonth !== null && (billRpMonth <= 0 || billRpMonth > MAX_BILL_RP_MONTH))) {
    return { problem: "Tagihan per bulan (billRpMonth) harus berupa angka lebih dari 0 atau null." };
  }
  if (typeof body.interestedPv !== "boolean") return { problem: "interestedPv harus berupa true atau false." };
  if (body.installedPv !== undefined && typeof body.installedPv !== "boolean") return { problem: "installedPv harus berupa true atau false." };
  const installedPv = body.installedPv ?? false;
  const installedKwp = optNum(body.installedKwp);
  if (installedKwp === undefined || (installedKwp !== null && (!installedPv || installedKwp <= 0 || installedKwp > 10000))) {
    return { problem: "Kapasitas PLTS terpasang harus lebih dari 0 sampai 10.000 kWp, dan status sudah terpasang harus dicentang. Kosongkan jika belum diketahui." };
  }
  if (typeof body.consentMap !== "boolean") return { problem: "consentMap harus berupa true atau false." };
  return {
    input: {
      featureId: body.featureId,
      lng: body.lng,
      lat: body.lat,
      footprintM2: body.footprintM2,
      heightM,
      buildingType: body.buildingType as BuildingType,
      floors: body.floors,
      kwhMonth,
      billRpMonth,
      interestedPv: body.interestedPv,
      installedPv,
      installedKwp,
      consentMap: body.consentMap,
    },
  };
}

/**
 * The most rooftop PV a roof holds, kWp: whole panels on 60% of the roof at 5.5 m2 per kWp. It asks
 * `simulateSolar` with a load far above any roof, so the answer is the roof's limit and the constants stay
 * in src/shared/solar.ts only.
 */
export function roofPotentialKwp(roofAreaM2: number): number {
  return simulateSolar({
    roofAreaM2,
    kwhYear: 1e12,
    peakSunHours: 5,
    backupHours: 0,
    tariffRpPerKwh: 0,
    costRpPerKwp: 0,
    batteryRpPerKwh: 0,
    gridFactorKgPerKwh: 0,
  }).kWp;
}

/**
 * Works out what a saved home holds: its region, yearly electricity and the rooftop PV its roof could take.
 * Yearly kWh comes from the bill when the resident gave one (kWh a month x 12, or the rupiah bill divided
 * by the household tariff R-1/1.300 VA), otherwise from the building model.
 */
export async function buildHome(
  deps: Pick<AppDeps, "db">,
  input: HomeInput,
): Promise<{ home: HomeSave } | { problem: string }> {
  const region = await deps.db.regionAt(input.lng, input.lat);
  if (!region) return { problem: "Lokasi rumah berada di luar Kalimantan Timur." };

  let kwhYear: number;
  let kwhSource: HomeSave["kwhSource"];
  if (input.kwhMonth !== null) {
    kwhYear = input.kwhMonth * 12;
    kwhSource = "tagihan";
  } else if (input.billRpMonth !== null) {
    kwhYear = (input.billRpMonth * 12) / costs.tariffs.R1_1300;
    kwhSource = "tagihan";
  } else {
    const [types, grid, equivalents] = await Promise.all([
      deps.db.getBuildingTypes(),
      deps.db.getGridMix(),
      deps.db.getEquivalentFactors(),
    ]);
    kwhYear = estimateBuilding(
      {
        featureId: input.featureId,
        lng: input.lng,
        lat: input.lat,
        footprintM2: input.footprintM2,
        heightM: input.heightM,
        typeOverride: input.buildingType,
        floorsOverride: input.floors,
      },
      { types, grid, equivalents, region },
    ).kwhYear;
    kwhSource = "perkiraan";
  }

  return {
    home: {
      ...input,
      regionId: region.id,
      kwhYear,
      kwhSource,
      potentialKwp: roofPotentialKwp(input.footprintM2),
    },
  };
}

type HomeRoutes = Record<string, Partial<Record<"GET" | "PUT" | "DELETE", Handler>>>;

/** Wraps a handler in the friendly 500 so no request ends in an unhandled rejection. */
function safely(handler: Handler): Handler {
  return async (req, server) => {
    try {
      return await handler(req, server);
    } catch (err) {
      console.error(`${req.method} ${new URL(req.url).pathname} failed:`, err instanceof Error ? err.message : "unknown error");
      return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
    }
  };
}

/** The resident's own home. Signed out: 401. Signed in as another role: 403. */
export function homeRoutes(deps: AppDeps): HomeRoutes {
  return {
    "/api/me/home": {
      GET: safely(async (req) => {
        const auth = await requireRole(deps.db, req, "warga");
        if ("res" in auth) return auth.res;
        const answer: HomeAnswer = { home: await deps.db.homeGet(auth.user.id) };
        return json(answer);
      }),
      PUT: safely(async (req) => {
        const origin = sameOriginProblem(req);
        if (origin) return origin;
        const auth = await requireRole(deps.db, req, "warga");
        if ("res" in auth) return auth.res;
        const body = await readJson(req);
        if ("res" in body) return body.res;
        const parsed = parseHomeInput(body.body);
        if ("problem" in parsed) return error(parsed.problem, 400);
        const built = await buildHome(deps, parsed.input);
        if ("problem" in built) return error(built.problem, 400);
        const answer: HomeAnswer = { home: await deps.db.homeUpsert(auth.user.id, built.home) };
        return json(answer);
      }),
      DELETE: safely(async (req) => {
        const origin = sameOriginProblem(req);
        if (origin) return origin;
        const auth = await requireRole(deps.db, req, "warga");
        if ("res" in auth) return auth.res;
        // The report keeps its own snapshot, but verifying it writes back to this home.
        if (await deps.db.applicationActiveFor(auth.user.id)) {
          return failure({ status: 409, code: "active_application_exists", message: "Rumah tidak dapat dihapus selama laporan pemasangan masih diproses." });
        }
        await deps.db.homeDelete(auth.user.id);
        return new Response(null, { status: 204 });
      }),
    },
  };
}
