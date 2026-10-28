import { describe, expect, test } from "bun:test";
import assumptions from "../../data/seed/re-assumptions.json";
import {
  capacityFactor,
  cellPotential,
  hubSpeed,
  type PotentialAssumptions,
  powerShare,
  pvYieldMwhPerMwp,
  scaleBetween,
} from "../../src/shared/potential.ts";

const a = assumptions as PotentialAssumptions;
const curve = a.wind.curve;

describe("solar", () => {
  test("1 MWp makes ghi x 365 x PR MWh a year", () => {
    expect(pvYieldMwhPerMwp(5, 0.8)).toBeCloseTo(1460);
    expect(pvYieldMwhPerMwp(Number.NaN, 0.8)).toBe(0);
  });
});

describe("wind", () => {
  test("the power law lifts the 50 m speed to the hub", () => {
    expect(hubSpeed(4, 50, 0.143)).toBeCloseTo(4);
    expect(hubSpeed(4, 100, 0.143)).toBeCloseTo(4 * 2 ** 0.143);
  });

  test("the power curve is zero outside cut-in and cut-out and linear between points", () => {
    expect(powerShare(2.9, curve)).toBe(0);
    expect(powerShare(25, curve)).toBe(0);
    expect(powerShare(15, curve)).toBe(1);
    expect(powerShare(3.5, curve)).toBeCloseTo(0.014);
  });

  test("the capacity factor rises with the mean speed and stays below 1", () => {
    const cf = [3, 5, 7, 9].map((v) => capacityFactor(v, curve));
    for (let i = 1; i < cf.length; i++) expect(cf[i]!).toBeGreaterThan(cf[i - 1]!);
    expect(cf.at(-1)!).toBeLessThan(1);
    expect(capacityFactor(0, curve)).toBe(0);
  });

  test("Kaltim's best wind (4,1 m/s at 50 m) gives about a tenth of rated power: not viable", () => {
    const p = cellPotential({ ghi: 4.9, ws50: 4.1 }, a);
    expect(p.hubMs).toBeCloseTo(4.53, 1);
    expect(p.windCf).toBeGreaterThan(0.07);
    expect(p.windCf).toBeLessThan(0.13);
    expect(p.windViable).toBe(false);
    expect(p.windMwhPerTurbine).toBeCloseTo(a.wind.ratedMw * 8760 * p.windCf);
  });
});

describe("scaleBetween", () => {
  test("places values between lo and hi, clamped", () => {
    const s = scaleBetween([1, 2, 3, 10], (x) => x, 1, 3);
    expect([...s.values()]).toEqual([0, 0.5, 1, 1]);
    expect(scaleBetween([4], (x) => x, 4, 4).get(4)).toBe(0.5);
  });
});
