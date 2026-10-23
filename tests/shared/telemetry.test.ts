import { describe, expect, test } from "bun:test";
import { sensorFrame, type DeviceModel, type WeatherCase } from "../../src/shared/telemetry.ts";

const device: DeviceModel = { id: "house-1", kwhYear: 3600, kWp: 3, gridFactor: 1.13 };
const noon = Date.parse("2026-10-22T04:00:00Z");
const night = Date.parse("2026-10-22T12:00:00Z");

describe("virtual sensor physics", () => {
  test("one device and packet time always produces the same reading across views", () => {
    expect(sensorFrame(device, noon)).toEqual(sensorFrame(device, noon + 1800));
    expect(sensorFrame(device, noon + 2000).sequence).toBe(sensorFrame(device, noon).sequence + 1);
    expect(sensorFrame(device, noon + 2000).loadKw).not.toBe(sensorFrame(device, noon).loadKw);
    expect(sensorFrame({ ...device, id: "house-2" }, noon).loadKw).not.toBe(sensorFrame(device, noon).loadKw);
  });
  test("conserves electricity and credits only on-site solar for every packet and weather case", () => {
    for (const weather of ["auto", "clear", "cloudy", "rain", "heavy-rain", "night"] as WeatherCase[]) for (let i = 0; i < 120; i++) {
      const f = sensorFrame(device, noon + i * 2000, weather);
      expect(f.solarKw + f.importKw).toBeCloseTo(f.loadKw + f.exportKw, 10);
      expect(f.selfUseKw + f.importKw).toBeCloseTo(f.loadKw, 10);
      expect(f.selfUseKw + f.exportKw).toBeCloseTo(f.solarKw, 10);
      expect(f.avoidedKgHour).toBeCloseTo(f.selfUseKw * device.gridFactor, 10);
      expect(f.co2KgHour + f.avoidedKgHour).toBeCloseTo(f.loadKw * device.gridFactor, 10);
      expect(f.importKw === 0 || f.exportKw === 0).toBe(true);
      expect(f.solarKw).toBeGreaterThanOrEqual(0);
      expect(f.solarKw).toBeLessThanOrEqual(device.kWp);
    }
  });
  test("clouds and rain reduce PV without changing the load for the same building", () => {
    const clear = sensorFrame(device, noon, "clear"), cloudy = sensorFrame(device, noon, "cloudy"), rain = sensorFrame(device, noon, "rain");
    expect(clear.solarKw).toBeGreaterThan(cloudy.solarKw);
    expect(cloudy.solarKw).toBeGreaterThan(rain.solarKw);
    expect(clear.loadKw).toBe(rain.loadKw);
    expect(rain.rainMmHour).toBeGreaterThan(0);
  });
  test("night and no installation never generate solar; synthetic daytime tests are explicit", () => {
    expect(sensorFrame(device, night).solarKw).toBe(0);
    expect(sensorFrame(device, noon, "night").solarKw).toBe(0);
    const noPanels = sensorFrame({ ...device, kWp: 0 }, noon, "clear");
    expect(noPanels.solarKw).toBe(0); expect(noPanels.avoidedKgHour).toBe(0); expect(noPanels.importKw).toBe(noPanels.loadKw);
    const testDay = sensorFrame(device, night, "clear"); expect(testDay.solarKw).toBeGreaterThan(0); expect(testDay.weatherSource).toBe("test");
  });
  test("uses a current forecast and labels old or absent weather as synthetic", () => {
    const forecast = { time: "2026-10-22T12:00", ghiWm2: 500, cloudPct: 75, precipMm: 2, weatherCode: 63 };
    expect(sensorFrame(device, noon, "auto", forecast).weatherSource).toBe("forecast");
    expect(sensorFrame(device, noon + 2 * 3600_000, "auto", forecast).weatherSource).toBe("synthetic");
    expect(sensorFrame(device, noon).weatherSource).toBe("synthetic");
    expect(sensorFrame(device, night, "auto", { ...forecast, time: "2026-10-22T20:00" }).solarKw).toBe(0);
  });
  test("export from an empty building creates no fictitious avoided on-site CO2", () => {
    const f = sensorFrame({ ...device, kwhYear: 0 }, noon, "clear");
    expect(f.exportKw).toBe(f.solarKw); expect(f.selfUseKw).toBe(0); expect(f.avoidedKgHour).toBe(0);
  });
  test("retains a supplied regional hourly load baseline", () => {
    const f = sensorFrame({ ...device, kwhYear: 0, baseLoadKw: 100 }, noon);
    expect(f.loadKw).toBeGreaterThan(94); expect(f.loadKw).toBeLessThan(106);
  });
});
