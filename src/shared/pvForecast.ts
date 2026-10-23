import type { PvHour } from "./types.ts";

/** One forecast hour: local time (no offset), irradiance in W/m2, cloud in %, rain in mm, WMO weather code. */
export interface ForecastHour {
  time: string;
  ghiWm2: number;
  cloudPct: number;
  precipMm: number;
  weatherCode: number;
}

export function pvFromForecast(
  hours: ForecastHour[],
  kWp: number,
  pr = 0.78,
): PvHour[] {
  const size = Number.isFinite(kWp) && kWp > 0 ? kWp : 0;
  return hours.map((h) => {
    const ghi = Number.isFinite(h.ghiWm2) && h.ghiWm2 > 0 ? h.ghiWm2 : 0;
    return { ...h, pvKwh: size * (ghi / 1000) * pr };
  });
}

export function isRainCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

export function summariseDays(hours: PvHour[]): { date: string; pvKwh: number; rainy: boolean; maxPrecipMm: number }[] {
  const days = new Map<string, { date: string; pvKwh: number; rainy: boolean; maxPrecipMm: number }>();
  for (const h of hours) {
    const date = h.time.slice(0, 10);
    let day = days.get(date);
    if (!day) {
      day = { date, pvKwh: 0, rainy: false, maxPrecipMm: 0 };
      days.set(date, day);
    }
    day.pvKwh += h.pvKwh;
    day.maxPrecipMm = Math.max(day.maxPrecipMm, h.precipMm);
    if (h.precipMm >= 0.5 || isRainCode(h.weatherCode)) day.rainy = true;
  }
  return [...days.values()];
}

/** Rain from this much per hour (mm). The server's "raining now" and the tabs' rain hours share it. */
export const RAIN_MM = 0.1;

/** One rain rule for the whole app: 0,1 mm or more in the hour, or a rain weather code. */
export function isRainyHour(h: { precipMm: number; weatherCode: number }): boolean {
  return h.precipMm >= RAIN_MM || isRainCode(h.weatherCode);
}

/** Forecast times are WITA (UTC+8, no daylight saving) without an offset: "2026-10-21T14:00". */
export function witaMs(time: string): number {
  return Date.parse(`${time}:00+08:00`);
}

/** Gap between `nowMs` and the nearest forecast hour; Infinity without hours. */
export function nearestHourGapMs(hours: { time: string }[], nowMs: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const h of hours) best = Math.min(best, Math.abs(witaMs(h.time) - nowMs));
  return best;
}

const RAD = Math.PI / 180;

/**
 * Clear-sky global horizontal irradiance in W/m2 (Haurwitz 1945: 1098 cos z e^(-0.059 / cos z)) at an
 * instant and place, with the sun position from Cooper's declination and the usual equation of time.
 */
