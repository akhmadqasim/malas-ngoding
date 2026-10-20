import { SQL } from "bun";
import type {
  BuildingType,
  EquivalentFactor,
  FuelType,
  GridMix,
  RegionSummary,
} from "../shared/types.ts";
import { env } from "./env.ts";

export const sql = new SQL(env.databaseUrl);

export interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}
export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

/** The region whose polygon contains the point, or null outside Kalimantan Timur. */
export async function regionAt(
  lng: number,
  lat: number,
): Promise<{ id: string; name: string } | null> {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const rows = await sql`
    SELECT id, name FROM regions
    WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
    LIMIT 1`;
  const row = rows[0];
  return row ? { id: row.id, name: row.name } : null;
}

/** Latest grid factor (kg CO2 per kWh). Falls back to the official Mahakam value. */
async function latestGridFactor(): Promise<number> {
  const rows = await sql`SELECT grid_factor FROM grid_mix ORDER BY year DESC LIMIT 1`;
  return Number(rows[0]?.grid_factor ?? 1.14);
}

function toSummary(r: Record<string, unknown>, factor: number): RegionSummary {
  const kwhYear = Number(r.kwh_year);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as RegionSummary["kind"],
    kwhYear,
    co2KgYear: kwhYear * factor,
    population: num(r.population),
    customers: num(r.customers),
    electrificationPct: num(r.electrification_pct),
    villagesNoPln: num(r.villages_no_pln),
    estimated: Boolean(r.estimated),
  };
}

export async function listRegions(): Promise<RegionSummary[]> {
  const factor = await latestGridFactor();
  const rows = await sql`
    SELECT id, name, kind, kwh_year, population, customers, electrification_pct,
           villages_no_pln, estimated
    FROM regions ORDER BY name`;
  return rows.map((r: Record<string, unknown>) => toSummary(r, factor));
}

export async function regionGeoJSON(): Promise<FeatureCollection> {
  const factor = await latestGridFactor();
  const rows = await sql`
    SELECT id, name, kind, kwh_year, population, customers, electrification_pct,
           villages_no_pln, estimated,
           ST_AsGeoJSON(geom, 6)::text AS geometry
    FROM regions ORDER BY name`;
  return {
    type: "FeatureCollection",
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      properties: { ...toSummary(r, factor) },
      geometry: JSON.parse(String(r.geometry)),
    })),
  };
}

export async function getGridMix(): Promise<GridMix> {
  const rows = await sql`
    SELECT year, fuel, share, fuel_factor, grid_factor, source FROM grid_mix
    WHERE year = (SELECT max(year) FROM grid_mix)`;
  const first = rows[0];
  if (!first) throw new Error("grid_mix is empty; run `bun run seed`");
  const shares = {} as Record<FuelType, number>;
  const fuelFactors = {} as Record<FuelType, number>;
  for (const r of rows) {
    shares[r.fuel as FuelType] = Number(r.share);
    fuelFactors[r.fuel as FuelType] = Number(r.fuel_factor);
  }
  return {
    year: Number(first.year),
    factorKgPerKwh: Number(first.grid_factor),
    shares,
    fuelFactors,
    source: String(first.source),
  };
}

export async function listPlants(): Promise<FeatureCollection> {
  const rows = await sql`
    SELECT name, fuel, capacity_mw, status, approx, source,
           ST_AsGeoJSON(geom, 6)::text AS geometry
    FROM power_plants ORDER BY capacity_mw DESC, name`;
  return {
    type: "FeatureCollection",
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      properties: {
        name: r.name,
        fuel: r.fuel,
        capacityMw: Number(r.capacity_mw),
        status: r.status,
        approx: Boolean(r.approx),
        source: r.source,
      },
      geometry: JSON.parse(String(r.geometry)),
    })),
  };
}

export async function getBuildingTypes(): Promise<
  Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number; source: string }>
> {
  const rows = await sql`
    SELECT type, intensity_kwh_m2_year, typical_floors, source FROM building_types`;
  const out = {} as Record<
    BuildingType,
    { intensityKwhM2Year: number; typicalFloors: number; source: string }
  >;
  for (const r of rows) {
    out[r.type as BuildingType] = {
      intensityKwhM2Year: Number(r.intensity_kwh_m2_year),
      typicalFloors: Number(r.typical_floors),
      source: String(r.source),
    };
  }
  return out;
}

export async function getEquivalentFactors(): Promise<EquivalentFactor[]> {
  const rows = await sql`SELECT key, label, kg_co2_per_unit, unit FROM equivalents ORDER BY key`;
  return rows.map((r: Record<string, unknown>) => ({
    key: r.key as EquivalentFactor["key"],
    label: String(r.label),
    kgCo2PerUnit: Number(r.kg_co2_per_unit),
    unit: String(r.unit),
  }));
}
