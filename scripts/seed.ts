// Loads data/seed/*.json and regions.geojson into the database. Idempotent (upserts).
// Run: bun run seed
import type { TransactionSQL } from "bun";
import type { HomeInput } from "../src/shared/auth.ts";
import * as db from "../src/server/db.ts";
import { sql } from "../src/server/db.ts";
import { buildHome } from "../src/server/routes/home.ts";
import { hashPassword } from "../src/server/services/session.ts";
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

interface PotentialSeed {
  source: string;
  points: { lng: number; lat: number; ghi: number; ws50: number; ws10: number }[];
}

async function seedPotential(tx: Tx) {
  const seed = await read<PotentialSeed>("re-potential.json");
  const ids: number[] = [];
  for (const p of seed.points) {
    const [row] = await tx`
      INSERT INTO re_potential (lng, lat, geom, ghi, ws50, ws10, source)
      VALUES (${p.lng}, ${p.lat}, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326), ${p.ghi}, ${p.ws50},
              ${p.ws10}, ${seed.source})
      ON CONFLICT (lng, lat) DO UPDATE SET
        geom = EXCLUDED.geom, ghi = EXCLUDED.ghi, ws50 = EXCLUDED.ws50, ws10 = EXCLUDED.ws10,
        source = EXCLUDED.source
      RETURNING id`;
    ids.push(Number(row.id));
  }
  // The seed file is the whole grid: a rebuilt grid must not leave old points behind.
  if (ids.length) await tx`DELETE FROM re_potential WHERE id NOT IN ${tx(ids)}`;
  return seed.points.length;
}

interface TerrainSeed {
  source: string;
  cells: { lng: number; lat: number; elevMean: number; elevMax: number; slopeMean: number; flat5Pct: number; flat10Pct: number }[];
}

/** Adds the terrain of each potential cell; cells missing from the terrain seed keep no terrain. */
async function seedTerrain(tx: Tx) {
  const seed = await read<TerrainSeed>("re-terrain.json");
  await tx`UPDATE re_potential SET elev_mean = NULL, elev_max = NULL, slope_mean = NULL, flat5_pct = NULL,
           flat10_pct = NULL, terrain_source = NULL`;
  for (const c of seed.cells) {
    await tx`
      UPDATE re_potential SET elev_mean = ${c.elevMean}, elev_max = ${c.elevMax}, slope_mean = ${c.slopeMean},
             flat5_pct = ${c.flat5Pct}, flat10_pct = ${c.flat10Pct}, terrain_source = ${seed.source}
      WHERE lng = ${c.lng} AND lat = ${c.lat}`;
  }
  return seed.cells.length;
}

interface DemoAccount {
  name: string;
  email: string;
  role: "warga" | "pemda";
  /** The home of a demo resident; government accounts have none. */
  home?: HomeInput;
}

interface DemoHomesSeed {
  source: string;
  homes: {
    lng: number;
    lat: number;
    footprintM2: number;
    osmId: string;
    city: string;
    buildingType: BuildingType;
    floors: number;
    kwhMonth: number | null;
    interestedPv: boolean;
    consentMap: boolean;
  }[];
}

const FIXED_DEMO_EMAIL = "demo@warga.local";
const PEMDA_DEMO_EMAIL = "demo@pemda.local";

/**
 * The demo accounts: the fixed "Warga Demo" with its home centred inside a confirmed map footprint, the government account, and one
 * resident per home of data/seed/demo-homes.json (real OpenStreetMap footprints, synthetic attributes;
 * scripts/build-demo-homes.ts builds the file). The Nth file entry is "Warga Demo N+1" (demoN+1@warga.local).
 */
function demoAccounts(seed: DemoHomesSeed): DemoAccount[] {
  return [
    {
      name: "Warga Demo",
      email: FIXED_DEMO_EMAIL,
      role: "warga",
      home: {
        featureId: "mapbox:575625507",
        lng: 117.1473174905973,
        lat: -0.4954460597499305,
        footprintM2: 127,
        heightM: 3,
        buildingType: "rumah",
        floors: 1,
        kwhMonth: 220,
        billRpMonth: null,
        interestedPv: true,
        consentMap: true,
      },
    },
    { name: "Pemda Demo Kaltim", email: PEMDA_DEMO_EMAIL, role: "pemda" },
    ...seed.homes.map((h, i): DemoAccount => ({
      name: `Warga Demo ${i + 2}`,
      email: `demo${i + 2}@warga.local`,
      role: "warga",
      home: {
        featureId: `osm:${h.osmId}`,
        lng: h.lng,
        lat: h.lat,
        footprintM2: h.footprintM2,
        heightM: null,
        buildingType: h.buildingType,
        floors: h.floors,
        kwhMonth: h.kwhMonth,
        billRpMonth: null,
        interestedPv: h.interestedPv,
        installedPv: i % 20 === 0,
        installedKwp: i % 20 === 0 ? 2.2 : null,
        consentMap: h.consentMap,
      },
    })),
  ];
}

/**
 * Upserts the demo accounts and the demo residents' homes, and removes demo accounts (demo = true only,
 * never a real user) that are no longer in the seed. The accounts share one random password hash nobody
 * knows, so they are only reachable through POST /api/auth/demo; an existing account keeps its hash. Runs
 * after the main transaction because it needs the region polygons to be committed (the home's region comes
 * from them) and goes through the same code the PUT /api/me/home route uses. A home that falls outside
 * Kaltim is skipped and counted.
 */
async function seedDemoAccounts(): Promise<Record<string, number>> {
  const accounts = demoAccounts(await read<DemoHomesSeed>("demo-homes.json"));
  const unusable = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
  const kept: string[] = [];
  let homes = 0;
  let skipped = 0;
  for (const a of accounts) {
    let built: Awaited<ReturnType<typeof buildHome>> | null = null;
    if (a.home) {
      built = await buildHome({ db }, a.home);
      if ("problem" in built) {
        if (a.email === FIXED_DEMO_EMAIL) throw new Error(`demo home of ${a.email}: ${built.problem}`);
        skipped += 1;
        continue;
      }
    }
    const [row] = await sql`
      INSERT INTO users (email, name, password_hash, role, demo)
      VALUES (${a.email}, ${a.name}, ${unusable}, ${a.role}, true)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, demo = true
      RETURNING id`;
    kept.push(a.email);
    if (built && "home" in built) {
      await db.homeUpsert(Number(row.id), built.home, true);
      homes += 1;
    }
  }
  // Their homes go with them (ON DELETE CASCADE).
  await sql`DELETE FROM users WHERE demo = true AND email NOT IN ${sql(kept)}`;
  return { demo_users: kept.length, demo_homes: homes, demo_homes_skipped: skipped };
}

/** Upserts every seed file in one transaction, then the demo accounts. Returns row counts per table. */
export async function seedAll(): Promise<Record<string, number>> {
  const counts = await sql.begin(async (tx) => ({
    regions: await seedRegions(tx),
    power_plants: await seedPlants(tx),
    grid_mix: await seedGrid(tx),
    building_types: await seedBuildingTypes(tx),
    equivalents: await seedEquivalents(tx),
    re_potential: await seedPotential(tx),
    re_terrain: await seedTerrain(tx),
  }));
  return { ...counts, ...(await seedDemoAccounts()) };
}

if (import.meta.main) {
  try {
    console.log("seeded", await seedAll());
  } finally {
    await sql.close();
  }
}
