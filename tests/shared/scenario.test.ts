import { describe, expect, test } from "bun:test";
import { rooftopScenario, SCENARIO_MAX_SHARE, type ScenarioBasis, scenarioScale } from "../../src/shared/scenario.ts";
import { yieldPerKwpYear } from "../../src/shared/solar.ts";
import type { RegionSummary } from "../../src/shared/types.ts";

const region = (id: string, kwhYear: number, co2KgYear = kwhYear * 1.14): RegionSummary => ({
  id,
  name: id,
  kind: "kota",
  kwhYear,
  co2KgYear,
  population: null,
  customers: null,
  electrificationPct: null,
  villagesNoPln: null,
  estimated: true,
});

const regions = [region("a", 1_000_000), region("b", 3_000_000)];
const basis: ScenarioBasis = {
  costRpPerKwp: 15_000_000,
  solarFactorKgPerKwh: 1.13,
  gridSolarShare: 0.01,
  regions: [
    { id: "a", peakSunHours: 5 },
    { id: "b", peakSunHours: 4 },
  ],
};

describe("rooftopScenario", () => {
  test("a share of 0 changes nothing", () => {
    const r = rooftopScenario(regions, basis, 0);
    expect(r.solarKwhYear).toBe(0);
    expect(r.co2AvoidedKgYear).toBe(0);
    expect(r.co2AfterKgYear).toBeCloseTo(r.co2BeforeKgYear);
    expect(r.solarShareAfter).toBeCloseTo(0.01);
  });

  test("solar kWh, kWp, CO2 and cost follow each region's sun hours", () => {
    const r = rooftopScenario(regions, basis, 0.2);
    const a = r.regions.find((x) => x.id === "a")!;
    expect(a.solarKwhYear).toBeCloseTo(200_000);
    expect(a.kWp).toBeCloseTo(200_000 / yieldPerKwpYear(5));
    expect(a.co2AvoidedKgYear).toBeCloseTo(200_000 * 1.13);
    expect(a.costRp).toBeCloseTo(a.kWp * 15_000_000);
    // Fewer sun hours need more panels for the same kWh.
    const b = r.regions.find((x) => x.id === "b")!;
    expect(b.kWp / b.solarKwhYear).toBeGreaterThan(a.kWp / a.solarKwhYear);
    expect(r.solarKwhYear).toBeCloseTo(800_000);
    expect(r.co2AfterKgYear).toBeCloseTo(r.co2BeforeKgYear - r.co2AvoidedKgYear);
    // 1% of the 80% still from the grid, plus the 20% from roofs.
    expect(r.solarShareAfter).toBeCloseTo(0.01 * 0.8 + 0.2);
  });

  test("the share is clamped and bad input counts as none", () => {
    expect(rooftopScenario(regions, basis, 0.9).share).toBe(SCENARIO_MAX_SHARE);
    expect(rooftopScenario(regions, basis, -1).share).toBe(0);
    expect(rooftopScenario(regions, basis, Number.NaN).share).toBe(0);
  });

  test("a region missing from the basis uses fallback sun hours, and avoided CO2 never exceeds the region's", () => {
    const r = rooftopScenario([region("c", 1_000_000, 100)], { ...basis, regions: [] }, 0.3);
    expect(r.regions[0]!.kWp).toBeGreaterThan(0);
    expect(r.regions[0]!.co2AvoidedKgYear).toBe(100);
    expect(r.regions[0]!.co2AfterKgYear).toBe(0);
  });
});

describe("scenarioScale", () => {
  test("is the share of each region's CO2 left", () => {
    const r = rooftopScenario(regions, basis, 0.2);
    const scale = scenarioScale(r, regions);
    expect(scale.get("a")).toBeCloseTo(1 - (200_000 * 1.13) / (1_000_000 * 1.14));
    expect(scenarioScale(rooftopScenario(regions, basis, 0), regions).get("b")).toBeCloseTo(1);
  });

  test("a region with no CO2 keeps a scale of 1", () => {
    const zero = [region("z", 0, 0)];
    expect(scenarioScale(rooftopScenario(zero, basis, 0.2), zero).get("z")).toBe(1);
  });
});
