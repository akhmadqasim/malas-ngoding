import { describe, expect, test } from "bun:test";
import { estimateBuilding, estimateFloors, inferType } from "../../src/shared/estimate.ts";
import type { BuildingInput, BuildingType, EquivalentFactor, FuelType, GridMix } from "../../src/shared/types.ts";

const fuels: FuelType[] = ["batubara", "gas", "diesel", "surya", "air", "biomassa", "lainnya"];
const zero = (): Record<FuelType, number> => Object.fromEntries(fuels.map((f) => [f, 0])) as Record<FuelType, number>;
const grid: GridMix = {
  year: 2024,
  factorKgPerKwh: 0.8,
  shares: { ...zero(), batubara: 0.7, gas: 0.2, air: 0.1 },
  fuelFactors: { ...zero(), batubara: 1.0, gas: 0.5, diesel: 0.8 },
  source: "test",
};
const equivalents: EquivalentFactor[] = [{ key: "pohon", label: "Pohon", kgCo2PerUnit: 21, unit: "pohon/tahun" }];
const typeList: BuildingType[] = ["rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus", "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri"];
const types = Object.fromEntries(typeList.map((t) => [t, { intensityKwhM2Year: 100, typicalFloors: 2 }])) as Record<
  BuildingType,
  { intensityKwhM2Year: number; typicalFloors: number }
>;
const ctx = { types, grid, equivalents, region: { id: "samarinda", name: "Samarinda" } };
const base: BuildingInput = { featureId: "b1", lng: 117, lat: -0.5, footprintM2: 200, heightM: null };

describe("inferType", () => {
  test("poi mapping", () => {
    expect(inferType("education", "School", 400)).toEqual({ type: "sekolah", source: "poi" });
    expect(inferType("education", "University", 400).type).toBe("kampus");
    expect(inferType("medical", "Clinic", 400).type).toBe("rumah_sakit");
    expect(inferType("lodging", "Hotel", 400).type).toBe("hotel");
    expect(inferType("store_like", "Mall", 400).type).toBe("mal");
    expect(inferType("store_like", "Grocery", 400).type).toBe("ruko");
    expect(inferType("food_and_drink", "Cafe", 400).type).toBe("ruko");
    expect(inferType("general", "Government", 400).type).toBe("pemerintahan");
    expect(inferType("religion", "Mosque", 400).type).toBe("ibadah");
    expect(inferType("industrial", "Factory", 400).type).toBe("industri");
    expect(inferType("general", "Office", 400).type).toBe("kantor");
    expect(inferType("commercial_services", "Office", 400).type).toBe("kantor");
  });
  test("footprint fallback", () => {
    expect(inferType(null, null, 120)).toEqual({ type: "rumah", source: "footprint" });
    expect(inferType(null, null, 1200).type).toBe("ruko");
    expect(inferType(null, null, 8000).type).toBe("gudang");
    expect(inferType("unknown", "x", 120).source).toBe("footprint");
  });
});

describe("estimateFloors", () => {
  test("uses height when known", () => {
    expect(estimateFloors("hotel", 3, 6)).toBe(6);
    expect(estimateFloors("kantor", 35, 4)).toBe(10);
  });
  test("falls back to typical floors", () => {
    expect(estimateFloors("rumah", null, 2)).toBe(2);
  });
  test("clamps to [1, 40]", () => {
    expect(estimateFloors("kantor", 1000, 4)).toBe(40);
    expect(estimateFloors("kantor", null, 0)).toBe(1);
  });
});

describe("estimateBuilding", () => {
  test("computes energy and emissions", () => {
    const e = estimateBuilding(base, ctx);
    expect(e.type).toBe("rumah");
    expect(e.typeSource).toBe("footprint");
    expect(e.floors).toBe(2);
    expect(e.floorAreaM2).toBe(400);
    expect(e.kwhYear).toBe(40000);
    expect(e.kwhMonth).toBeCloseTo(40000 / 12, 6);
    expect(e.co2KgYear).toBeCloseTo(32000, 6);
    expect(e.equivalents[0]?.key).toBe("pohon");
    expect(e.region).toEqual({ id: "samarinda", name: "Samarinda" });
    expect(e.assumptions.length).toBeGreaterThan(0);
  });
  test("clamps footprint", () => {
    expect(estimateBuilding({ ...base, footprintM2: 2 }, ctx).floorAreaM2).toBe(10 * 2);
    expect(estimateBuilding({ ...base, footprintM2: 900000 }, ctx).floorAreaM2).toBe(50000 * 2);
  });
  test("Infinity footprint clamps to the maximum, -Infinity to the minimum, NaN counts as unknown", () => {
    const high = estimateBuilding({ ...base, footprintM2: Number.POSITIVE_INFINITY }, ctx);
    expect(high.floorAreaM2).toBe(50000 * 2);
    expect(high.assumptions.some((a) => a.includes("dibatasi ke 50.000 m2"))).toBe(true);
    const low = estimateBuilding({ ...base, footprintM2: Number.NEGATIVE_INFINITY }, ctx);
    expect(low.floorAreaM2).toBe(10 * 2);
    expect(low.assumptions.some((a) => a.includes("dibatasi ke 10 m2"))).toBe(true);
    const unknown = estimateBuilding({ ...base, footprintM2: Number.NaN }, ctx);
    expect(unknown.floorAreaM2).toBe(10 * 2);
    expect(unknown.assumptions.some((a) => a.includes("Luas lantai dasar tidak diketahui"))).toBe(true);
  });
  test("the height assumption says why: missing, or known but too low to use", () => {
    const missing = estimateBuilding({ ...base, heightM: null }, ctx);
    expect(missing.assumptions.some((a) => a.includes("Tinggi bangunan tidak ada di data peta"))).toBe(true);
    const low = estimateBuilding({ ...base, heightM: 2.5 }, ctx);
    expect(low.floors).toBe(2);
    expect(low.assumptions.some((a) => a.includes("hanya 2,5 m"))).toBe(true);
    expect(low.assumptions.some((a) => a.includes("Tinggi bangunan tidak ada"))).toBe(false);
    const tall = estimateBuilding({ ...base, heightM: 14 }, ctx);
    expect(tall.floors).toBe(4);
    expect(tall.assumptions.some((a) => a.includes("Tinggi bangunan"))).toBe(false);
  });
  test("overrides win", () => {
    const e = estimateBuilding({ ...base, typeOverride: "hotel", floorsOverride: 5 }, ctx);
    expect(e.type).toBe("hotel");
    expect(e.typeSource).toBe("user");
    expect(e.floors).toBe(5);
  });
  test("outside region and bad numbers stay finite", () => {
    const e = estimateBuilding({ ...base, footprintM2: Number.NaN }, { ...ctx, region: null });
    expect(e.region).toBeNull();
    expect(Number.isFinite(e.kwhYear)).toBe(true);
    expect(e.assumptions.some((a) => a.includes("Kalimantan Timur"))).toBe(true);
  });
  test("non-finite inputs leave every number of the estimate finite", () => {
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const footprintM2 of bad) {
      for (const heightM of [...bad, null]) {
        const e = estimateBuilding({ ...base, footprintM2, heightM }, ctx);
        for (const v of [e.floors, e.floorAreaM2, e.kwhYear, e.kwhMonth, e.co2KgYear]) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(0);
        }
        for (const row of e.bySource) expect(Number.isFinite(row.co2Kg)).toBe(true);
        for (const eq of e.equivalents) expect(Number.isFinite(eq.value)).toBe(true);
      }
    }
  });
});
