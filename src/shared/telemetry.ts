import type { ForecastHour } from "./pvForecast.ts";
import { witaMs } from "./pvForecast.ts";
import profile from "../../data/seed/load-profile.json";
import { normaliseProfile } from "./twin.ts";

export type WeatherCase = "auto" | "clear" | "cloudy" | "rain" | "heavy-rain" | "night";
export interface DeviceModel {
  id: string;
  kwhYear: number;
  kWp: number;
  gridFactor: number;
  /** Region twin already has the current hourly load, so keep its baseline. */
  baseLoadKw?: number;
}
export interface SensorFrame {
  timestamp: number;
  sequence: number;
  solarKw: number;
  loadKw: number;
  selfUseKw: number;
  importKw: number;
  exportKw: number;
  co2KgHour: number;
  avoidedKgHour: number;
  irradiance: number;
  cloudPct: number;
  rainMmHour: number;
  temperatureC: number;
  voltageV: number;
  weather: "cerah" | "berawan" | "hujan" | "malam";
  weatherSource: "forecast" | "synthetic" | "test";
}

const hourly = normaliseProfile(profile.hourlyFactor);
const positive = (v: number) => Number.isFinite(v) ? Math.max(0, v) : 0;
export function deviceSeed(id: string): number {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff * Math.PI * 2;
}

/** Pure virtual sensor: same building + timestamp + inputs = same frame in every view. No random noise or persisted readings. */
export function sensorFrame(device: DeviceModel, now: number, scenario: WeatherCase = "auto", forecast?: ForecastHour): SensorFrame {
  const timestamp = Math.floor(now / 2000) * 2000;
  const t = timestamp / 1000, seed = deviceSeed(device.id);
  const local = new Date(timestamp + 8 * 3600_000);
  const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
  const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  const cloudPass = (Math.sin(t / 38 + seed) + 1) / 2;
  const usable = forecast && Math.abs(witaMs(forecast.time) - timestamp) <= 90 * 60_000;
  let irradiance: number, cloudPct: number, rainMmHour: number;
  if (scenario !== "auto") {
    irradiance = { clear: 850, cloudy: 300, rain: 180, "heavy-rain": 65, night: 0 }[scenario];
    cloudPct = { clear: 8, cloudy: 72, rain: 88, "heavy-rain": 99, night: 20 }[scenario];
    rainMmHour = scenario === "heavy-rain" ? 12 : scenario === "rain" ? 2 : 0;
  } else if (usable) {
    irradiance = positive(forecast.ghiWm2) * (0.83 + 0.17 * cloudPass);
    cloudPct = Math.max(0, Math.min(100, forecast.cloudPct + (cloudPass - 0.5) * 8));
    rainMmHour = positive(forecast.precipMm);
  } else {
    irradiance = daylight * (850 - 400 * cloudPass);
    cloudPct = 15 + cloudPass * 65;
    rainMmHour = 0;
  }
  if (scenario !== "auto") irradiance *= 0.96 + 0.04 * cloudPass;
  if (scenario === "auto" && daylight <= 0) irradiance = 0;
  const loadBase = device.baseLoadKw == null ? positive(device.kwhYear) / 8760 * hourly[Math.floor(hour)]! : positive(device.baseLoadKw);
  const loadKw = loadBase * (1 + 0.035 * Math.sin(t / 17 + seed) + 0.018 * Math.sin(t / 5 + seed * 2));
  const solarKw = Math.min(positive(device.kWp), positive(device.kWp) * irradiance / 1000 * 0.78);
  const selfUseKw = Math.min(loadKw, solarKw);
  const importKw = Math.max(0, loadKw - solarKw), exportKw = Math.max(0, solarKw - loadKw);
  return { timestamp, sequence: Math.floor(timestamp / 2000), solarKw, loadKw, selfUseKw, importKw, exportKw,
    co2KgHour: importKw * positive(device.gridFactor), avoidedKgHour: selfUseKw * positive(device.gridFactor),
    irradiance, cloudPct, rainMmHour, temperatureC: 27 + irradiance / 100 + Math.sin(t / 50 + seed),
    voltageV: 230 + 1.5 * Math.sin(t / 13 + seed),
    weather: irradiance <= 0 ? "malam" : rainMmHour > 0 ? "hujan" : cloudPct > 50 ? "berawan" : "cerah",
    weatherSource: scenario !== "auto" ? "test" : usable ? "forecast" : "synthetic" };
}
