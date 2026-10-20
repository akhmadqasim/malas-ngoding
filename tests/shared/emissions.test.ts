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
  test("zero kwh gives zero co2", () => {
    const rows = co2BySource(0, grid);
    expect(rows.every((r) => r.co2Kg === 0)).toBe(true);
  });
});
