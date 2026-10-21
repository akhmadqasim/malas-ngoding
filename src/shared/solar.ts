import type { SolarInput, SolarResult } from "./types.ts";

const USABLE_ROOF_RATIO = 0.6;
const M2_PER_KWP = 5.5;
const PERFORMANCE_RATIO = 0.78;
const PANEL_KWP = 0.55;
const BATTERY_EFFICIENCY = 0.9;
/** A closed building's base load (fridges, servers, security) runs all day and night: half of it in daylight. */
const BASE_LOAD_DAYTIME_SHARE = 0.5;
const DAYS = 365;

const ZERO: SolarResult = {
  kWp: 0,
  panels: 0,
  kwhYear: 0,
  selfUseKwh: 0,
  exportKwh: 0,
  coveragePct: 0,
  batteryKwh: 0,
  costRp: 0,
  savingRpYear: 0,
  paybackYears: 0,
  paybackPanelYears: 0,
  co2AvoidedKgYear: 0,
};

function pos(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Yearly output of 1 kWp of PV at the given peak sun hours, in kWh. 0 for missing or bad input. */
export function yieldPerKwpYear(peakSunHours: number): number {
  return pos(peakSunHours) * 365 * PERFORMANCE_RATIO;
}

/** The daytime share of the load, 0..1; a missing or bad value counts the whole load (the old behaviour). */
function shareOf(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.min(1, n) : 1;
}

/** Days in use per year, 1..365; a missing or bad value means every day. */
function openDaysOf(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n >= 1 && n <= DAYS ? Math.round(n) : DAYS;
}

/** A closed day's load as a share of an open day's, 0..1 (default 0.15). */
function baseShareOf(n: number | undefined): number {
  return n !== undefined && Number.isFinite(n) && n >= 0 ? Math.min(1, n) : 0.15;
}

/**
 * Rooftop PV sized in whole panels to the building's daytime use over the year, never above what the roof
 * holds. Since Permen ESDM 2/2024 power sent to the grid earns no credit, so only self-use saves money and
 * CO2. Self-use is counted per kind of day, with the year's output spread evenly over the days: on an open
 * day up to its daytime load, on a closed day (a school holiday, an office weekend) only up to the daylight
 * part of the base load. The backup battery adds cost and no saving.
 */
export function simulateSolar(input: SolarInput): SolarResult {
  const roof = pos(input.roofAreaM2);
  const load = pos(input.kwhYear);
  const psh = pos(input.peakSunHours);
  if (roof === 0 || load === 0 || psh === 0) return { ...ZERO };

  const yieldPerKwp = yieldPerKwpYear(psh);
  const share = shareOf(input.daytimeShare);
  const daytimeLoad = load * share;
  const openDays = openDaysOf(input.openDaysPerYear);
  const closedDays = DAYS - openDays;
  const baseShare = baseShareOf(input.closedDayLoadShare);
  // The year's load falls on open days, plus the base load on closed ones.
  const openDayLoad = load / (openDays + baseShare * closedDays);
  const maxPanels = Math.floor((roof * USABLE_ROOF_RATIO) / M2_PER_KWP / PANEL_KWP);
  const neededPanels = Math.ceil(daytimeLoad / yieldPerKwp / PANEL_KWP);
  const panels = Math.min(neededPanels, maxPanels);
  if (!(panels > 0)) return { ...ZERO };
  // Rounded to whole watts, so 3 x 0.55 is 1.65 and not 1.6500000000000001.
  const kWp = Math.round(panels * PANEL_KWP * 1000) / 1000;

  const pvKwh = kWp * yieldPerKwp;
  const pvPerDay = pvKwh / DAYS;
  const selfUseKwh =
    openDays * Math.min(pvPerDay, share * openDayLoad) +
    closedDays * Math.min(pvPerDay, BASE_LOAD_DAYTIME_SHARE * baseShare * openDayLoad);
  const exportKwh = pvKwh - selfUseKwh;
  const coveragePct = (selfUseKwh / load) * 100;

  const batteryKwh = ((load / 365 / 24) * pos(input.backupHours)) / BATTERY_EFFICIENCY;
  const panelCostRp = kWp * pos(input.costRpPerKwp);
  const costRp = panelCostRp + batteryKwh * pos(input.batteryRpPerKwh);
  const savingRpYear = selfUseKwh * pos(input.tariffRpPerKwh);
  const paybackYears = savingRpYear > 0 ? costRp / savingRpYear : 0;
  const paybackPanelYears = savingRpYear > 0 ? panelCostRp / savingRpYear : 0;
  const co2AvoidedKgYear = selfUseKwh * pos(input.gridFactorKgPerKwh);

  return {
    kWp,
    panels,
    kwhYear: pvKwh,
    selfUseKwh,
    exportKwh,
    coveragePct,
    batteryKwh,
    costRp,
    savingRpYear,
    paybackYears,
    paybackPanelYears,
    co2AvoidedKgYear,
  };
}
