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
    // needed = 3600 / (4.5 x 365 x 0.78) = 2.81 kWp = 5.11 panels of 0.55 kWp. Rounded down (export earns
    // nothing), so 5 panels = 2.75 kWp. Expected values are pinned literals, worked out by hand.
    const r = simulateSolar(input);
    expect(r.kWp).toBe(2.75);
    expect(r.panels).toBe(5);
    expect(r.kwhYear).toBeCloseTo(3523.1625, 6); // 2.75 x 4.5 x 365 x 0.78
    expect(r.selfUseKwh).toBeCloseTo(3523.1625, 6); // all of it is used on site
    expect(r.exportKwh).toBe(0);
    expect(r.coveragePct).toBeCloseTo(97.865625, 6);
    expect(r.batteryKwh).toBeCloseTo(1.826484, 6); // 3600 / 8760 x 4 h / 0.9
    expect(r.costRp).toBeCloseTo(50_382_420.09, 2); // 2.75 x 15 000 000 + 1.826484 x 5 000 000
    expect(r.savingRpYear).toBeCloseTo(5_284_743.75, 3); // 3523,1625 kWh x Rp 1.500
    expect(r.paybackYears).toBeCloseTo(9.53356, 5);
    expect(r.paybackPanelYears).toBeCloseTo(7.805487, 6); // 41 250 000 / 5 284 743,75, without the battery
    expect(r.co2AvoidedKgYear).toBeCloseTo(2818.53, 6); // 3523,1625 x 0.8
  });
  test("the panel count rounds down, so a part panel never sends unpaid power to the grid", () => {
    // A house using 2.000 kWh a year, 40% of it by day, needs 1,11 panels at 4,6 psh: one panel, fully used,
    // not two at about 55% self-use.
    const r = simulateSolar({ ...input, kwhYear: 2000, peakSunHours: 4.6, daytimeShare: 0.4 });
    expect(r.panels).toBe(1);
    expect(r.exportKwh).toBe(0);
    // A load sized to exactly 4 panels stays at 4 despite float error.
    const exact = simulateSolar({ ...input, roofAreaM2: 1000, kwhYear: 4 * 0.55 * 4.5 * 365 * 0.78 });
    expect(exact.panels).toBe(4);
  });
  test("a load below one panel still gets one panel", () => {
    // 500 kWh needs 0,71 panel; one panel is the smallest system, and the part above the load is exported.
    const r = simulateSolar({ ...input, kwhYear: 500 });
    expect(r.panels).toBe(1);
    expect(r.kWp).toBe(0.55);
    expect(r.selfUseKwh).toBeCloseTo(500, 6);
    expect(r.exportKwh).toBeCloseTo(204.6325, 6); // 0.55 x 1281,15 - 500
  });
  test("panels and kWp always agree", () => {
    for (const kwhYear of [500, 3600, 12_345, 434_400]) {
      const r = simulateSolar({ ...input, roofAreaM2: 2000, kwhYear });
      expect(r.kWp).toBeCloseTo(r.panels * 0.55, 9);
    }
  });
  test("only the daytime share of the load is saved, and the panels are sized to it", () => {
    // A house uses 40% of its power while the sun shines: 1440 kWh -> 1.12 kWp -> 2 panels = 1.1 kWp.
    const r = simulateSolar({ ...input, daytimeShare: 0.4 });
    expect(r.kWp).toBe(1.1);
    expect(r.kwhYear).toBeCloseTo(1409.265, 6); // 1.1 x 4.5 x 365 x 0.78
    expect(r.selfUseKwh).toBeCloseTo(1409.265, 6);
    expect(r.exportKwh).toBe(0);
    expect(r.coveragePct).toBeCloseTo(39.146250, 6);
    expect(r.savingRpYear).toBeCloseTo(2_113_897.5, 3); // 1409,265 kWh x Rp 1.500, never more than the 1440 used by day
    expect(r.co2AvoidedKgYear).toBeCloseTo(1127.412, 6); // 1409,265 x 0.8
  });
  test("a school open 200 days: panels made on closed days serve only the base load", () => {
    // 63.000 kWh a year, 85% of an open day's load in daylight, 15% base load on the 165 closed days.
    // Sized to the yearly daytime use: 53.550 / 1281.15 / 0.55 = 75,99, so 75 panels = 41.25 kWp, 144,79 kWh a day.
    // An open day uses 63.000 / (200 + 0,15 x 165) = 280,31 kWh, 238,26 of it in daylight: all PV is used.
    // A closed day uses 0,15 x 280,31 = 42,05 kWh, half of it in daylight (21,02): the rest goes to the grid.
    const r = simulateSolar({ ...input, roofAreaM2: 10_000, kwhYear: 63_000, daytimeShare: 0.85, openDaysPerYear: 200, closedDayLoadShare: 0.15 });
    expect(r.kWp).toBe(41.25);
    expect(r.kwhYear).toBeCloseTo(52_847.44, 1);
    expect(r.selfUseKwh).toBeCloseTo(32_426.35, 1); // 144,79 x 200 + 21,02 x 165
    expect(r.exportKwh).toBeCloseTo(20_421.08, 1);
    expect(r.coveragePct).toBeCloseTo(51.47, 2); // not 85%
    expect(r.savingRpYear).toBeCloseTo(r.selfUseKwh * 1500, 3);
  });
  test("a roof-limited office uses its weekend output for the base load", () => {
    // 19 panels on a 100 m2 roof make 36,68 kWh a day; even a closed day's daylight base load (121,9) takes it all.
    const r = simulateSolar({ ...input, kwhYear: 434_400, daytimeShare: 0.85, openDaysPerYear: 250, closedDayLoadShare: 0.15 });
    expect(r.kWp).toBe(10.45);
    expect(r.selfUseKwh).toBeCloseTo(r.kwhYear, 6);
    expect(r.exportKwh).toBeCloseTo(0, 6);
  });
  test("open every day is the plain daytime-share model, and bad operating days count as every day", () => {
    const plain = simulateSolar({ ...input, daytimeShare: 0.4 });
    expect(simulateSolar({ ...input, daytimeShare: 0.4, openDaysPerYear: 365, closedDayLoadShare: 0.15 })).toEqual(plain);
    for (const bad of [Number.NaN, 0, -5, 400]) {
      expect(simulateSolar({ ...input, daytimeShare: 0.4, openDaysPerYear: bad }).selfUseKwh).toBeCloseTo(plain.selfUseKwh, 9);
    }
  });
  test("a bad daytime share counts the whole load as daytime use", () => {
    for (const bad of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(simulateSolar({ ...input, daytimeShare: bad }).kWp).toBe(2.75);
    }
    expect(simulateSolar({ ...input, daytimeShare: 1.7 }).selfUseKwh).toBeCloseTo(3523.1625, 6);
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
    expect(simulateSolar({ ...input, backupHours: Number.NaN }).kWp).toBe(2.75);
    // Bad roof, load or sun hours: nothing can be sized.
    for (const key of ["roofAreaM2", "kwhYear", "peakSunHours"] as const) {
      expect(simulateSolar({ ...input, [key]: Number.POSITIVE_INFINITY }).kWp).toBe(0);
    }
  });
});

describe("yieldPerKwpYear", () => {
  test("is peak sun hours x 365 x the 0.78 performance ratio, and 0 for bad input", () => {
    expect(yieldPerKwpYear(4.5)).toBeCloseTo(4.5 * 365 * 0.78, 9);
    expect(simulateSolar(input).kwhYear).toBeCloseTo(2.75 * yieldPerKwpYear(4.5), 9);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(yieldPerKwpYear(bad)).toBe(0);
  });
});
