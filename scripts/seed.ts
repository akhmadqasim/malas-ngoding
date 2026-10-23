// Loads data/seed/*.json and regions.geojson into the database. Idempotent (upserts).
// Run: bun run seed
import type { TransactionSQL } from "bun";
import { sql } from "../src/server/db.ts";
import type { BuildingType, EquivalentFactor, FuelType, GridMix } from "../src/shared/types.ts";

const SEED_DIR = new URL("../data/seed/", import.meta.url);
const read = <T>(name: string): Promise<T> => Bun.file(new URL(name, SEED_DIR)).json() as Promise<T>;

interface RegionSeed {
  id: string;
  name: string;
  kind: "kabupaten" | "kota";
  kwhYear: number;
  population: number | null;
  customers: number | null;
  electrificationPct: number | null;
  villagesNoPln: number | null;
  estimated: boolean;
  source: string;
}
interface PlantSeed {
  name: string;
  fuel: FuelType;
  capacityMw: number;
  status: string;
  lat: number;
  lng: number;
  approx: boolean;
  source: string;
}
interface BoundaryCollection {
  features: { properties: { id: string }; geometry: unknown }[];
}
type BuildingSeed = Record<
  BuildingType,
  { intensityKwhM2Year: number; typicalFloors: number; source: string }
>;

type Tx = TransactionSQL;

async function seedRegions(tx: Tx) {
  const regions = await read<RegionSeed[]>("regions.json");
  const boundaries = await read<BoundaryCollection>("regions.geojson");
  const geomById = new Map(boundaries.features.map((f) => [f.properties.id, f.geometry]));
  for (const r of regions) {
    const geometry = geomById.get(r.id);
    if (!geometry) throw new Error(`no boundary for region ${r.id}; run build-boundaries`);
    const geojson = JSON.stringify(geometry);
    await tx`
      INSERT INTO regions (id, name, kind, geom, centroid, kwh_year, population, customers,
                           electrification_pct, villages_no_pln, estimated, source)
      SELECT ${r.id}, ${r.name}, ${r.kind}, g.geom, ST_PointOnSurface(g.geom), ${r.kwhYear},
             ${r.population}, ${r.customers}, ${r.electrificationPct}, ${r.villagesNoPln},
             ${r.estimated}, ${r.source}
      FROM (SELECT ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))) AS geom) g
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, kind = EXCLUDED.kind, geom = EXCLUDED.geom,
        centroid = EXCLUDED.centroid, kwh_year = EXCLUDED.kwh_year,
        population = EXCLUDED.population, customers = EXCLUDED.customers,
        electrification_pct = EXCLUDED.electrification_pct,
        villages_no_pln = EXCLUDED.villages_no_pln, estimated = EXCLUDED.estimated,
        source = EXCLUDED.source`;
  }
  return regions.length;
}

async function seedPlants(tx: Tx) {
  const plants = await read<PlantSeed[]>("plants.json");
  for (const p of plants) {
    await tx`
      INSERT INTO power_plants (name, fuel, capacity_mw, status, geom, approx, source)
      VALUES (${p.name}, ${p.fuel}, ${p.capacityMw}, ${p.status},
              ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326), ${p.approx}, ${p.source})
      ON CONFLICT (name) DO UPDATE SET
        fuel = EXCLUDED.fuel, capacity_mw = EXCLUDED.capacity_mw, status = EXCLUDED.status,
        geom = EXCLUDED.geom, approx = EXCLUDED.approx, source = EXCLUDED.source`;
  }
  // The seed file is the whole list: a plant renamed or removed there must not linger on the map.
  await tx`DELETE FROM power_plants WHERE name NOT IN ${tx(plants.map((p) => p.name))}`;
  return plants.length;
}

async function seedGrid(tx: Tx) {
  const grid = await read<GridMix>("grid.json");
  const fuels = Object.keys(grid.shares) as FuelType[];
  for (const fuel of fuels) {
    await tx`
      INSERT INTO grid_mix (year, fuel, share, fuel_factor, grid_factor, source)
      VALUES (${grid.year}, ${fuel}, ${grid.shares[fuel]}, ${grid.fuelFactors[fuel]},
              ${grid.factorKgPerKwh}, ${grid.source})
      ON CONFLICT (year, fuel) DO UPDATE SET
        share = EXCLUDED.share, fuel_factor = EXCLUDED.fuel_factor,
        grid_factor = EXCLUDED.grid_factor, source = EXCLUDED.source`;
  }
  return fuels.length;
}

async function seedBuildingTypes(tx: Tx) {
  const types = await read<BuildingSeed>("building-types.json");
  const entries = Object.entries(types);
  for (const [type, t] of entries) {
    await tx`
      INSERT INTO building_types (type, intensity_kwh_m2_year, typical_floors, source)
      VALUES (${type}, ${t.intensityKwhM2Year}, ${t.typicalFloors}, ${t.source})
      ON CONFLICT (type) DO UPDATE SET
        intensity_kwh_m2_year = EXCLUDED.intensity_kwh_m2_year,
        typical_floors = EXCLUDED.typical_floors, source = EXCLUDED.source`;
  }
  return entries.length;
}

async function seedEquivalents(tx: Tx) {
  const items = await read<(EquivalentFactor & { source: string })[]>("equivalents.json");
  for (const e of items) {
    await tx`
      INSERT INTO equivalents (key, label, kg_co2_per_unit, unit, source)
      VALUES (${e.key}, ${e.label}, ${e.kgCo2PerUnit}, ${e.unit}, ${e.source})
      ON CONFLICT (key) DO UPDATE SET
        label = EXCLUDED.label, kg_co2_per_unit = EXCLUDED.kg_co2_per_unit,
        unit = EXCLUDED.unit, source = EXCLUDED.source`;
  }
  await tx`DELETE FROM equivalents WHERE key NOT IN ${tx(items.map((e) => e.key))}`;
  return items.length;
}

/** Upserts every seed file in one transaction. Returns row counts per table. */
export async function seedAll(): Promise<Record<string, number>> {
  return sql.begin(async (tx) => ({
    regions: await seedRegions(tx),
    power_plants: await seedPlants(tx),
    grid_mix: await seedGrid(tx),
    building_types: await seedBuildingTypes(tx),
    equivalents: await seedEquivalents(tx),
  }));
}

if (import.meta.main) {
  try {
    console.log("seeded", await seedAll());
  } finally {
    await sql.close();
  }
}
