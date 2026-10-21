import { simulateSolar } from "../../shared/solar.ts";
import type { SolarResult } from "../../shared/types.ts";
import costs from "../../../data/seed/solar-costs.json";
import type { AppDeps } from "../index.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { cachedClimatology } from "../services/cache.ts";

const MAX_ROOF_M2 = 50_000;
const MAX_BACKUP_HOURS = 72;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type SolarSimulation = SolarResult & {
  peakSunHours: number;
  pshByMonth: number[];
  assumptions: string[];
};

export interface SolarRequestInput {
  lat: number;
  lng: number;
  roofAreaM2: number;
  kwhYear: number;
  backupHours: number;
}

/** Validates a simulation request (the HTTP body or a chat tool input) and clamps roof and backup hours. */
export function parseSolarInput(body: unknown): { input: SolarRequestInput } | { problem: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { problem: "Data simulasi tidak valid." };
  }
  const b = body as Record<string, unknown>;
  if (!isNum(b.lat) || b.lat < -90 || b.lat > 90) return { problem: "Lintang (lat) tidak valid." };
  if (!isNum(b.lng) || b.lng < -180 || b.lng > 180) return { problem: "Bujur (lng) tidak valid." };
  if (!isNum(b.roofAreaM2) || b.roofAreaM2 <= 0) return { problem: "Luas atap (roofAreaM2) harus berupa angka lebih dari 0." };
  if (!isNum(b.kwhYear) || b.kwhYear <= 0) return { problem: "Konsumsi listrik (kwhYear) harus berupa angka lebih dari 0." };
  if (!isNum(b.backupHours) || b.backupHours < 0) return { problem: "Jam cadangan baterai (backupHours) harus berupa angka 0 atau lebih." };
  return {
    input: {
      lat: b.lat,
      lng: b.lng,
      roofAreaM2: Math.min(b.roofAreaM2, MAX_ROOF_M2),
      kwhYear: b.kwhYear,
      backupHours: Math.min(b.backupHours, MAX_BACKUP_HOURS),
    },
  };
}

/**
 * Rooftop solar for a point with the seed tariff and costs, NASA POWER sun hours (cached, with a seed
 * fallback) and the grid factor. Used by the HTTP route and the chat, so both give the same numbers.
 */
export async function simulateSolarAt(
  deps: Pick<AppDeps, "db" | "nasa">,
  { lat, lng, roofAreaM2, kwhYear, backupHours }: SolarRequestInput,
): Promise<SolarSimulation> {
  const [climate, grid] = await Promise.all([cachedClimatology(deps, lat, lng), deps.db.getGridMix()]);
  const result = simulateSolar({
    roofAreaM2,
    kwhYear,
    peakSunHours: climate.pshYear,
    backupHours,
    tariffRpPerKwh: costs.tariffs.R1_1300,
    costRpPerKwp: costs.costRpPerKwp,
    batteryRpPerKwh: costs.batteryRpPerKwh,
    gridFactorKgPerKwh: grid.factorKgPerKwh,
  });
  const assumptions = [
    `Tarif listrik Rp ${costs.tariffs.R1_1300.toLocaleString("id-ID")} per kWh (golongan R-1 1300 VA).`,
    `Biaya panel Rp ${costs.costRpPerKwp.toLocaleString("id-ID")} per kWp dan baterai Rp ${costs.batteryRpPerKwh.toLocaleString("id-ID")} per kWh (perkiraan).`,
  ];
  if (climate.fallback) assumptions.push(climate.fallback);
  return {
    ...result,
    peakSunHours: climate.pshYear,
    pshByMonth: climate.pshByMonth,
    assumptions,
  };
}

export function solarRoutes(deps: AppDeps): RouteTable {
  return {
    "/api/solar/simulate": {
      POST: safe(async (req) => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return error("Isi permintaan bukan JSON yang valid.", 400);
        }
        const parsed = parseSolarInput(body);
        if ("problem" in parsed) return error(parsed.problem, 400);
        return json(await simulateSolarAt(deps, parsed.input));
      }),
    },
  };
}
