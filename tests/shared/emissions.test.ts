import { describe, expect, test } from "bun:test";
import { co2BySource } from "../../src/shared/emissions.ts";
import type { FuelType, GridMix } from "../../src/shared/types.ts";

const fuels: FuelType[] = ["batubara", "gas", "diesel", "surya", "air", "biomassa", "lainnya"];
const zero = (): Record<FuelType, number> => Object.fromEntries(fuels.map((f) => [f, 0])) as Record<FuelType, number>;
const grid: GridMix = {
  year: 2024,
  factorKgPerKwh: 0.8,
  shares: { ...zero(), batubara: 0.7, gas: 0.2, air: 0.1 },
  fuelFactors: { ...zero(), batubara: 1.0, gas: 0.5 },
  source: "test",
};

describe("co2BySource", () => {
  test("sum equals kwh x grid factor", () => {
    const rows = co2BySource(1000, grid);
    const sum = rows.reduce((s, r) => s + r.co2Kg, 0);
    expect(Math.abs(sum - 800)).toBeLessThan(1e-6);
  });
  test("drops zero shares and sorts by co2 desc", () => {
    const rows = co2BySource(1000, grid);
    expect(rows.map((r) => r.fuel)).toEqual(["batubara", "gas", "air"]);
    expect(rows[0]!.kwh).toBeCloseTo(700, 6);
  });
  test("zero, negative and non-finite kwh give no rows at all", () => {
    for (const kwh of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(co2BySource(kwh, grid)).toEqual([]);
  });
  test("pins the split of 1000 kWh: 0.7 x 1.0 and 0.2 x 0.5 scaled to 800 kg", () => {
    // raw = 700 + 100 = 800 kg already equals 1000 x 0.8, so the scale is 1 and nothing moves.
    expect(co2BySource(1000, grid)).toEqual([
      { fuel: "batubara", kwh: 700, co2Kg: 700 },
      { fuel: "gas", kwh: 200, co2Kg: 100 },
      { fuel: "air", kwh: 100, co2Kg: 0 },
    ]);
  });
  test("when every present fuel has a zero factor, the total is split by energy share", () => {
    const flat: GridMix = { ...grid, fuelFactors: zero() };
    const rows = co2BySource(1000, flat);
    expect(rows.map((r) => r.fuel)).toEqual(["batubara", "gas", "air"]);
    expect(rows.map((r) => r.co2Kg)).toEqual([560, 160, 80]);
    expect(rows.reduce((s, r) => s + r.co2Kg, 0)).toBeCloseTo(800, 9);
  });
});
