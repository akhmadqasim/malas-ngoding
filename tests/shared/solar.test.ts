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
    // needed = 3600 / (4.5 x 365 x 0.78) = 2.81 kWp = 5.11 panels of 0.55 kWp, so 6 panels = 3.3 kWp. Sized in
    // whole panels, so kWp is always panels x 0.55. Expected values are pinned literals, worked out by hand.
    const r = simulateSolar(input);
    expect(r.kWp).toBe(3.3);
    expect(r.panels).toBe(6);
    expect(r.kwhYear).toBeCloseTo(4227.795, 6); // 3.3 x 4.5 x 365 x 0.78
    expect(r.coveragePct).toBe(100);
    expect(r.selfUseKwh).toBeCloseTo(3600, 6);
    expect(r.exportKwh).toBeCloseTo(627.795, 6); // made but not used on site: earns nothing
    expect(r.batteryKwh).toBeCloseTo(1.826484, 6); // 3600 / 8760 x 4 h / 0.9
    expect(r.costRp).toBeCloseTo(58_632_420.09, 2); // 3.3 x 15 000 000 + 1.826484 x 5 000 000
    expect(r.savingRpYear).toBeCloseTo(5_400_000, 3); // 3600 kWh x Rp 1.500
    expect(r.paybackYears).toBeCloseTo(10.857856, 6);
    expect(r.paybackPanelYears).toBeCloseTo(9.166667, 6); // 49 500 000 / 5 400 000, without the battery
    expect(r.co2AvoidedKgYear).toBeCloseTo(2880, 6); // 3600 x 0.8
  });
  test("panels and kWp always agree", () => {
    for (const kwhYear of [500, 3600, 12_345, 434_400]) {
      const r = simulateSolar({ ...input, roofAreaM2: 2000, kwhYear });
      expect(r.kWp).toBeCloseTo(r.panels * 0.55, 9);
    }
  });
  test("only the daytime share of the load is saved, and the panels are sized to it", () => {
    // A house uses 40% of its power while the sun shines: 1440 kWh -> 1.12 kWp -> 3 panels = 1.65 kWp.
    const r = simulateSolar({ ...input, daytimeShare: 0.4 });
    expect(r.kWp).toBe(1.65);
    expect(r.kwhYear).toBeCloseTo(2113.8975, 6); // 1.65 x 4.5 x 365 x 0.78
    expect(r.selfUseKwh).toBeCloseTo(1440, 6);
    expect(r.exportKwh).toBeCloseTo(673.8975, 6);
    expect(r.coveragePct).toBeCloseTo(40, 9);
    expect(r.savingRpYear).toBeCloseTo(2_160_000, 3); // 1440 kWh x Rp 1.500, not 3600
    expect(r.co2AvoidedKgYear).toBeCloseTo(1152, 6); // 1440 x 0.8
  });
  test("a bad daytime share counts the whole load as daytime use", () => {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(simulateSolar({ ...input, daytimeShare: bad }).kWp).toBe(3.3);
    }
    expect(simulateSolar({ ...input, daytimeShare: 1.7 }).selfUseKwh).toBeCloseTo(3600, 6);
  });
  test("small roof limits capacity", () => {
    // usable 12 m2 -> max 2.18 kWp -> 3 whole panels = 1.65 kWp (never above the roof capacity)
    const r = simulateSolar({ ...input, roofAreaM2: 20, kwhYear: 12000 });
    expect(r.kWp).toBe(1.65);
    expect(r.panels).toBe(3);
    expect(r.coveragePct).toBeGreaterThan(0);
    expect(r.coveragePct).toBeLessThan(100);
  });
  test("roof too small for one panel returns all zeros", () => {
    // one 0.55 kWp panel needs 3.025 m2 usable: a 5.1 m2 roof (3.06 m2 usable) fits it
    expect(simulateSolar({ ...input, roofAreaM2: 5.1 }).kWp).toBe(0.55);
    // 5 m2 roof: usable 3 m2 -> no whole panel
    const r = simulateSolar({ ...input, roofAreaM2: 5 });
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
    expect(simulateSolar({ ...input, backupHours: Number.NaN }).kWp).toBe(3.3);
    // Bad roof, load or sun hours: nothing can be sized.
    for (const key of ["roofAreaM2", "kwhYear", "peakSunHours"] as const) {
      expect(simulateSolar({ ...input, [key]: Number.POSITIVE_INFINITY }).kWp).toBe(0);
    }
  });
});

describe("yieldPerKwpYear", () => {
  test("is peak sun hours x 365 x the 0.78 performance ratio, and 0 for bad input", () => {
    expect(yieldPerKwpYear(4.5)).toBeCloseTo(4.5 * 365 * 0.78, 9);
    expect(simulateSolar(input).kwhYear).toBeCloseTo(3.3 * yieldPerKwpYear(4.5), 9);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(yieldPerKwpYear(bad)).toBe(0);
  });
});
