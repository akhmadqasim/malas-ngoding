import { expect, test } from "bun:test";
import { transitionPriorities } from "../../src/shared/transitionPriority.ts";
import type { RegionSummary } from "../../src/shared/types.ts";
import type { ScenarioBasis } from "../../src/shared/scenario.ts";
const region = (id: string, kwhYear: number): RegionSummary => ({ id, name: id, kind: "kota", kwhYear, co2KgYear: kwhYear, population: null, customers: null, electrificationPct: null, villagesNoPln: null, estimated: true });
const regions = [region("small-sunny", 1000), region("large-cloudy", 10000), region("missing", 50000)];
const basis: ScenarioBasis = { costRpPerKwp: 10e6, solarFactorKgPerKwh: 1, gridSolarShare: 0, regions: [{ id: "small-sunny", peakSunHours: 5 }, { id: "large-cloudy", peakSunHours: 4 }] };
test("equal-budget efficiency differs from total impact and missing data ranks last", () => {
  expect(transitionPriorities(regions, basis)[0]!.id).toBe("small-sunny");
  expect(transitionPriorities(regions, basis, "impact")[0]!.id).toBe("large-cloudy");
  expect(transitionPriorities(regions, basis)[2]!.rankValue).toBeNull();
});
test("fallback climate and invalid costs never create a readiness ranking", () => {
  const fallback = { ...basis, regions: basis.regions.map(r => ({ ...r, fallback: true })) };
  expect(transitionPriorities(regions, fallback).every(r => r.rankValue == null)).toBe(true);
  expect(transitionPriorities(regions, { ...basis, costRpPerKwp: 0 }).every(r => r.rankValue == null)).toBe(true);
});
test("budget-normalised impact is reproducible and never altered by region size alone", () => {
  const rows = transitionPriorities([region("small-sunny", 1e9), region("large-cloudy", 1)], basis);
  expect(rows[0]!.id).toBe("small-sunny");
  expect(rows[0]!.tonnesPerBillion).toBeCloseTo(5 * 365 * 0.78 * 1 / 1000 * 100, 6);
});
