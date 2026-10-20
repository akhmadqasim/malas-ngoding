import type { AppDeps } from "../../src/server/index.ts";
import type { PoiHit } from "../../src/server/services/tilequery.ts";
import type {
  BuildingType,
  EquivalentFactor,
  FuelType,
  GridMix,
  RegionSummary,
} from "../../src/shared/types.ts";

const REGION_IDS = [
  ["berau", "Berau", "kabupaten"],
  ["balikpapan", "Balikpapan", "kota"],
  ["bontang", "Bontang", "kota"],
  ["kutai-barat", "Kutai Barat", "kabupaten"],
  ["kutai-kartanegara", "Kutai Kartanegara", "kabupaten"],
  ["kutai-timur", "Kutai Timur", "kabupaten"],
  ["mahakam-ulu", "Mahakam Ulu", "kabupaten"],
  ["paser", "Paser", "kabupaten"],
  ["penajam-paser-utara", "Penajam Paser Utara", "kabupaten"],
  ["samarinda", "Samarinda", "kota"],
] as const;

export const FAKE_REGIONS: RegionSummary[] = REGION_IDS.map(([id, name, kind], i) => ({
  id,
  name,
  kind,
  kwhYear: 100_000_000 * (i + 1),
  co2KgYear: 114_000_000 * (i + 1),
  population: 100_000,
  customers: 30_000,
  electrificationPct: 99,
  villagesNoPln: null,
  estimated: true,
}));

const TYPES = Object.fromEntries(
  (
    [
      "rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus",
      "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri",
    ] as BuildingType[]
  ).map((t) => [t, { intensityKwhM2Year: 100, typicalFloors: 2, source: "asumsi" }]),
) as Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number; source: string }>;

const FUELS: FuelType[] = ["batubara", "gas", "diesel", "surya", "air", "biomassa", "lainnya"];
const GRID: GridMix = {
  year: 2023,
  factorKgPerKwh: 1.14,
  shares: Object.fromEntries(FUELS.map((f) => [f, f === "batubara" ? 1 : 0])) as Record<FuelType, number>,
  fuelFactors: Object.fromEntries(FUELS.map((f) => [f, f === "batubara" ? 1.14 : 0])) as Record<FuelType, number>,
  source: "fake",
};

const EQUIVALENTS: EquivalentFactor[] = [
  { key: "mobil_km", label: "Mobil", kgCo2PerUnit: 0.2, unit: "km" },
  { key: "motor_km", label: "Motor", kgCo2PerUnit: 0.1, unit: "km" },
  { key: "pohon", label: "Pohon", kgCo2PerUnit: 21, unit: "pohon" },
  { key: "charge_hp", label: "Isi daya HP", kgCo2PerUnit: 0.01, unit: "kali" },
  { key: "penerbangan", label: "Penerbangan", kgCo2PerUnit: 90, unit: "penerbangan" },
];

export interface FakeDeps {
  deps: AppDeps;
  /** Cache rows written so far, keyed "table:key", to assert what was (not) stored. */
  stored: Map<string, Record<string, unknown>>;
  poiCalls: Array<[number, number]>;
}

/**
 * In-memory AppDeps. Points with lng 116.5 to 118 and lat -2 to 1 count as Samarinda; anything else is
 * outside Kaltim. `poi` answers with `poiAnswer` (a hit, null, or an Error to throw).
 */
export function fakeDeps(poiAnswer: PoiHit | null | Error = null): FakeDeps {
  const stored = new Map<string, Record<string, unknown>>();
  const poiCalls: Array<[number, number]> = [];
  const deps: AppDeps = {
    db: {
      regionAt: async (lng, lat) =>
        lng >= 116.5 && lng <= 118 && lat >= -2 && lat <= 1 ? { id: "samarinda", name: "Samarinda" } : null,
      regionById: async (id) => {
        const r = FAKE_REGIONS.find((x) => x.id === id);
        return r ? { ...r, centroid: [117.15, -0.5] } : null;
      },
      listRegions: async () => FAKE_REGIONS,
      regionGeoJSON: async () => ({
        type: "FeatureCollection",
        features: FAKE_REGIONS.map((r) => ({
          type: "Feature" as const,
          properties: { ...r },
          geometry: { type: "MultiPolygon", coordinates: [] },
        })),
      }),
      getGridMix: async () => GRID,
      listPlants: async () => ({ type: "FeatureCollection", features: [] }),
      getBuildingTypes: async () => TYPES,
      getEquivalentFactors: async () => EQUIVALENTS,
      cacheGet: async (table, key) => stored.get(`${table}:${key}`) ?? null,
      cacheSet: async (table, key, payload) => {
        stored.set(`${table}:${key}`, JSON.parse(JSON.stringify(payload)));
      },
    },
    poi: async (lng, lat) => {
      poiCalls.push([lng, lat]);
      if (poiAnswer instanceof Error) throw poiAnswer;
      return poiAnswer;
    },
  };
  return { deps, stored, poiCalls };
}
