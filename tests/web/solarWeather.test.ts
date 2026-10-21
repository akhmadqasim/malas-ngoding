import { describe, expect, test } from "bun:test";
import type { BuildingEstimate, PvHour } from "../../src/shared/types.ts";
import {
  dayLabel,
  dayRows,
  forecastWindow,
  hourLabel,
  isRainyHour,
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
  test("labels: Hari ini, Besok, then weekday and date", () => {
    expect(witaDate(NOW)).toBe("2026-10-21");
    expect(dayLabel("2026-10-21", "2026-10-21")).toBe("Hari ini");
    expect(dayLabel("2026-10-22", "2026-10-21")).toBe("Besok");
    expect(dayLabel("2026-10-23", "2026-10-21")).toBe("Jum 23");
  });
  test("a day of rain says how much less the panels make than the best day", () => {
    // 22 Oct rains all afternoon: its output drops from 11 x 0.4 to 7 x 0.4 + 4 x 0.1.
    const hours = forecast(3, (date, hr) => (date === "2026-10-22" && hr >= 14 ? { precipMm: 3, weatherCode: 63, pvKwh: hr <= 17 ? 0.1 : 0, cloudPct: 100 } : {}));
    const days = [
      { date: "2026-10-21", pvKwh: 4.4, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-22", pvKwh: 3.2, rainy: true, maxPrecipMm: 3 },
      { date: "2026-10-23", pvKwh: 4.4, rainy: false, maxPrecipMm: 0 },
    ];
    const rows = dayRows(days, hours, NOW);
    expect(rows.map((r) => r.label)).toEqual(["Hari ini", "Besok", "Jum 23"]);
    expect(rows.map((r) => r.sky)).toEqual(["cerah", "hujan", "cerah"]);
    expect(rows[1]!.dropPct).toBe(27); // (4,4 - 3,2) / 4,4
    expect(rows[0]!.dropPct).toBeNull();
  });
  test("rain only at night is not a rainy day for the panels", () => {
    const hours = forecast(1, (_, hr) => (hr === 2 ? { precipMm: 5, weatherCode: 63 } : {}));
    const rows = dayRows([{ date: "2026-10-21", pvKwh: 4.4, rainy: true, maxPrecipMm: 5 }], hours, NOW);
    expect(rows[0]!.sky).toBe("cerah");
  });
  test("days before today (a stale forecast) are left out", () => {
    const days = [
      { date: "2026-10-20", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-21", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
    ];
    expect(dayRows(days, [], NOW).map((r) => r.date)).toEqual(["2026-10-21"]);
  });
  test("in the rainy season the best day is the reference, even when it rained too", () => {
    const days = [
      { date: "2026-10-21", pvKwh: 2, rainy: true, maxPrecipMm: 5 },
      { date: "2026-10-22", pvKwh: 3, rainy: true, maxPrecipMm: 5 },
    ];
    expect(dayRows(days, [], NOW).map((r) => r.dropPct)).toEqual([33, null]);
  });
  test("a cloudy dry day reads berawan and shows its drop; a clear day never does", () => {
    const hours = forecast(2, (date) => (date === "2026-10-21" ? { cloudPct: 85 } : {}));
    const days = [
      { date: "2026-10-21", pvKwh: 3, rainy: false, maxPrecipMm: 0 },
      { date: "2026-10-22", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
    ];
    const rows = dayRows(days, hours, NOW);
    expect(rows.map((r) => r.sky)).toEqual(["berawan", "cerah"]);
    expect(rows[0]!.dropPct).toBe(25);
    const clear = dayRows([days[0]!, days[1]!], forecast(2), NOW);
    expect(clear[0]!.dropPct).toBeNull();
  });
  test("a drop under 5% is not worth a line", () => {
    const days = [
      { date: "2026-10-21", pvKwh: 3.9, rainy: true, maxPrecipMm: 1 },
      { date: "2026-10-22", pvKwh: 4, rainy: false, maxPrecipMm: 0 },
    ];
    expect(dayRows(days, [], NOW)[0]!.dropPct).toBeNull();
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
