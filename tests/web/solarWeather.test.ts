import { describe, expect, test } from "bun:test";
import type { BuildingEstimate, PvHour } from "../../src/shared/types.ts";
import { clearSkyDayKwh, isRainyHour } from "../../src/shared/pvForecast.ts";
import {
  dayLabel,
  dayRows,
  forecastWindow,
  hourLabel,
  niceScale,
  rainSpans,
  roofFromBuilding,
  tickText,
  witaDate,
} from "../../src/web/panels/solarWeather.ts";

const building = (floorAreaM2: number, floors: number) => ({ floorAreaM2, floors }) as BuildingEstimate;

describe("roof area prefill", () => {
  test("is the footprint: floor area over floors, whole m2", () => {
    expect(roofFromBuilding(building(360, 3))).toBe(120);
    expect(roofFromBuilding(building(100.4, 1))).toBe(100);
  });
  test("is clamped like the estimate (10 to 50.000 m2) and never NaN", () => {
    expect(roofFromBuilding(building(4, 1))).toBe(10);
    expect(roofFromBuilding(building(900_000, 2))).toBe(50_000);
    expect(roofFromBuilding(building(Number.NaN, 0))).toBe(10);
  });
});

const NOW = Date.parse("2026-10-21T14:20:00+08:00");
const h = (time: string, over: Partial<PvHour> = {}): PvHour => ({ time, ghiWm2: 500, cloudPct: 20, precipMm: 0, weatherCode: 1, pvKwh: 0.4, ...over });
/** Hourly forecast for whole WITA days from 2026-10-21, `days` long. */
function forecast(days: number, over: (date: string, hour: number) => Partial<PvHour> = () => ({})): PvHour[] {
  const out: PvHour[] = [];
  for (let d = 0; d < days; d++) {
    const date = `2026-10-${String(21 + d).padStart(2, "0")}`;
    for (let hr = 0; hr < 24; hr++) {
      const day = hr >= 7 && hr <= 17;
      out.push(h(`${date}T${String(hr).padStart(2, "0")}:00`, { ghiWm2: day ? 500 : 0, pvKwh: day ? 0.4 : 0, ...over(date, hr) }));
    }
  }
  return out;
}

describe("the 72-hour window", () => {
  test("starts at the current WITA hour and runs 72 hours", () => {
    const w = forecastWindow(forecast(7), NOW);
    expect(w).toHaveLength(72);
    expect(w[0]!.time).toBe("2026-10-21T14:00");
    expect(w.at(-1)!.time).toBe("2026-10-24T13:00");
  });
  test("a forecast that ends sooner gives what is left", () => {
    expect(forecastWindow(forecast(2), NOW)).toHaveLength(34);
  });
  test("an old forecast entirely in the past still shows its first 72 hours", () => {
    expect(forecastWindow(forecast(7), Date.parse("2026-11-30T00:00:00+08:00"))[0]!.time).toBe("2026-10-21T00:00");
  });
});

describe("rain hours", () => {
  test("rain is 0,1 mm or more, or a rain weather code", () => {
    expect(isRainyHour(h("2026-10-21T10:00", { precipMm: 0.1 }))).toBe(true);
    expect(isRainyHour(h("2026-10-21T10:00", { weatherCode: 61 }))).toBe(true);
    expect(isRainyHour(h("2026-10-21T10:00", { weatherCode: 3, precipMm: 0.05 }))).toBe(false);
  });
  test("consecutive rain hours merge into spans of indexes", () => {
    const wet = (i: number) => h(`2026-10-21T${String(i).padStart(2, "0")}:00`, { precipMm: 1 });
    const dry = (i: number) => h(`2026-10-21T${String(i).padStart(2, "0")}:00`);
    expect(rainSpans([dry(0), wet(1), wet(2), dry(3), wet(4)])).toEqual([
      [1, 2],
      [4, 4],
    ]);
    expect(rainSpans([dry(0)])).toEqual([]);
  });
});

