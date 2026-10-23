import type { WindReading } from "../../shared/wind.ts";
import { witaMs } from "../../shared/pvForecast.ts";
import { roundWeatherCoord } from "./openMeteo.ts";

export type WindLookup = (lat: number, lng: number) => Promise<WindReading>;

/** Current model step, separate from the hourly forecast's one-hour cache. */
export function createCurrentWindLookup(opts: { fetch?: typeof fetch; now?: () => number } = {}): WindLookup {
  return async (lat, lng) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: String(roundWeatherCoord(lat)), longitude: String(roundWeatherCoord(lng)),
      current: "wind_speed_10m,wind_direction_10m", wind_speed_unit: "ms", timezone: "Asia/Makassar" }).toString();
    const response = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error(`Wind upstream HTTP ${response.status}`);
    const { current } = await response.json() as { current?: Record<string, unknown> };
    const speed = current?.wind_speed_10m, direction = current?.wind_direction_10m, time = current?.time;
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0 ||
        typeof direction !== "number" || !Number.isFinite(direction) || direction < 0 || direction > 360 ||
        typeof time !== "string" || !Number.isFinite(witaMs(time)) || Math.abs((opts.now?.() ?? Date.now()) - witaMs(time)) > 45 * 60_000) {
      throw new Error("Current wind is missing or out of date");
    }
    return { speedMs: speed, fromDeg: direction % 360, heightM: 10, time };
  };
}
