import { fmtNumber } from "../../shared/format.ts";
import type { BuildingType, SolarResult } from "../../shared/types.ts";
import costs from "../../../data/seed/solar-costs.json";
import type { AppDeps } from "../app.ts";
import { type RouteTable, error, json, safe } from "../http.ts";
import { cachedClimatology } from "../services/cache.ts";
import { isBuildingType, simulateBuildingSolar } from "../services/solarTariff.ts";

const MAX_ROOF_M2 = 50_000;
const MAX_BACKUP_HOURS = 72;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export type SolarSimulation = SolarResult & {
  peakSunHours: number;
  pshByMonth: number[];
  assumptions: string[];
};

export interface SolarRequestInput {
  panelCount?: number;
  lat: number;
  lng: number;
  roofAreaM2: number;
  kwhYear: number;
  backupHours: number;
  /** Picks the tariff and the daytime share; without it the simulation says the type is unknown. */
  buildingType?: BuildingType;
}

/** No credit for power sent to the grid (Permen ESDM 2/2024, Art. 13). */
export const NO_EXPORT_NOTE = "Kelebihan listrik ke jaringan PLN tidak mengurangi tagihan (Permen ESDM 2/2024).";

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
  if (b.buildingType !== undefined && !isBuildingType(b.buildingType)) return { problem: "Jenis gedung (buildingType) tidak dikenal." };
  if (b.panelCount !== undefined && (!isNum(b.panelCount) || !Number.isInteger(b.panelCount) || b.panelCount < 0 || b.panelCount > 20000)) return { problem: "Jumlah panel harus bilangan bulat 0 sampai 20.000." };
  return {
    input: {
      ...(b.panelCount !== undefined ? { panelCount: b.panelCount as number } : {}),
      lat: b.lat,
      lng: b.lng,
      roofAreaM2: Math.min(b.roofAreaM2, MAX_ROOF_M2),
      kwhYear: b.kwhYear,
      backupHours: Math.min(b.backupHours, MAX_BACKUP_HOURS),
      ...(b.buildingType !== undefined ? { buildingType: b.buildingType as BuildingType } : {}),
    },
  };
}

/**
 * Rooftop solar for a point: the tariff and daytime use of the building type, the seed costs, NASA POWER
 * sun hours (cached, with a seed fallback) and the Kepmen emission factor for solar. Used by the HTTP route
 * and the chat, so both give the same numbers. Every assumption comes back as a sentence.
 */
export async function simulateSolarAt(
  deps: Pick<AppDeps, "db" | "nasa">,
  { lat, lng, roofAreaM2, kwhYear, backupHours, buildingType, panelCount }: SolarRequestInput,
): Promise<SolarSimulation> {
  const climate = await cachedClimatology(deps, lat, lng);
  const { result, tariff, use } = simulateBuildingSolar({
    panelCount,
    peakSunHours: climate.pshYear,
    roofAreaM2,
    kwhYear,
    backupHours,
    buildingType,
  });
  const assumptions = [
    tariff.note,
    ...use.notes,
    ...(panelCount === undefined ? [] : [`Jumlah ${result.panels} panel dipilih untuk pratinjau, dibatasi luas atap; bukan rekomendasi ukuran otomatis. Hanya listrik yang dipakai sendiri memberi penghematan.`]),
    NO_EXPORT_NOTE,
    `Biaya panel Rp ${costs.costRpPerKwp.toLocaleString("id-ID")} per kWp dan baterai Rp ${costs.batteryRpPerKwh.toLocaleString("id-ID")} per kWh (perkiraan).`,
  ];
  if (result.batteryKwh > 0) {
    assumptions.push(
      `Baterai hanya cadangan saat listrik padam untuk beban rata-rata gedung; tidak menambah penghematan. Tanpa baterai, balik modal ${fmtNumber(result.paybackPanelYears, 1)} tahun.`,
    );
  }
  assumptions.push(
    `CO2 yang dihindari dihitung dari listrik yang dipakai sendiri (yang masuk jaringan tidak dihitung), dengan faktor ${costs.solarFactorKgPerKwh.toLocaleString("id-ID")} kg CO2 per kWh, faktor emisi untuk PLTS di sistem Mahakam (Kepmen ESDM 163.K/2021, data 2019).`,
  );
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
