import { describe, expect, test } from "bun:test";
import assumptions from "../../data/seed/re-assumptions.json";
import { farmRadiusM, MAX_SOLAR_MWP, MAX_TURBINES, offset, ROW_PITCH_M, solarFarm, TABLE_KWP, windFarm } from "../../src/shared/buildSite.ts";
import type { PotentialAssumptions } from "../../src/shared/potential.ts";

const a = assumptions as PotentialAssumptions;
const at: [number, number] = [117, -0.5];
const metres = (p: [number, number], q: [number, number]) =>
  Math.hypot((p[0] - q[0]) * 111_320 * Math.cos((q[1] * Math.PI) / 180), (p[1] - q[1]) * 111_320);

describe("offset", () => {
  test("moves by metres east and north", () => {
    expect(metres(offset(at, 1000, 0), at)).toBeCloseTo(1000, 0);
    expect(metres(offset(at, 0, -500), at)).toBeCloseTo(500, 0);
  });
});

describe("solarFarm", () => {
  test("land, output, CO2 and cost follow the assumptions", () => {
    const f = solarFarm(at, 10, 5, a, 1.13);
    expect(f.areaHa).toBeCloseTo(10 * a.pv.haPerMwp);
    expect(f.mwhYear).toBeCloseTo(10 * 5 * 365 * a.pv.performanceRatio);
    expect(f.co2AvoidedTonYear).toBeCloseTo(f.mwhYear * 1.13);
    expect(f.costRp).toBe(10 * a.pv.costRpPerMwp);
  });

  test("lays out one table per 11 kWp inside the square footprint", () => {
    const f = solarFarm(at, 10, 5, a, 1.13);
    expect(f.tables).toHaveLength(Math.round(10_000 / TABLE_KWP));
    const half = Math.sqrt(f.areaHa * 10_000) / 2;
    for (const t of f.tables) {
      const east = (t[0] - at[0]) * 111_320 * Math.cos((at[1] * Math.PI) / 180);
      const north = (t[1] - at[1]) * 111_320;
      expect(Math.abs(east)).toBeLessThanOrEqual(half + 6);
      expect(Math.abs(north)).toBeLessThanOrEqual(half + ROW_PITCH_M);
    }
  });

  test("is capped at the largest farm the map draws", () => {
    expect(solarFarm(at, 500, 5, a, 1.13).mwp).toBe(MAX_SOLAR_MWP);
    expect(solarFarm(at, -1, 5, a, 1.13).tables).toHaveLength(0);
  });
});

describe("windFarm", () => {
  test("Kaltim's weak wind: low capacity factor, not viable", () => {
    const f = windFarm(at, 4, 4.1, a, 1.13);
    expect(f.mw).toBe(4 * a.wind.ratedMw);
    expect(f.capacityFactor).toBeLessThan(0.13);
    expect(f.viable).toBe(false);
    expect(f.mwhYear).toBeCloseTo(f.mw * 8760 * f.capacityFactor);
    expect(f.sites).toHaveLength(4);
    expect(metres(f.sites[0]!, f.sites[1]!)).toBeCloseTo(750, 0);
  });

  test("turbine count stays between 1 and the cap", () => {
    expect(windFarm(at, 0, 4, a, 1.13).turbines).toBe(1);
    expect(windFarm(at, 99, 4, a, 1.13).turbines).toBe(MAX_TURBINES);
  });
});

describe("farmRadiusM", () => {
  test("covers the PLTS land square and the turbine block with its setback", () => {
    const side = Math.sqrt(10 * a.pv.haPerMwp * 10_000);
    expect(farmRadiusM("sun", 10, a)).toBeCloseTo((side / 2) * Math.SQRT2);
    expect(farmRadiusM("wind", 1, a)).toBeCloseTo(500);
    // 8 turbines: 4 x 2, 750 m apart.
    expect(farmRadiusM("wind", 8, a)).toBeCloseTo(Math.hypot(1125, 375) + 500);
  });

  test("every turbine of a block lies within the radius", () => {
    for (const n of [1, 3, 5, 10]) {
      const f = windFarm(at, n, 4, a, 1.13);
      for (const s of f.sites) expect(metres(s, at)).toBeLessThanOrEqual(farmRadiusM("wind", n, a) - 499);
    }
  });
});
