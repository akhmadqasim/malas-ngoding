import { describe, expect, test } from "bun:test";
import { simulateSolar, yieldPerKwpYear } from "../../src/shared/solar.ts";
import type { SolarInput } from "../../src/shared/types.ts";

const input: SolarInput = {
  roofAreaM2: 100,
  kwhYear: 3600,
  peakSunHours: 4.5,
  backupHours: 4,
  tariffRpPerKwh: 1500,
  costRpPerKwp: 15_000_000,
  batteryRpPerKwh: 5_000_000,
  gridFactorKgPerKwh: 0.8,
};

describe("simulateSolar", () => {
  test("100 m2 roof, 3600 kWh/yr, 4.5 psh", () => {
    // needed = 3600 / (4.5 * 365 * 0.78) = 2.81 kWp, rounded up to 3.0. Expected values are pinned literals,
    // worked out by hand, so a change to the formulas shows up here instead of in the test's own copy of them.
    const r = simulateSolar(input);
    expect(r.kWp).toBe(3);
    expect(r.panels).toBe(6);
    expect(r.kwhYear).toBeCloseTo(3843.45, 6); // 3 x 4.5 x 365 x 0.78
    expect(r.coveragePct).toBe(100);
    expect(r.batteryKwh).toBeCloseTo(1.826484, 6); // 3600 / 8760 x 4 h / 0.9
    expect(r.costRp).toBeCloseTo(54_132_420.09, 2); // 3 x 15 000 000 + 1.826484 x 5 000 000
    expect(r.savingRpYear).toBeCloseTo(5_400_000, 3); // 3600 kWh x Rp 1.500
    expect(r.paybackYears).toBeCloseTo(10.024522, 6);
    expect(r.co2AvoidedKgYear).toBeCloseTo(2880, 6); // 3600 x 0.8
  });
  test("small roof limits capacity", () => {
    // usable 12 m2 -> max 2.18 kWp -> rounded down to 2.0 (never above the roof capacity)
    const r = simulateSolar({ ...input, roofAreaM2: 20, kwhYear: 12000 });
    expect(r.kWp).toBe(2);
    expect(r.panels).toBe(4);
    expect(r.coveragePct).toBeGreaterThan(0);
    expect(r.coveragePct).toBeLessThan(100);
  });
  test("roof too small for 0.5 kWp returns all zeros", () => {
    // 0.5 kWp needs 2.75 m2 usable, so a 5 m2 roof (3 m2 usable) still fits 0.5 kWp
    expect(simulateSolar({ ...input, roofAreaM2: 5 }).kWp).toBe(0.5);
    // 4 m2 roof: usable 2.4 m2 -> max 0.436 kWp -> rounded down to 0.0
    const r = simulateSolar({ ...input, roofAreaM2: 4 });
    expect(r.kWp).toBe(0);
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });
  test("zero roof returns all zeros", () => {
    const r = simulateSolar({ ...input, roofAreaM2: 0 });
    expect(Object.values(r).every((v) => v === 0)).toBe(true);
  });
  test("never returns NaN or Infinity", () => {
    for (const patch of [{ kwhYear: 0 }, { peakSunHours: 0 }, { tariffRpPerKwh: 0 }, { backupHours: 0 }]) {
      const r = simulateSolar({ ...input, ...patch });
      for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
    }
    expect(simulateSolar({ ...input, tariffRpPerKwh: 0 }).paybackYears).toBe(0);
  });
  test("NaN, Infinity and negative inputs never reach the result", () => {
    const keys = Object.keys(input) as (keyof SolarInput)[];
    for (const key of keys) {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
        const r = simulateSolar({ ...input, [key]: bad });
        for (const v of Object.values(r)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
    // A bad optional input (backup hours, tariff, costs) drops only its own term; the sizing stays.
    expect(simulateSolar({ ...input, backupHours: Number.NaN }).batteryKwh).toBe(0);
    expect(simulateSolar({ ...input, backupHours: Number.NaN }).kWp).toBe(3);
    // Bad roof, load or sun hours: nothing can be sized.
    for (const key of ["roofAreaM2", "kwhYear", "peakSunHours"] as const) {
      expect(simulateSolar({ ...input, [key]: Number.POSITIVE_INFINITY }).kWp).toBe(0);
    }
  });
});

describe("yieldPerKwpYear", () => {
  test("is peak sun hours x 365 x the 0.78 performance ratio, and 0 for bad input", () => {
    expect(yieldPerKwpYear(4.5)).toBeCloseTo(4.5 * 365 * 0.78, 9);
    expect(simulateSolar(input).kwhYear).toBeCloseTo(3 * yieldPerKwpYear(4.5), 9);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(yieldPerKwpYear(bad)).toBe(0);
  });
});
