import type { ForecastHour } from "../../shared/pvForecast.ts";

export type MeteoLookup = (lat: number, lng: number) => Promise<ForecastHour[]>;

const TIMEOUT_MS = 6000;

/** Round to 0.05 degree (about 5 km): the cache key resolution for the weather forecast. */
export function roundWeatherCoord(v: number): number {
  return Math.round(v * 20) / 20;
}

export function weatherKey(lat: number, lng: number): string {
  return `${roundWeatherCoord(lat).toFixed(2)},${roundWeatherCoord(lng).toFixed(2)}`;
}

/** A number, or `fallback` for null and other non-numbers (Open-Meteo sends null for missing values). */
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Seven-day hourly forecast from Open-Meteo in Asia/Makassar time. Throws on network errors, timeouts,
 * non-2xx answers and an empty or malformed forecast. Error messages never contain the request URL.
 */
export function createMeteoLookup(opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): MeteoLookup {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  return async (lat, lng) => {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${roundWeatherCoord(lat)}&longitude=${roundWeatherCoord(lng)}` +
      "&hourly=shortwave_radiation,cloud_cover,precipitation,weather_code" +
      "&timezone=Asia%2FMakassar&forecast_days=7";

    let res: Response;
    try {
      res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new Error(timedOut ? "Open-Meteo: request timed out" : "Open-Meteo: request failed");
    }
    if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);

    let body: { hourly?: Record<string, unknown> };
    try {
      body = await res.json();
    } catch {
      throw new Error("Open-Meteo: response is not JSON");
    }
    const h = body.hourly;
    const times = h?.time;
    if (!h || !Array.isArray(times) || times.length === 0) throw new Error("Open-Meteo: forecast is empty");
    const col = (name: string): unknown[] => (Array.isArray(h[name]) ? (h[name] as unknown[]) : []);
    const ghi = col("shortwave_radiation");
    const cloud = col("cloud_cover");
    const rain = col("precipitation");
    const code = col("weather_code");

    const hours: ForecastHour[] = [];
    times.forEach((time, i) => {
      if (typeof time !== "string") return;
      hours.push({
        time,
        ghiWm2: Math.max(0, num(ghi[i])),
        cloudPct: Math.min(100, Math.max(0, num(cloud[i]))),
        precipMm: Math.max(0, num(rain[i])),
        weatherCode: num(code[i]),
      });
    });
    if (hours.length === 0) throw new Error("Open-Meteo: forecast is empty");
    return hours;
  };
}
