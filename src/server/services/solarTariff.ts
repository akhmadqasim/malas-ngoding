import buildingTypes from "../../../data/seed/building-types.json";
import costs from "../../../data/seed/solar-costs.json";
import { fmtNumber } from "../../shared/format.ts";
import type { BuildingType } from "../../shared/types.ts";

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

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")} per kWh`;
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
  if (type === "pemerintahan") return pick("P1", "kantor pemerintah");
  const large = kwhYear > costs.largeKwhYear;
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

/** The part of the yearly load used while the sun shines (perkiraan), and the sentence that says so. */
export function daytimeShareFor(type: BuildingType | undefined): { share: number; note: string } {
  const share = type === undefined ? costs.daytimeShareUnknown : costs.daytimeShare[type];
  const who = type === undefined ? "gedung yang jenisnya tidak diketahui" : NAME[type];
  return {
    share,
    note: `Panel hanya menghemat listrik yang dipakai saat matahari bersinar: untuk ${who} sekitar ${fmtNumber(share * 100)}% dari pemakaian setahun (perkiraan). Ukuran panel mengikuti bagian itu.`,
  };
}
