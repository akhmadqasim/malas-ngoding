import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../../scripts/migrate.ts";
import { seedAll } from "../../scripts/seed.ts";
import {
  cacheGet,
  cacheGetAged,
  climatologyGet,
  climatologySet,
  cacheSet,
  getBuildingTypes,
  getEquivalentFactors,
  getGridMix,
  listPlants,
  listRegions,
  regionAt,
  regionById,
  regionGeoJSON,
  sql,
} from "../../src/server/db.ts";
import type { BuildingType } from "../../src/shared/types.ts";

const BUILDING_TYPES: BuildingType[] = [
  "rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus",
  "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri",
];

async function dbReachable(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const reachable = await dbReachable();
if (!reachable) {
  console.warn("SKIP tests/server/db.test.ts: database unreachable (start it with `docker compose up -d db`)");
}

describe.skipIf(!reachable)("db", () => {
  beforeAll(async () => {
    await runMigrations();
    await seedAll();
  });
  afterAll(async () => {
    await sql.close();
  });

  test("migrate and seed are idempotent", async () => {
    await runMigrations();
    await seedAll();
    const [row] = await sql`SELECT count(*)::int AS n FROM regions`;
    expect(row?.n).toBe(10);
  });

  test("listRegions returns 10 regions with co2 from the grid factor", async () => {
    const regions = await listRegions();
    expect(regions).toHaveLength(10);
    const samarinda = regions.find((r) => r.id === "samarinda");
    expect(samarinda?.kind).toBe("kota");
    expect(samarinda?.kwhYear).toBe(1380700000);
    expect(samarinda?.co2KgYear).toBeCloseTo(1380700000 * 1.14, 0);
    expect(samarinda?.estimated).toBe(true);
    const mahulu = regions.find((r) => r.id === "mahakam-ulu");
    expect(mahulu?.villagesNoPln).toBe(11);
    expect(regions.find((r) => r.id === "paser")?.villagesNoPln).toBeNull();
  });

  test("regionAt finds the region containing a point", async () => {
    expect(await regionAt(117.1466, -0.4998)).toEqual({ id: "samarinda", name: "Samarinda" });
    expect((await regionAt(116.8312, -1.2717))?.id).toBe("balikpapan");
  });

  test("regionAt returns null outside Kaltim", async () => {
    expect(await regionAt(106.8, -6.2)).toBeNull();
  });

  test("regionGeoJSON has 10 polygon features with summary properties", async () => {
    const fc = await regionGeoJSON();
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(10);
    for (const f of fc.features) {
      expect(["Polygon", "MultiPolygon"]).toContain(f.geometry.type);
      expect(typeof f.properties?.id).toBe("string");
      expect(typeof f.properties?.co2KgYear).toBe("number");
    }
  });

  test("getGridMix shares sum to 1 and carry the official factor", async () => {
    const mix = await getGridMix();
    const total = Object.values(mix.shares).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.01);
    expect(mix.factorKgPerKwh).toBe(1.14);
    expect(mix.shares.batubara).toBe(0.66);
    expect(mix.fuelFactors.batubara).toBe(1.04);
    expect(mix.source.length).toBeGreaterThan(0);
  });

  test("listPlants returns at least 10 point features", async () => {
    const fc = await listPlants();
    expect(fc.features.length).toBeGreaterThanOrEqual(10);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe("Point");
      expect(Object.keys(f.properties ?? {}).sort()).toEqual(
        ["approx", "capacityMw", "fuel", "name", "source", "status"],
      );
    }
  });

  test("getBuildingTypes covers all 12 types", async () => {
    const types = await getBuildingTypes();
    expect(Object.keys(types).sort()).toEqual([...BUILDING_TYPES].sort());
    expect(types.kantor.intensityKwhM2Year).toBe(181);
    expect(types.hotel.typicalFloors).toBe(6);
    expect(types.rumah.source.length).toBeGreaterThan(0);
  });

  test("getEquivalentFactors returns the 5 equivalents", async () => {
    const eq = await getEquivalentFactors();
    expect(eq.map((e) => e.key).sort()).toEqual(
      ["charge_hp", "mobil_km", "motor_km", "penerbangan", "pohon"],
    );
    expect(eq.find((e) => e.key === "pohon")?.kgCo2PerUnit).toBe(22);
  });

  test("regionById returns the summary with a centroid, or null", async () => {
    const r = await regionById("samarinda");
    expect(r?.name).toBe("Samarinda");
    expect(r?.kwhYear).toBe(1380700000);
    expect(r?.centroid).toHaveLength(2);
    expect(r?.centroid[0]).toBeGreaterThan(116);
    expect(r?.centroid[0]).toBeLessThan(118);
    expect(await regionById("nope")).toBeNull();
  });

  test("cacheSet and cacheGet round-trip objects and overwrite", async () => {
    expect(await cacheGet("poi_cache", "test:missing")).toBeNull();
    await cacheSet("poi_cache", "test:k", { poi: { class: "education", distanceM: 3 } });
    expect(await cacheGet("poi_cache", "test:k")).toEqual({ poi: { class: "education", distanceM: 3 } });
    await cacheSet("poi_cache", "test:k", { poi: null });
    expect(await cacheGet("poi_cache", "test:k")).toEqual({ poi: null });
    await cacheSet("building_estimates", "test:b", { kwhYear: 5 }, { footprintM2: 10 });
    expect(await cacheGet("building_estimates", "test:b")).toEqual({ kwhYear: 5 });
    await sql`DELETE FROM poi_cache WHERE key LIKE 'test:%'`;
    await sql`DELETE FROM building_estimates WHERE feature_id LIKE 'test:%'`;
  });

  test("cacheGetAged returns the payload with its fetched_at, and rejects other tables", async () => {
    expect(await cacheGetAged("weather_cache", "test:missing")).toBeNull();
    const before = Date.now() - 5000;
    await cacheSet("weather_cache", "test:w", { hours: [1, 2] });
    const row = await cacheGetAged("weather_cache", "test:w");
    expect(row?.payload).toEqual({ hours: [1, 2] });
    expect(row!.fetchedAt.getTime()).toBeGreaterThan(before);
    expect(row!.fetchedAt.getTime()).toBeLessThan(Date.now() + 5000);
    await sql`DELETE FROM weather_cache WHERE key LIKE 'test:%'`;
    await expect(cacheGetAged("regions" as any, "x")).rejects.toThrow(/Unknown cache table/);
  });

  test("climatologySet and climatologyGet round-trip the monthly array and overwrite", async () => {
    await sql`DELETE FROM solar_climatology WHERE key LIKE 'test:%'`;
    expect(await climatologyGet("test:-0.5,117.2")).toBeNull();
    const months = [4.5, 5, 5, 4.9, 4.7, 4.3, 4.6, 5, 5.1, 4.9, 4.6, 4.5];
    await climatologySet("test:-0.5,117.2", -0.5, 117.2, { pshByMonth: months, pshYear: 4.77 });
    expect(await climatologyGet("test:-0.5,117.2")).toEqual({ pshByMonth: months, pshYear: 4.77 });
    await climatologySet("test:-0.5,117.2", -0.5, 117.2, { pshByMonth: months.map(() => 4), pshYear: 4 });
    expect((await climatologyGet("test:-0.5,117.2"))?.pshYear).toBe(4);
    const [row] = await sql`SELECT jsonb_typeof(psh_by_month) AS t, jsonb_array_length(psh_by_month) AS n FROM solar_climatology WHERE key = 'test:-0.5,117.2'`;
    expect(row).toEqual({ t: "array", n: 12 });
    await sql`DELETE FROM solar_climatology WHERE key LIKE 'test:%'`;
  });

  test("cache functions reject table names outside the whitelist", async () => {
    await expect(cacheGet("regions; DROP TABLE regions" as any, "x")).rejects.toThrow(/Unknown cache table/);
    await expect(cacheSet("regions" as any, "x", {})).rejects.toThrow(/Unknown cache table/);
    expect((await sql`SELECT count(*)::int AS n FROM regions`)[0]?.n).toBe(10);
  });
});
