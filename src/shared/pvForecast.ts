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
