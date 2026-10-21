import { fmtNumber } from "../../../shared/format.ts";
import { pvFromForecast, summariseDays } from "../../../shared/pvForecast.ts";
import { currentConditions } from "../../routes/weather.ts";
import { cachedForecast } from "../cache.ts";
import { estimated, inRange, kaltimPoint, latParam, lngParam, percent, point, type ServerTool } from "./common.ts";

// The weather forecast with the expected solar production per day.

/** Solar size get_weather uses when Claude does not pass one. */
const DEFAULT_KWP = 1;
const MAX_KWP = 10_000;
const WEATHER_DOWN = "Prakiraan cuaca sedang tidak tersedia.";

const DAY_MS = 86_400_000;
const WITA_MS = 8 * 3600_000;
const WEEKDAY = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" });

/** Today's date in WITA (UTC+8, no daylight saving) as YYYY-MM-DD, the format of the forecast days. */
function witaDate(ms: number): string {
  return new Date(ms + WITA_MS).toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  const weekday = WEEKDAY.format(at);
  const ahead = Math.round((at - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (ahead === 0) return `hari ini (${weekday})`;
  if (ahead === 1) return `besok (${weekday})`;
  if (ahead === 2) return `lusa (${weekday})`;
  return weekday;
}

function comparedToBest(kwh: number, best: number): string {
  if (best <= 0 || kwh >= best) return "hari terbaik dalam prakiraan";
  const lowerPct = Math.round((1 - kwh / best) * 100);
  if (lowerPct === 0) return "hampir sama dengan hari terbaik dalam prakiraan";
  return `${fmtNumber(lowerPct)}% lebih rendah dari hari terbaik dalam prakiraan`;
}

export const getWeather: ServerTool = {
  definition: {
    name: "get_weather",
    description:
      "Weather forecast for the coming days at a point (rain, cloud) and the expected solar production per day for a system of kWp kilowatt-peak. Days are labelled \"hari ini\", \"besok\" and \"lusa\". Pass the kWp from simulate_solar when you have it; without it 1 kWp is used. Only for points in or near Kalimantan Timur.",
    input_schema: {
      type: "object",
      properties: {
        lat: latParam("the place"),
        lng: lngParam("the place"),
        kWp: { type: "number", description: "Size of the solar system in kWp, more than 0. Optional, default 1." },
      },
      required: ["lat", "lng"],
    },
  },
  run: async (deps, i) => {
    const p = point(i);
    if ("problem" in p) return p;
    const far = kaltimPoint(p.lng, p.lat);
    if (far) return far;
    const given = i.kWp !== undefined && i.kWp !== null;
    if (given && !(inRange(i.kWp, 0, MAX_KWP) && i.kWp > 0)) {
      return { problem: `kWp harus berupa angka lebih dari 0 dan paling besar ${fmtNumber(MAX_KWP)}.` };
    }
    const kWp = given ? (i.kWp as number) : DEFAULT_KWP;
    const nowMs = Date.now();
    const forecast = await cachedForecast(deps, p.lat, p.lng, nowMs);
    if (!forecast) return { problem: WEATHER_DOWN };
    const today = witaDate(nowMs);
    // A stale forecast can start before today; only today and later days are useful.
    const days = summariseDays(pvFromForecast(forecast.hours, kWp)).filter((d) => d.date >= today);
    if (days.length === 0) return { problem: WEATHER_DOWN };
    const best = Math.max(...days.map((d) => d.pvKwh));
    const now = currentConditions(forecast.hours, nowMs);
    return {
      result: {
        location: { lat: p.lat, lng: p.lng },
        kWp,
        ...(given ? {} : { kWpNote: `Ukuran panel belum diketahui, jadi produksi surya dihitung untuk ${DEFAULT_KWP} kWp.` }),
        now: { raining: now.raining, cloudText: percent(now.cloudPct, 0), daytime: now.isDay },
        days: days.map((d) => ({
          date: d.date,
          day: dayLabel(d.date, today),
          rain: d.rainy,
          heaviestRainText: `${fmtNumber(d.maxPrecipMm, 1)} mm per jam`,
          solarText: estimated(`${fmtNumber(d.pvKwh, 1)} kWh`),
          comparedToBestDay: comparedToBest(d.pvKwh, best),
        })),
        ...(forecast.stale ? { note: "Prakiraan ini dari simpanan lama karena Open-Meteo sedang tidak bisa dihubungi." } : {}),
        source: "Prakiraan cuaca Open-Meteo. Produksi surya = kWp x radiasi matahari x 0,78.",
      },
    };
  },
};
