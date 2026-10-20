import { describe, expect, test } from "bun:test";
import { toEquivalents } from "../../src/shared/equivalents.ts";
import type { EquivalentFactor } from "../../src/shared/types.ts";

const factors: EquivalentFactor[] = [
  { key: "pohon", label: "Pohon", kgCo2PerUnit: 21, unit: "pohon/tahun" },
  { key: "mobil_km", label: "Mobil", kgCo2PerUnit: 0.2, unit: "km" },
];

describe("toEquivalents", () => {
  test("divides co2 by each factor", () => {
    const eq = toEquivalents(210, factors);
    expect(eq).toEqual([
      { key: "pohon", label: "Pohon", value: 10, unit: "pohon/tahun" },
      { key: "mobil_km", label: "Mobil", value: 1050, unit: "km" },
    ]);
  });
  test("skips bad factors and returns 0 for zero co2", () => {
    const eq = toEquivalents(0, [...factors, { key: "motor_km", label: "Motor", kgCo2PerUnit: 0, unit: "km" }]);
    expect(eq.map((e) => e.key)).toEqual(["pohon", "mobil_km"]);
    expect(eq.every((e) => e.value === 0)).toBe(true);
  });
});
