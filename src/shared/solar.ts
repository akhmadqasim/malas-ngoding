import type { SolarInput, SolarResult } from "./types.ts";

const USABLE_ROOF_RATIO = 0.6;
const M2_PER_KWP = 5.5;
const PERFORMANCE_RATIO = 0.78;
const PANEL_KWP = 0.55;
const BATTERY_EFFICIENCY = 0.9;

const ZERO: SolarResult = {
  kWp: 0,
  panels: 0,
  kwhYear: 0,
  coveragePct: 0,
  batteryKwh: 0,
  costRp: 0,
  savingRpYear: 0,
  paybackYears: 0,
  co2AvoidedKgYear: 0,
};

function pos(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function simulateSolar(input: SolarInput): SolarResult {
  const roof = pos(input.roofAreaM2);
  const load = pos(input.kwhYear);
  const psh = pos(input.peakSunHours);
  if (roof === 0 || load === 0 || psh === 0) return { ...ZERO };

  const yieldPerKwp = psh * 365 * PERFORMANCE_RATIO;
  const maxKwp = (roof * USABLE_ROOF_RATIO) / M2_PER_KWP;
  const neededKwp = load / yieldPerKwp;
  // Size to the need (rounded up to 0.5 kWp) but never above what the roof can hold (rounded down).
  const kWp = Math.min(Math.ceil(neededKwp * 2) / 2, Math.floor(maxKwp * 2) / 2);
  if (kWp <= 0) return { ...ZERO };

  const panels = Math.ceil(kWp / PANEL_KWP);
  const pvKwh = kWp * yieldPerKwp;
  const usedKwh = Math.min(pvKwh, load);
  const coveragePct = (usedKwh / load) * 100;

  const batteryKwh = ((load / 365 / 24) * pos(input.backupHours)) / BATTERY_EFFICIENCY;
  const costRp = kWp * pos(input.costRpPerKwp) + batteryKwh * pos(input.batteryRpPerKwh);
  const savingRpYear = usedKwh * pos(input.tariffRpPerKwh);
  const paybackYears = savingRpYear > 0 ? costRp / savingRpYear : 0;
  const co2AvoidedKgYear = usedKwh * pos(input.gridFactorKgPerKwh);

  return { kWp, panels, kwhYear: pvKwh, coveragePct, batteryKwh, costRp, savingRpYear, paybackYears, co2AvoidedKgYear };
}
