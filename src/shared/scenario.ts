import { yieldPerKwpYear } from "./solar.ts";
import type { RegionSummary } from "./types.ts";

/*
 * The province rooftop solar scenario: "what if a share of each region's electricity came from rooftop PV
 * used on site". Pure, so the sheet, the map columns and the tests compute the same numbers.
 */

/** What the server knows for the scenario: costs, the avoided-emission factor and each region's sun hours. */
export interface ScenarioBasis {
  costRpPerKwp: number;
  /** kg CO2 avoided per kWh of solar used on site (Kepmen ESDM 163.K/2021, PLTS in the Mahakam system). */
  solarFactorKgPerKwh: number;
  /** The grid's current solar share, 0..1 (grid mix). */
  gridSolarShare: number;
  regions: { id: string; peakSunHours: number; fallback?: boolean }[];
}

export interface RegionScenario {
  id: string;
  /** Solar kWh used on site per year. */
  solarKwhYear: number;
  kWp: number;
  co2AvoidedKgYear: number;
  /** CO2 left after the scenario, never below zero. */
  co2AfterKgYear: number;
  costRp: number;
}

export interface ScenarioResult {
  /** The share asked for, 0..1. */
  share: number;
  regions: RegionScenario[];
  solarKwhYear: number;
  kWp: number;
  co2BeforeKgYear: number;
  co2AvoidedKgYear: number;
  co2AfterKgYear: number;
  costRp: number;
  /** Solar's share of Kaltim's electricity with the scenario (grid solar plus rooftop), 0..1. */
  solarShareAfter: number;
}

/** Highest share the scenario offers: daytime use caps what rooftop PV without batteries can cover. */
export const SCENARIO_MAX_SHARE = 0.3;
/** Sun hours used when a region has none in the basis (FALLBACK_PSH on the server). */
const FALLBACK_PSH = 4.2;

const clampShare = (s: number) => (Number.isFinite(s) ? Math.min(Math.max(s, 0), SCENARIO_MAX_SHARE) : 0);
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The scenario for every region at `share` (clamped to 0..SCENARIO_MAX_SHARE). */
export function rooftopScenario(regions: RegionSummary[], basis: ScenarioBasis, share: number): ScenarioResult {
  const s = clampShare(share);
  const psh = new Map(basis.regions.map((r) => [r.id, r.peakSunHours]));
  const rows = regions.map((r): RegionScenario => {
    const solarKwhYear = pos(r.kwhYear) * s;
    const yieldPerKwp = yieldPerKwpYear(pos(psh.get(r.id) ?? 0) || FALLBACK_PSH);
    const kWp = yieldPerKwp > 0 ? solarKwhYear / yieldPerKwp : 0;
    const co2AvoidedKgYear = Math.min(solarKwhYear * pos(basis.solarFactorKgPerKwh), pos(r.co2KgYear));
    return {
      id: r.id,
      solarKwhYear,
      kWp,
      co2AvoidedKgYear,
      co2AfterKgYear: pos(r.co2KgYear) - co2AvoidedKgYear,
      costRp: kWp * pos(basis.costRpPerKwp),
    };
  });
  const sum = (f: (r: RegionScenario) => number) => rows.reduce((t, r) => t + f(r), 0);
  const totalKwh = regions.reduce((t, r) => t + pos(r.kwhYear), 0);
  const solarKwhYear = sum((r) => r.solarKwhYear);
  const co2BeforeKgYear = regions.reduce((t, r) => t + pos(r.co2KgYear), 0);
  const co2AvoidedKgYear = sum((r) => r.co2AvoidedKgYear);
  return {
    share: s,
    regions: rows,
    solarKwhYear,
    kWp: sum((r) => r.kWp),
    co2BeforeKgYear,
    co2AvoidedKgYear,
    co2AfterKgYear: co2BeforeKgYear - co2AvoidedKgYear,
    costRp: sum((r) => r.costRp),
    // Rooftop kWh replace grid kWh, so the grid's own solar shrinks with what it still supplies.
    solarShareAfter: totalKwh > 0 ? (pos(basis.gridSolarShare) * (totalKwh - solarKwhYear) + solarKwhYear) / totalKwh : 0,
  };
}

/** Per region, the share of its CO2 left (0..1): the map scales the CO2 columns by it. */
export function scenarioScale(result: ScenarioResult, regions: RegionSummary[]): Map<string, number> {
  const before = new Map(regions.map((r) => [r.id, pos(r.co2KgYear)]));
  return new Map(result.regions.map((r) => [r.id, (before.get(r.id) ?? 0) > 0 ? r.co2AfterKgYear / before.get(r.id)! : 1]));
}
