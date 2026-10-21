import { describe, expect, test } from "bun:test";
import {
  clearSkyDayKwh,
  clearSkyGhi,
  dayAgainstClearSky,
  dropSentence,
  isRainyHour,
  nearestHourGapMs,
  pvFromForecast,
  summariseDays,
  witaMs,
} from "../../src/shared/pvForecast.ts";

const h = (time: string, ghiWm2: number, precipMm = 0, weatherCode = 0) => ({ time, ghiWm2, cloudPct: 10, precipMm, weatherCode });

describe("pvFromForecast", () => {
  test("ghi 800 W/m2 and 2 kWp gives 1.248 kWh", () => {
    const out = pvFromForecast([h("2026-10-21T12:00", 800)], 2);
    expect(out[0]!.pvKwh).toBeCloseTo(1.248, 6);
    expect(out[0]!.time).toBe("2026-10-21T12:00");
  });
  test("negative ghi never gives negative energy", () => {
    expect(pvFromForecast([h("2026-10-21T00:00", -5)], 2)[0]!.pvKwh).toBe(0);
  });
});

describe("summariseDays", () => {
  test("groups by date and flags rain", () => {
    const hours = pvFromForecast(
      [
        h("2026-10-21T11:00", 800),
        h("2026-10-21T12:00", 800, 0.6),
        h("2026-10-22T12:00", 500, 0, 3),
        h("2026-10-23T12:00", 500, 0, 81),
      ],
      2,
    );
    const days = summariseDays(hours);
    expect(days.map((d) => d.date)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(days[0]!.pvKwh).toBeCloseTo(2.496, 6);
    expect(days[0]!.rainy).toBe(true);
    expect(days[0]!.maxPrecipMm).toBe(0.6);
    expect(days[1]!.rainy).toBe(false);
    expect(days[2]!.rainy).toBe(true);
  });
});

describe("clear-sky irradiance (Haurwitz)", () => {
  // 20 Mar 2026, the equinox. Solar noon at 117.15°E is about 04:19 UTC (12:19 WITA).
  const noonUtc = Date.UTC(2026, 2, 20, 4, 19);
  test("at the equator at equinox noon the sun is overhead: 1098 x e^-0.059 = about 1035 W/m2", () => {
    expect(clearSkyGhi(noonUtc, 0, 117.15)).toBeCloseTo(1035, -1);
  });
  test("is 0 at night and lower in the morning than at noon", () => {
    expect(clearSkyGhi(Date.UTC(2026, 2, 20, 16, 0), 0, 117.15)).toBe(0); // midnight WITA
    const morning = clearSkyGhi(Date.UTC(2026, 2, 20, 0, 0), 0, 117.15); // 08:00 WITA
    expect(morning).toBeGreaterThan(0);
    expect(morning).toBeLessThan(clearSkyGhi(noonUtc, 0, 117.15));
  });
  test("a clear day in Samarinda gives about 7 kWh/m2, so 1 kWp makes about 5,7 kWh", () => {
    const day = clearSkyDayKwh("2026-10-21", -0.5, 117.15, 1);
    expect(day).toBeGreaterThan(5);
    expect(day).toBeLessThan(6.5);
    expect(clearSkyDayKwh("2026-10-21", -0.5, 117.15, 3)).toBeCloseTo(day * 3, 9);
    expect(clearSkyDayKwh("2026-10-21", -0.5, 117.15, 0)).toBe(0);
  });
});

describe("one rain rule and one clock", () => {
  test("rain is 0,1 mm or more in the hour, or a rain weather code", () => {
    expect(isRainyHour({ precipMm: 0.1, weatherCode: 0 })).toBe(true);
    expect(isRainyHour({ precipMm: 0, weatherCode: 63 })).toBe(true);
    expect(isRainyHour({ precipMm: 0.05, weatherCode: 3 })).toBe(false);
  });
  test("forecast times are WITA without an offset", () => {
    expect(witaMs("2026-10-21T08:00")).toBe(Date.UTC(2026, 9, 21, 0, 0));
    expect(nearestHourGapMs([{ time: "2026-10-21T08:00" }, { time: "2026-10-21T10:00" }], Date.UTC(2026, 9, 21, 1, 30))).toBe(30 * 60_000);
    expect(nearestHourGapMs([], 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("one clear-sky verdict per day, shared by the Cuaca tab and the chat", () => {
  const site = { lat: -0.5, lng: 117.15, kWp: 1 };
  const clear = clearSkyDayKwh("2026-10-22", site.lat, site.lng, 1);
  const hour = (hh: number, precipMm = 0) => ({ time: `2026-10-22T${String(hh).padStart(2, "0")}:00`, precipMm, weatherCode: precipMm ? 61 : 1, cloudPct: 30 });
  test("a day half as good as a clear sky with afternoon rain: turun 50% karena hujan", () => {
    const hours = [hour(10), hour(14, 0.6), hour(15, 0.6), hour(16)];
    const v = dayAgainstClearSky({ date: "2026-10-22", pvKwh: clear * 0.5, rainy: true }, hours, site);
    expect(v).toMatchObject({ sky: "hujan", cause: "hujan", dropPct: 50 });
    expect(dropSentence(v)).toBe("produksi turun 50% karena hujan");
  });
  test("a night-only shower leaves a dry day cerah, and its heaviest rain counts daylight hours only", () => {
    const hours = [hour(2, 3), hour(10), hour(12), hour(14)];
    const v = dayAgainstClearSky({ date: "2026-10-22", pvKwh: clear * 0.95, rainy: true, maxPrecipMm: 3 }, hours, site);
    expect(v.sky).toBe("cerah");
    expect(v.heaviestRainMm).toBe(0);
    expect(dayAgainstClearSky({ date: "2026-10-22", pvKwh: 1, rainy: true }, [hour(2, 3), hour(13, 0.4)], site).heaviestRainMm).toBe(0.4);
    // Without hours for the date: the day's own maximum.
    expect(dayAgainstClearSky({ date: "2026-10-22", pvKwh: 1, rainy: true, maxPrecipMm: 3 }, [], site).heaviestRainMm).toBe(3);
  });
  test("a gap under 10% is not blamed on cloud: the model has no haze term", () => {
    const v = dayAgainstClearSky({ date: "2026-10-22", pvKwh: clear * 0.92, rainy: false }, [hour(12)], site);
    expect(v.dropPct).toBe(8);
    expect(dropSentence(v)).toBe("hampir sama dengan langit cerah (model)");
    expect(dropSentence({ ...v, dropPct: 10 })).toBe("produksi turun 10% karena awan");
    expect(dropSentence({ ...v, dropPct: null })).toBeNull();
  });
});
