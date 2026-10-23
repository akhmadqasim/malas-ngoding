import buildingTypes from "../../../data/seed/building-types.json";
import costs from "../../../data/seed/solar-costs.json";
import { fmtNumber } from "../../shared/format.ts";
import { simulateSolar } from "../../shared/solar.ts";
import type { BuildingType, SolarResult } from "../../shared/types.ts";

/*
 * Which PLN tariff and how much daytime use a rooftop simulation assumes, by building type. Values and
 * sources live in data/seed/solar-costs.json; every choice comes back with the sentence the panel shows.
 */

export const BUILDING_TYPES = Object.keys(buildingTypes) as BuildingType[];

export function isBuildingType(v: unknown): v is BuildingType {
  return typeof v === "string" && (BUILDING_TYPES as string[]).includes(v);
}

const NAME: Record<BuildingType, string> = {
  rumah: "rumah",
  ruko: "ruko",
  kantor: "kantor",
  pemerintahan: "kantor pemerintahan",
  sekolah: "sekolah",
  kampus: "kampus",
  rumah_sakit: "rumah sakit",
  hotel: "hotel",
  mal: "mal",
  ibadah: "rumah ibadah",
  gudang: "gudang",
  industri: "industri",
};
/** Business premises: B-2, or B-3 (LWBP rate) once the load needs more than 200 kVA. */
const COMMERCIAL: readonly BuildingType[] = ["ruko", "kantor", "hotel", "mal", "gudang"];
/** Usually on the subsidised social (S) tariffs, which are not modelled (not verified from an official table). */
const SOCIAL: readonly BuildingType[] = ["sekolah", "kampus", "ibadah", "rumah_sakit"];

type TariffKey = keyof typeof costs.tariffLabels;

export interface TariffChoice {
  key: TariffKey;
  rpPerKwh: number;
  /** The assumption line, naming the golongan and the rate. */
  note: string;
}

/** Written as PLN writes its tariffs: two decimals ("Rp 1.444,70 per kWh"). */
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per kWh`;
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The tariff the saving is priced at. Rooftop PV works in daytime, outside the evening peak, so the B-3 and
 * I-3 customers are priced at their off-peak (LWBP) rate.
 */
export function chooseTariff(type: BuildingType | undefined, kwhYear: number): TariffChoice {
  const pick = (key: TariffKey, why: string): TariffChoice => {
    const rate = costs.tariffs[key];
    return { key, rpPerKwh: rate, note: `Tarif listrik ${rp(rate)} (golongan ${costs.tariffLabels[key]}, ${why}).` };
  };
  if (type === undefined) return pick("R1_1300", "jenis gedung tidak diketahui");
  if (type === "rumah") return pick("R1_1300", "rumah tangga");
  const large = kwhYear > costs.largeKwhYear;
  if (type === "pemerintahan") {
    return large ? pick("P2", "kantor pemerintah dengan pemakaian di atas 600 MWh per tahun") : pick("P1", "kantor pemerintah");
  }
  const offPeak = "harga di luar beban puncak (LWBP), jam kerja panel";
  // Industry below 200 kVA (I-2) is a subsidised class; a building drawn as industri is taken as I-3.
  if (type === "industri") return pick("I3", `industri, dianggap industri menengah; ${offPeak}`);
  if (COMMERCIAL.includes(type)) {
    return large ? pick("B3", `${NAME[type]} dengan pemakaian di atas 600 MWh per tahun; ${offPeak}`) : pick("B2", NAME[type]);
  }
  // Social: priced at the R-1 rate, and the line says why that is not the real tariff.
  const rate = costs.tariffs.R1_1300;
  return {
    key: "R1_1300",
    rpPerKwh: rate,
    note: `Tarif listrik ${rp(rate)}, setara rumah tangga 1.300 VA. ${upper(NAME[type])} biasanya memakai tarif sosial (golongan S) yang disubsidi; tarif itu belum dimodelkan, jadi penghematan sebenarnya bisa lebih kecil.`,
  };
}

/** How a building type uses power over the day and the year (perkiraan), with the sentences that say so. */
export interface UsePattern {
  /** Share of an open day's load used while the sun shines. */
  share: number;
  /** Days a year the building is in use; on the others it draws `closedDayLoadShare` of an open day's load. */
  openDays: number;
  closedDayLoadShare: number;
  notes: string[];
}

export function usePatternFor(type: BuildingType | undefined): UsePattern {
  const share = type === undefined ? costs.daytimeShareUnknown : costs.daytimeShare[type];
  const openDays = type === undefined ? 365 : costs.openDaysPerYear[type];
  const who = type === undefined ? "gedung yang jenisnya tidak diketahui" : NAME[type];
  const base = costs.closedDayLoadShare;
  const daysNote =
    openDays >= 365
      ? `${upper(who)} dianggap dipakai setiap hari, 365 hari setahun (perkiraan).`
      : `${upper(who)} dipakai sekitar ${openDays} hari setahun (perkiraan); di hari lain gedung hanya memakai beban dasar sekitar ${fmtNumber(base * 100)}% dari hari biasa, jadi listrik panel hari itu yang melebihi beban dasar masuk jaringan tanpa imbalan.`;
  return {
    share,
    openDays,
    closedDayLoadShare: base,
    notes: [
      `Panel hanya menghemat listrik yang dipakai saat matahari bersinar: untuk ${who} sekitar ${fmtNumber(share * 100)}% dari pemakaian sehari (perkiraan). Ukuran panel mengikuti pemakaian siang setahun.`,
      daysNote,
    ],
  };
}

/** A rooftop simulation for a building type, with the tariff and use pattern it was priced with. */
export interface BuildingSolar {
  result: SolarResult;
  tariff: TariffChoice;
  use: UsePattern;
}

/**
 * Rooftop PV for a building of a type at the given peak sun hours: its tariff, its daytime use and open days,
 * the seed costs and the Kepmen emission factor for solar (1,13). The Surya tab (through the solar route),
 * the chat and the region card all price PV here, so one building type gives one payback everywhere.
 */
export function simulateBuildingSolar(input: {
  peakSunHours: number;
  roofAreaM2: number;
  kwhYear: number;
  backupHours: number;
  buildingType?: BuildingType;
}): BuildingSolar {
  const tariff = chooseTariff(input.buildingType, input.kwhYear);
  const use = usePatternFor(input.buildingType);
  const result = simulateSolar({
    roofAreaM2: input.roofAreaM2,
    kwhYear: input.kwhYear,
    peakSunHours: input.peakSunHours,
    backupHours: input.backupHours,
    tariffRpPerKwh: tariff.rpPerKwh,
    costRpPerKwp: costs.costRpPerKwp,
    batteryRpPerKwh: costs.batteryRpPerKwh,
    gridFactorKgPerKwh: costs.solarFactorKgPerKwh,
    daytimeShare: use.share,
    openDaysPerYear: use.openDays,
    closedDayLoadShare: use.closedDayLoadShare,
  });
  return { result, tariff, use };
}
