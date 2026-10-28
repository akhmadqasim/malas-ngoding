import { isRainyHour, type ForecastHour } from "./pvForecast.ts";
import type { RegionSummary } from "./types.ts";

/*
 * The digital twin's day: hour by hour, each region's electricity load (its yearly kWh spread over a daily
 * load curve), the rooftop solar it would make under the live Open-Meteo forecast, what is left for the PLN
 * grid and the CO2 that causes. Pure, so the sheet, the map columns and the tests compute the same numbers.
 */

/** What the server sends: the forecast hours per region from the current WITA hour, and the load curve. */
export interface TwinBasis {
  /** When the forecast was read (ISO). */
  syncedAt: string;
  /** True when Open-Meteo could not be reached and an older cached forecast is used. */
  stale: boolean;
  gridFactorKgPerKwh: number;
  /** 24 factors, hour 0 = 00.00-01.00 WITA; the source says it is an assumption. */
  profile: { hourlyFactor: number[]; source: string };
  /** `borrowedFrom`: the forecast could not be read here, so the nearest region's is used. */
  regions: { id: string; hours: ForecastHour[]; borrowedFrom?: string }[];
}

export interface TwinRegionHour {
  id: string;
  loadKw: number;
  solarKw: number;
  /** What the grid still supplies: the load minus the solar used on site. */
  gridKw: number;
  co2KgPerHour: number;
  ghiWm2: number;
  cloudPct: number;
  raining: boolean;
}

export interface TwinHour {
  /** WITA time without offset, as Open-Meteo gives it ("2026-10-22T14:00"). */
  time: string;
  regions: TwinRegionHour[];
  loadKw: number;
  solarKw: number;
  gridKw: number;
  /** Solar beyond the load, sent to the grid for no credit. */
  surplusKw: number;
  co2KgPerHour: number;
}

/** Panel performance ratio, as in the building solar simulation (shared/solar.ts). */
const PERFORMANCE_RATIO = 0.78;
const HOURS_PER_YEAR = 8760;

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** The load curve scaled to a mean of 1 (a flat 1 for a bad curve), so it never changes the yearly kWh. */
export function normaliseProfile(factors: number[]): number[] {
  const clean = Array.from({ length: 24 }, (_, i) => pos(factors[i] ?? 0));
  const mean = clean.reduce((a, b) => a + b, 0) / 24;
  return mean > 0 ? clean.map((f) => f / mean) : Array<number>(24).fill(1);
}

/** The WITA hour of day (0..23) of a forecast time ("2026-10-22T14:00"). */
export const hourOf = (time: string) => Number(time.slice(11, 13)) || 0;

/**
 * The twin's timeline: one entry per forecast hour of the first region that has any (all regions share the
 * same hours). `kWpByRegion` is the rooftop solar installed per region (none, or the scenario's).
 */
export function twinTimeline(regions: RegionSummary[], basis: TwinBasis, kWpByRegion: ReadonlyMap<string, number> = new Map()): TwinHour[] {
  const profile = normaliseProfile(basis.profile.hourlyFactor);
  const byRegion = new Map(basis.regions.map((r) => [r.id, new Map(r.hours.map((h) => [h.time, h]))]));
  const times = basis.regions.find((r) => r.hours.length > 0)?.hours.map((h) => h.time) ?? [];
  const factor = pos(basis.gridFactorKgPerKwh);
  return times.map((time) => {
    const k = profile[hourOf(time)] ?? 1;
    const rows = regions.map((r): TwinRegionHour => {
      const h = byRegion.get(r.id)?.get(time);
      const loadKw = (pos(r.kwhYear) / HOURS_PER_YEAR) * k;
      const ghiWm2 = pos(h?.ghiWm2 ?? 0);
      const solarKw = pos(kWpByRegion.get(r.id) ?? 0) * (ghiWm2 / 1000) * PERFORMANCE_RATIO;
      const gridKw = Math.max(loadKw - solarKw, 0);
      return {
        id: r.id,
        loadKw,
        solarKw,
        gridKw,
        co2KgPerHour: gridKw * factor,
        ghiWm2,
        cloudPct: h?.cloudPct ?? 0,
        raining: h ? isRainyHour(h) : false,
      };
    });
    const sum = (f: (r: TwinRegionHour) => number) => rows.reduce((t, r) => t + f(r), 0);
    return {
      time,
      regions: rows,
      loadKw: sum((r) => r.loadKw),
      solarKw: sum((r) => r.solarKw),
      gridKw: sum((r) => r.gridKw),
      surplusKw: sum((r) => Math.max(r.solarKw - r.loadKw, 0)),
      co2KgPerHour: sum((r) => r.co2KgPerHour),
    };
  });
}

/**
 * Per region, its CO2 at this hour against its average hour (the yearly CO2 / 8760): the map scales the CO2
 * columns by it, so they swell at the evening peak and dip where the sun covers the load.
 */
export function twinScale(hour: TwinHour, regions: RegionSummary[]): Map<string, number> {
  const avgKw = new Map(regions.map((r) => [r.id, pos(r.kwhYear) / HOURS_PER_YEAR]));
  return new Map(hour.regions.map((r) => [r.id, (avgKw.get(r.id) ?? 0) > 0 ? r.gridKw / avgKw.get(r.id)! : 1]));
}
