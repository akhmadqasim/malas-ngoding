import { describe, expect, test } from "bun:test";
import { simulateSolar } from "../../src/shared/solar.ts";
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
    // needed = 3600 / (4.5 * 365 * 0.78) = 2.81 kWp, rounded up to 3.0
    const r = simulateSolar(input);
    const pv = 3 * 4.5 * 365 * 0.78;
    const battery = ((3600 / 365 / 24) * 4) / 0.9;
    const cost = 3 * 15_000_000 + battery * 5_000_000;
    const saving = 3600 * 1500;
    expect(r.kWp).toBe(3);
    expect(r.panels).toBe(6);
    expect(r.kwhYear).toBeCloseTo(pv, 6);
    expect(r.coveragePct).toBe(100);
    expect(r.batteryKwh).toBeCloseTo(battery, 6);
    expect(r.costRp).toBeCloseTo(cost, 3);
    expect(r.savingRpYear).toBeCloseTo(saving, 3);
    expect(r.paybackYears).toBeCloseTo(cost / saving, 6);
    expect(r.co2AvoidedKgYear).toBeCloseTo(3600 * 0.8, 6);
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
});
