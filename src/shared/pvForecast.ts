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