describe("daily rows", () => {
  const PANEL = { lat: -0.5, lng: 117.15, kWp: 1 };
  const clear = (date: string) => clearSkyDayKwh(date, PANEL.lat, PANEL.lng, PANEL.kWp);

  test("labels: Hari ini, Besok, then weekday and date", () => {
    expect(witaDate(NOW)).toBe("2026-10-21");
    expect(dayLabel("2026-10-21", "2026-10-21")).toBe("Hari ini");
    expect(dayLabel("2026-10-22", "2026-10-21")).toBe("Besok");
    expect(dayLabel("2026-10-23", "2026-10-21")).toBe("Jum 23");
  });
  test("every day, the best one too, says how far it falls below a clear sky at this spot", () => {
    const days = [
      { date: "2026-10-21", pvKwh: clear("2026-10-21") * 0.9, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-22", pvKwh: clear("2026-10-22") * 0.5, rainy: true, maxPrecipMm: 3 },
    ];
    const rows = dayRows(days, [], NOW, PANEL);
    expect(rows.map((r) => r.dropPct)).toEqual([10, 50]);
    expect(rows[0]!.clearKwh).toBeCloseTo(clear("2026-10-21"), 9);
  });
  test("a day that matches the clear sky shows no drop, and output above it is not a negative drop", () => {
    const days = [
      { date: "2026-10-21", pvKwh: clear("2026-10-21") * 0.97, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-22", pvKwh: clear("2026-10-22") * 1.05, rainy: false, maxPrecipMm: 0 },
    ];
    expect(dayRows(days, [], NOW, PANEL).map((r) => r.dropPct)).toEqual([3, 0]);
  });
  test("rain counts in daylight only, and only from 2 rain hours or 1 mm: then the day reads hujan", () => {
    // 22 Oct: three afternoon hours of 0,5 mm. 23 Oct: one daylight hour of 0,3 mm. 24 Oct: rain at night only.
    const hours = forecast(4, (date, hr) => {
      if (date === "2026-10-22" && hr >= 14 && hr <= 16) return { precipMm: 0.5, weatherCode: 61, cloudPct: 100 };
      if (date === "2026-10-23" && hr === 10) return { precipMm: 0.3, weatherCode: 61 };
      if (date === "2026-10-24" && hr === 2) return { precipMm: 8, weatherCode: 65 };
      return {};
    });
    const days = ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"].map((date) => ({ date, pvKwh: clear(date) * 0.6, rainy: true, maxPrecipMm: 1 }));
    const rows = dayRows(days, hours, NOW, PANEL);
    expect(rows.map((r) => r.sky)).toEqual(["cerah", "hujan", "cerah", "cerah"]);
    expect(rows.map((r) => r.cause)).toEqual(["awan", "hujan", "awan dan hujan", "awan"]);
  });
  test("1 mm of daylight rain in a single hour is enough for hujan", () => {
    const hours = forecast(1, (_, hr) => (hr === 11 ? { precipMm: 1.2, weatherCode: 63 } : {}));
    const rows = dayRows([{ date: "2026-10-21", pvKwh: 2, rainy: true, maxPrecipMm: 1.2 }], hours, NOW, PANEL);
    expect(rows[0]!.sky).toBe("hujan");
  });
  test("a cloudy dry day reads berawan", () => {
    const hours = forecast(1, () => ({ cloudPct: 85 }));
    expect(dayRows([{ date: "2026-10-21", pvKwh: 3, rainy: false, maxPrecipMm: 0 }], hours, NOW, PANEL)[0]!.sky).toBe("berawan");
  });
  test("days before today (a stale forecast) are left out", () => {
    const days = [
      { date: "2026-10-20", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-21", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
    ];
    expect(dayRows(days, [], NOW, PANEL).map((r) => r.date)).toEqual(["2026-10-21"]);
  });
  test("with no panels there is no clear-sky reference", () => {
    const rows = dayRows([{ date: "2026-10-21", pvKwh: 0, rainy: false, maxPrecipMm: 0 }], [], NOW, { ...PANEL, kWp: 0 });
    expect(rows[0]!.dropPct).toBeNull();
  });
});

describe("axis scale", () => {
  test("rounds the top up to a clean number with three ticks", () => {
    expect(niceScale(0.37)).toEqual({ max: 0.4, ticks: [0, 0.2, 0.4] });
    expect(niceScale(2.6)).toEqual({ max: 4, ticks: [0, 2, 4] });
    expect(niceScale(4.31)).toEqual({ max: 5, ticks: [0, 2.5, 5] });
    expect(niceScale(5.08)).toEqual({ max: 6, ticks: [0, 3, 6] });
    expect(niceScale(33)).toEqual({ max: 40, ticks: [0, 20, 40] });
    expect(niceScale(18)).toEqual({ max: 20, ticks: [0, 10, 20] });
  });
  test("zero, negative or NaN gives a unit scale", () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 0.5, 1] });
    expect(niceScale(Number.NaN)).toEqual({ max: 1, ticks: [0, 0.5, 1] });
  });
  test("ticks show only the decimals they need, with a comma", () => {
    expect([0, 0.2, 0.25, 2.5, 10].map(tickText)).toEqual(["0", "0,2", "0,25", "2,5", "10"]);
  });
  test("hour labels use the Indonesian dot", () => {
    expect(hourLabel("2026-10-21T07:00")).toBe("07.00");
  });
});
