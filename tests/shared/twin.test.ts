import { describe, expect, test } from "bun:test";
import type { ForecastHour } from "../../src/shared/pvForecast.ts";
import { hourOf, normaliseProfile, type TwinBasis, twinScale, twinTimeline } from "../../src/shared/twin.ts";
import type { RegionSummary } from "../../src/shared/types.ts";

const region = (id: string, kwhYear: number): RegionSummary => ({
  id,
  name: id,
  kind: "kota",
  kwhYear,
  co2KgYear: kwhYear * 1.14,
  population: null,
  customers: null,
  electrificationPct: null,
  villagesNoPln: null,
  estimated: true,
});
const hour = (time: string, ghiWm2: number, precipMm = 0): ForecastHour => ({ time, ghiWm2, cloudPct: 50, precipMm, weatherCode: 0 });

// 8760 kWh a year is an average load of 1 kW.
const regions = [region("a", 8760), region("b", 17_520)];
const flat = Array<number>(24).fill(1);
const basis = (factors = flat): TwinBasis => ({
  syncedAt: "2026-10-22T06:00:00.000Z",
  stale: false,
  gridFactorKgPerKwh: 1.14,
  profile: { hourlyFactor: factors, source: "asumsi" },
  regions: [
    { id: "a", hours: [hour("2026-10-22T02:00", 0), hour("2026-10-22T12:00", 1000, 2)] },
    { id: "b", hours: [hour("2026-10-22T02:00", 0), hour("2026-10-22T12:00", 500)] },
  ],
});

describe("normaliseProfile", () => {
  test("scales the curve to a mean of 1 and falls back to flat", () => {
    const p = normaliseProfile([...Array<number>(12).fill(1), ...Array<number>(12).fill(3)]);
    expect(p.reduce((a, b) => a + b, 0) / 24).toBeCloseTo(1);
    expect(p[0]).toBeCloseTo(0.5);
    expect(normaliseProfile([])).toEqual(flat);
  });
});

describe("twinTimeline", () => {
  test("load follows the curve, and the yearly kWh stays the same over a day", () => {
    const curve = flat.map((_, i) => (i === 2 ? 2 : 1));
    const t = twinTimeline(regions, basis(curve));
    expect(t.map((h) => h.time)).toEqual(["2026-10-22T02:00", "2026-10-22T12:00"]);
    const mean = 25 / 24;
    expect(t[0]!.regions[0]!.loadKw).toBeCloseTo(2 / mean);
    expect(t[1]!.regions[0]!.loadKw).toBeCloseTo(1 / mean);
    expect(hourOf("2026-10-22T19:00")).toBe(19);
  });

  test("rooftop solar follows the forecast sun and never pushes the grid below zero", () => {
    const t = twinTimeline(regions, basis(), new Map([["a", 2], ["b", 1]]));
    const noon = t[1]!;
    const a = noon.regions.find((r) => r.id === "a")!;
    expect(a.solarKw).toBeCloseTo(2 * 1 * 0.78);
    expect(a.gridKw).toBe(0);
    expect(a.raining).toBe(true);
    const b = noon.regions.find((r) => r.id === "b")!;
    expect(b.gridKw).toBeCloseTo(2 - 0.5 * 0.78);
    expect(noon.surplusKw).toBeCloseTo(1.56 - 1);
    expect(noon.co2KgPerHour).toBeCloseTo(b.gridKw * 1.14);
    // At night there is no sun.
    expect(t[0]!.solarKw).toBe(0);
  });

  test("no forecast gives an empty day", () => {
    expect(twinTimeline(regions, { ...basis(), regions: [] })).toEqual([]);
  });
});

describe("twinScale", () => {
  test("is the CO2 of the hour against the region's average hour", () => {
    const curve = flat.map((_, i) => (i === 2 ? 2 : 1));
    const t = twinTimeline(regions, basis(curve));
    expect(twinScale(t[0]!, regions).get("a")).toBeCloseTo(2 / (25 / 24));
    const sunny = twinTimeline(regions, basis(), new Map([["a", 2]]));
    expect(twinScale(sunny[1]!, regions).get("a")).toBe(0);
  });
});
