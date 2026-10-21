import { fmtNumber } from "../../shared/format.ts";
import { isRainCode, type summariseDays } from "../../shared/pvForecast.ts";
import type { BuildingEstimate, PvHour } from "../../shared/types.ts";
import type { SolarRequest } from "../api.ts";

/*
 * Pure helpers behind the Surya and Cuaca tabs: the roof prefill, the forecast window, rain spans,
 * daily rows and axis scales. No React, so they are tested on their own.
 */

/** Roof area limits, the same as the estimate's footprint clamp (global Review Focus 5). */
export const ROOF_MIN_M2 = 10;
export const ROOF_MAX_M2 = 50_000;
/** Battery backup slider (brief: 0 to 12 hours, default 4). */
export const BACKUP = { min: 0, max: 12, step: 1, initial: 4 } as const;
/** The hourly chart covers this many hours from now. */
export const WINDOW_HOURS = 72;
/** Rain from this much per hour, the same threshold the server uses for "raining now". */
const RAIN_MM = 0.1;
/** A dry day whose daylight hours average this much cloud reads "berawan". */
const CLOUDY_PCT = 60;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The roof area the Surya tab starts with: the footprint (floor area over floors), whole m2, clamped. */
export function roofFromBuilding(b: Pick<BuildingEstimate, "floorAreaM2" | "floors">): number {
  const footprint = b.floorAreaM2 / Math.max(1, b.floors);
  return Number.isFinite(footprint) ? Math.round(clamp(footprint, ROOF_MIN_M2, ROOF_MAX_M2)) : ROOF_MIN_M2;
}

/** The simulation the Surya tab starts with (roof = footprint, 4 h backup); the Cuaca tab sizes its panels by it too. */
export function defaultSolarRequest(b: BuildingEstimate, at: [number, number]): SolarRequest {
  return { lng: at[0], lat: at[1], roofAreaM2: roofFromBuilding(b), kwhYear: b.kwhYear, backupHours: BACKUP.initial };
}

/** Forecast times are WITA (UTC+8, no daylight saving) without an offset. */
export const witaMs = (time: string) => Date.parse(`${time}:00+08:00`);

/** The WITA calendar date of an instant, as `YYYY-MM-DD`. */
export function witaDate(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The hours shown in the chart: from the current WITA hour, `span` hours long. A forecast that lies
 * wholly in the past (a stale cache) shows its first `span` hours; the tab says it is old.
 */
export function forecastWindow(hours: PvHour[], nowMs: number, span = WINDOW_HOURS): PvHour[] {
  const hourStart = nowMs - (nowMs % 3600_000);
  const from = hours.findIndex((h) => witaMs(h.time) >= hourStart);
  return from < 0 ? hours.slice(0, span) : hours.slice(from, from + span);
}

export function isRainyHour(h: Pick<PvHour, "precipMm" | "weatherCode">): boolean {
  return h.precipMm >= RAIN_MM || isRainCode(h.weatherCode);
}

/** Runs of consecutive rain hours, as inclusive [first, last] indexes, for the chart's rain bands. */
export function rainSpans(hours: PvHour[]): [number, number][] {
  const spans: [number, number][] = [];
  hours.forEach((h, i) => {
    if (!isRainyHour(h)) return;
    const last = spans.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else spans.push([i, i]);
  });
  return spans;
}

const WEEKDAY = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" });

/** "Hari ini", "Besok", then the short weekday and the date ("Jum 23"). */
export function dayLabel(date: string, today: string): string {
  const day = Date.parse(`${date}T00:00:00Z`);
  const diff = Math.round((day - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Besok";
  return `${WEEKDAY.format(day)} ${Number(date.slice(8, 10))}`;
}

/** "07.00": the Indonesian way to write a time of day. */
export function hourLabel(time: string): string {
  return time.slice(11, 16).replace(":", ".");
}

export type Sky = "cerah" | "berawan" | "hujan";

export interface DayRow {
  date: string;
  label: string;
  pvKwh: number;
  sky: Sky;
  maxPrecipMm: number;
  /** How much less this day makes than the best day of the forecast, in whole %, or null. */
  dropPct: number | null;
}

type Day = ReturnType<typeof summariseDays>[number];

/** A day's drop is worth a line from this much. */
const MIN_DROP_PCT = 5;

/**
 * One row per forecast day from today: label, output, sky and, for a day of rain or heavy cloud, how
 * much less the panels make than on the best day of the forecast ("produksi turun X% karena hujan").
 * The sky is read in daylight, while the panels work: rain at night costs nothing. In the rainy season
 * nearly every day has a shower, so the reference is the best day of the forecast, not a dry one.
 */
export function dayRows(days: Day[], hours: PvHour[], nowMs: number): DayRow[] {
  const today = witaDate(nowMs);
  const ahead = days.filter((d) => d.date >= today);
  const best = Math.max(0, ...ahead.map((d) => d.pvKwh));
  return ahead.map((d) => {
    const light = hours.filter((h) => h.time.startsWith(d.date) && h.ghiWm2 > 0);
    const cloud = light.length ? light.reduce((s, h) => s + h.cloudPct, 0) / light.length : 0;
    const wet = light.length ? light.some(isRainyHour) : d.rainy;
    const sky: Sky = wet ? "hujan" : cloud >= CLOUDY_PCT ? "berawan" : "cerah";
    const drop = best > 0 ? Math.round(((best - d.pvKwh) / best) * 100) : 0;
    return {
      date: d.date,
      label: dayLabel(d.date, today),
      pvKwh: d.pvKwh,
      sky,
      maxPrecipMm: d.maxPrecipMm,
      dropPct: sky !== "cerah" && drop >= MIN_DROP_PCT ? drop : null,
    };
  });
}

/** A clean axis top at or above `value`, with three ticks (0, middle, top). */
export function niceScale(value: number): { max: number; ticks: [number, number, number] } {
  if (!Number.isFinite(value) || value <= 0) return { max: 1, ticks: [0, 0.5, 1] };
  const tidy = (n: number) => Number(n.toPrecision(12));
  let mag = 10 ** Math.floor(Math.log10(value / 2));
  for (;;) {
    for (const f of [1, 2, 2.5, 3, 4, 5]) {
      const step = tidy(f * mag);
      if (step * 2 >= value) return { max: tidy(step * 2), ticks: [0, step, tidy(step * 2)] };
    }
    mag *= 10;
  }
}

/** An axis tick in Indonesian notation, with only the decimals it needs (0, 0,2, 0,25, 1). */
export function tickText(t: number): string {
  const digits = Number.isInteger(t) ? 0 : Number.isInteger(Number((t * 10).toPrecision(12))) ? 1 : 2;
  return fmtNumber(t, digits);
}
