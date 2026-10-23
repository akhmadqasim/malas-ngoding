import { describe, expect, test } from "bun:test";
import { hoursFrom, TWIN_HOURS, withNeighbourFallback } from "../../src/server/routes/twin.ts";
import type { ForecastHour } from "../../src/shared/pvForecast.ts";

const day = (from: string, n: number): ForecastHour[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(`${from}:00+08:00`) + i * 3_600_000);
    // WITA time without offset, as Open-Meteo gives it.
    const wita = new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
    return { time: wita, ghiWm2: 0, cloudPct: 0, precipMm: 0, weatherCode: 0 };
  });

describe("hoursFrom", () => {
  test("starts at the hour now falls in and keeps TWIN_HOURS", () => {
    const hours = day("2026-10-22T00:00", 48);
    const now = Date.parse("2026-10-22T14:35:00+08:00");
    const from = hoursFrom(hours, now);
    expect(from[0]!.time).toBe("2026-10-22T14:00");
    expect(from).toHaveLength(TWIN_HOURS);
  });
});

describe("withNeighbourFallback", () => {
  test("a region without a forecast borrows the nearest region's and says so", () => {
    const hours = day("2026-10-22T00:00", 2);
    const out = withNeighbourFallback([
      { id: "near", point: [117, -0.5], hours },
      { id: "far", point: [115, 1], hours: day("2026-10-23T00:00", 2) },
      { id: "missing", point: [117.1, -0.4], hours: [] },
      { id: "nowhere", point: null, hours: [] },
    ]);
    expect(out[2]).toEqual({ id: "missing", hours, borrowedFrom: "near" });
    expect(out[3]).toEqual({ id: "nowhere", hours: [] });
    expect(out[0]).toEqual({ id: "near", hours });
  });
});
