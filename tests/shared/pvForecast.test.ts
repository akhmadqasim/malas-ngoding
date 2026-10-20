import { describe, expect, test } from "bun:test";
import { pvFromForecast, summariseDays } from "../../src/shared/pvForecast.ts";

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
