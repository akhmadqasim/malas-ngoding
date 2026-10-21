import { fmtNumber } from "../../shared/format.ts";
import { clearSkyDayKwh, clearSkyGhi, isRainyHour, type summariseDays, witaMs } from "../../shared/pvForecast.ts";
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
  return { lng: at[0], lat: at[1], roofAreaM2: roofFromBuilding(b), kwhYear: b.kwhYear, backupHours: BACKUP.initial, buildingType: b.type };
}

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
/** What the drop is put down to: rain that mattered, a little daylight rain, or cloud alone. */
export type DropCause = "hujan" | "awan dan hujan" | "awan";

export interface DayRow {
  date: string;
  label: string;
  pvKwh: number;
  /** What the same panels would make under a clear sky here on that date. */
  clearKwh: number;
  sky: Sky;
  cause: DropCause;
  /** 1 - output / clear sky, in whole %, never below 0; null without panels. */
  dropPct: number | null;
}

type Day = ReturnType<typeof summariseDays>[number];

/** Daylight rain that counts as a rainy day: this many rain hours, or this much rain. */
const RAIN_DAY_HOURS = 2;
const RAIN_DAY_MM = 1;

/** Where the panels are and how big they are, for the clear-sky reference. */
export interface PanelSite {
  lat: number;
  lng: number;
  kWp: number;
}

/**
 * One row per forecast day from today: label, output, sky, and how far the day falls below what the same
 * panels make under a clear sky at this spot ("produksi turun X% karena ..."). Rain and cloud are read in
 * daylight only (rain at night costs no output); a day is "hujan" from 2 daylight rain hours or 1 mm.
 */
export function dayRows(days: Day[], hours: PvHour[], nowMs: number, site: PanelSite): DayRow[] {
  const today = witaDate(nowMs);
  return days
    .filter((d) => d.date >= today)
    .map((d) => {
      // Daylight: the sun is up during the hour before the label (Open-Meteo hours are means of that hour).
      const light = hours.filter((h) => h.time.startsWith(d.date) && clearSkyGhi(witaMs(h.time) - 30 * 60_000, site.lat, site.lng) > 0);
      const rainHours = light.filter(isRainyHour);
      const rainMm = rainHours.reduce((s, h) => s + h.precipMm, 0);
      const cloud = light.length ? light.reduce((s, h) => s + h.cloudPct, 0) / light.length : 0;
      const wet = light.length ? rainHours.length >= RAIN_DAY_HOURS || rainMm >= RAIN_DAY_MM : d.rainy;
      const clearKwh = clearSkyDayKwh(d.date, site.lat, site.lng, site.kWp);
      return {
        date: d.date,
        label: dayLabel(d.date, today),
        pvKwh: d.pvKwh,
        clearKwh,
        sky: wet ? "hujan" : cloud >= CLOUDY_PCT ? "berawan" : "cerah",
        cause: wet ? "hujan" : rainHours.length > 0 ? "awan dan hujan" : "awan",
        dropPct: clearKwh > 0 ? Math.max(0, Math.round((1 - d.pvKwh / clearKwh) * 100)) : null,
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
