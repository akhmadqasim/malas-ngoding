import { sensorFrame, type WeatherCase } from "./telemetry.ts";
export type LabWeather = Exclude<WeatherCase, "auto">;
/** Hypothetical snapshot experiment: constant household demand; battery starts empty and charges from PV only. */
export function labRun(kWp: number, loadKw: number, batteryKwh: number, weather: LabWeather, seconds: number) {
  const safe = (n: number, max: number) => Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
  kWp = safe(kWp, 100); loadKw = safe(loadKw, 100); batteryKwh = safe(batteryKwh, 100);
  seconds = safe(seconds, 3600);
  const clear = sensorFrame({ id: "lab", kWp, kwhYear: 0, gridFactor: 0 }, 0, "clear");
  const target = sensorFrame({ id: "lab", kWp, kwhYear: 0, gridFactor: 0 }, 0, weather);
  let stored = 0, charge = 0, discharge = 0, solar = 0, grid = 0, exported = 0, direct = 0, gridKwh = 0;
  // 30 simulated minutes of clear weather to show whether this system can actually charge the battery.
  for (let t = -1800; t < seconds; t += 2) {
    const dt = Math.min(2, seconds - t) / 3600;
    const blend = Math.min(1, Math.max(0, t / 8));
    solar = clear.solarKw + (target.solarKw - clear.solarKw) * blend;
    direct = Math.min(loadKw, solar);
    charge = Math.min(Math.max(0, solar - loadKw), 2, (batteryKwh - stored) / (0.95 * dt));
    discharge = Math.min(Math.max(0, loadKw - solar), 2, stored * 0.95 / dt);
    stored = Math.max(0, Math.min(batteryKwh, stored + charge * dt * 0.95 - discharge * dt / 0.95));
    grid = Math.max(0, loadKw - direct - discharge);
    exported = Math.max(0, solar - direct - charge);
    if (t >= 0) gridKwh += grid * dt;
  }
  return { solar, direct, grid, exported, charge, discharge, stored, gridKwh, clearSolar: clear.solarKw, clearGrid: Math.max(0, loadKw - clear.solarKw), withoutBattery: Math.max(0, loadKw - solar), loadKw, batteryKwh };
}