export function clearSkyGhi(utcMs: number, lat: number, lng: number): number {
  const d = new Date(utcMs);
  const dayOfYear = Math.floor((utcMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);
  const decl = 23.45 * Math.sin(((360 / 365) * (284 + dayOfYear)) * RAD);
  const b = ((360 / 365) * (dayOfYear - 81)) * RAD;
  const eotMin = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const solarHours = utcHours + lng / 15 + eotMin / 60;
  const hourAngle = 15 * (solarHours - 12);
  const cosZ = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(hourAngle * RAD);
  return cosZ > 0 ? 1098 * cosZ * Math.exp(-0.059 / cosZ) : 0;
}

/**
 * What `kWp` of panels would make on `date` (WITA) under a clear sky, in kWh, the same way the forecast is
 * turned into output: each hour is the mean of the hour before its label (Open-Meteo), times kWp and PR.
 */
export function clearSkyDayKwh(date: string, lat: number, lng: number, kWp: number, pr = 0.78): number {
  const size = Number.isFinite(kWp) && kWp > 0 ? kWp : 0;
  if (size === 0) return 0;
  let wh = 0;
  for (let hour = 0; hour < 24; hour++) {
    const label = witaMs(`${date}T${String(hour).padStart(2, "0")}:00`);
    wh += clearSkyGhi(label - 30 * 60_000, lat, lng);
  }
  return (size * wh * pr) / 1000;
}

export type Sky = "cerah" | "berawan" | "hujan";
/** What a day's drop is put down to: rain that mattered, a little daylight rain, or cloud alone. */
export type DropCause = "hujan" | "awan dan hujan" | "awan";

/** Where the panels are and how big they are, for the clear-sky reference. */
export interface PanelSite {
  lat: number;
  lng: number;
  kWp: number;
}

export interface DayVerdict {
  /** What the same panels would make under a clear sky here on that date (model). */
  clearKwh: number;
  sky: Sky;
  cause: DropCause;
  /** 1 - output / clear sky, in whole %, never below 0; null without panels. */
  dropPct: number | null;
  /** The wettest daylight hour in mm (rain at night is left out, as in `sky`); the day's maximum without hours. */
  heaviestRainMm: number;
}

/** Daylight rain that makes a rainy day: this many rain hours, or this much rain. */
const RAIN_DAY_HOURS = 2;
const RAIN_DAY_MM = 1;
/** A dry day whose daylight hours average this much cloud reads "berawan". */
const CLOUDY_PCT = 60;
/**
 * Below this gap a day is "hampir sama dengan langit cerah (model)": the clear-sky model has no haze or
 * humidity term, so a small gap on a cloudless tropical day is not cloud.
 */
export const NEAR_CLEAR_PCT = 10;

/**
 * How one forecast day compares with a clear sky at the panels' spot: the sky, what the drop is put down to,
 * and the drop in %. Rain and cloud count in daylight only (rain at night costs no output); a day is "hujan"
 * from 2 daylight rain hours or 1 mm. Without hours for the date it falls back to `day.rainy`. The Cuaca tab
 * and the chat use this, so both give the same numbers and the same rain verdict.
 */
export function dayAgainstClearSky(
  day: { date: string; pvKwh: number; rainy: boolean; maxPrecipMm?: number },
  hours: { time: string; precipMm: number; weatherCode: number; cloudPct: number }[],
  site: PanelSite,
): DayVerdict {
  // Daylight: the sun is up during the hour before the label (Open-Meteo hours are means of that hour).
  const light = hours.filter((h) => h.time.startsWith(day.date) && clearSkyGhi(witaMs(h.time) - 30 * 60_000, site.lat, site.lng) > 0);
  const rainHours = light.filter(isRainyHour);
  const rainMm = rainHours.reduce((s, h) => s + h.precipMm, 0);
  const cloud = light.length ? light.reduce((s, h) => s + h.cloudPct, 0) / light.length : 0;
  const wet = light.length ? rainHours.length >= RAIN_DAY_HOURS || rainMm >= RAIN_DAY_MM : day.rainy;
  const clearKwh = clearSkyDayKwh(day.date, site.lat, site.lng, site.kWp);
  return {
    clearKwh,
    sky: wet ? "hujan" : cloud >= CLOUDY_PCT ? "berawan" : "cerah",
    cause: wet ? "hujan" : rainHours.length > 0 ? "awan dan hujan" : "awan",
    dropPct: clearKwh > 0 ? Math.max(0, Math.round((1 - day.pvKwh / clearKwh) * 100)) : null,
    heaviestRainMm: light.length ? light.reduce((m, h) => Math.max(m, h.precipMm), 0) : (day.maxPrecipMm ?? 0),
  };
}

/** The sentence for a day: "produksi turun 35% karena hujan", or "hampir sama dengan langit cerah (model)". */
export function dropSentence(v: Pick<DayVerdict, "dropPct" | "cause">): string | null {
  if (v.dropPct === null) return null;
  return v.dropPct < NEAR_CLEAR_PCT ? "hampir sama dengan langit cerah (model)" : `produksi turun ${v.dropPct}% karena ${v.cause}`;
}
