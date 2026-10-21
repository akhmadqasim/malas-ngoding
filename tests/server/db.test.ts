import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runMigrations } from "../../scripts/migrate.ts";
import { seedAll } from "../../scripts/seed.ts";
import {
  addChatMessage,
  cacheGet,
  cacheGetAged,
  chatHistory,
  climatologyGet,
  climatologySet,
  cacheSet,
  ensureChatSession,
  getBuildingTypes,
  getEquivalentFactors,
  getGridMix,
  listPlants,
  listRegions,
  plantsInRegion,
  recommendationsGet,
  recommendationsSet,
  regionAt,
  regionById,
  regionGeoJSON,
  regionLabelPoint,
  sql,
} from "../../src/server/db.ts";
import type { BuildingType, RecommendationItem } from "../../src/shared/types.ts";

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

  test("display geometry drops island slivers under 30 km2, the lookup keeps them", async () => {
    const fc = await regionGeoJSON();
    const berau = fc.features.find((f) => f.properties?.id === "berau");
    expect(berau).toBeDefined();
    const shape = JSON.stringify(berau!.geometry);
    // Points inside two small Berau islands (from ST_PointOnSurface): Derawan (0.3 km2) and Maratua (22.6 km2).
    const islands: [number, number][] = [
      [118.24354062903225, 2.2836],
      [118.57871952952685, 2.230055],
    ];
    for (const [lng, lat] of islands) {
      const [row] = await sql`
        SELECT bool_or(ST_Intersects(d.geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))) AS shown
        FROM ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${shape}), 4326)) d`;
      expect(row?.shown).toBe(false);
      expect(await regionAt(lng, lat)).toEqual({ id: "berau", name: "Berau" });
    }
    // Every region keeps its main body, and no displayed part is smaller than the threshold.
    for (const f of fc.features) {
      const [row] = await sql`
        SELECT min(ST_Area(d.geom::geography)) AS min_m2, count(*)::int AS parts
        FROM ST_Dump(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)) d`;
      expect(row?.parts).toBeGreaterThanOrEqual(1);
      expect(Number(row?.min_m2)).toBeGreaterThanOrEqual(30e6);
    }
  });

  test("every region carries a label point inside it (inscribed-circle centre of its largest part)", async () => {
    const fc = await regionGeoJSON();
    for (const f of fc.features) {
      const point = f.properties?.labelPoint as [number, number] | undefined;
      expect(Array.isArray(point)).toBe(true);
      const [lng, lat] = point!;
      expect(await regionAt(lng, lat)).toEqual({ id: f.properties?.id as string, name: f.properties?.name as string });
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

  test("plantsInRegion returns the plants whose point lies inside the region, largest first", async () => {
    const kukar = await plantsInRegion("kutai-kartanegara");
    expect(kukar.map((p) => p.name)).toContain("PLTGU Tanjung Batu");
    expect(kukar.map((p) => p.name)).not.toContain("PLTU Kaltim Teluk Balikpapan");
    for (let i = 1; i < kukar.length; i++) expect(kukar[i - 1]!.capacityMw).toBeGreaterThanOrEqual(kukar[i]!.capacityMw);
    expect(Object.keys(kukar[0]!).sort()).toEqual(["approx", "capacityMw", "fuel", "name", "source", "status"]);
    expect(typeof kukar[0]!.approx).toBe("boolean");
    expect((await plantsInRegion("balikpapan")).map((p) => p.name)).toContain("PLTU Kaltim Teluk Balikpapan");
    expect(await plantsInRegion("mahakam-ulu")).toEqual([]);
    expect(await plantsInRegion("nope")).toEqual([]);
  });

  test("regionLabelPoint is the label point regionGeoJSON shows, or null", async () => {
    const fc = await regionGeoJSON();
    for (const f of fc.features) {
      const [lng, lat] = f.properties?.labelPoint as [number, number];
      const point = await regionLabelPoint(String(f.properties?.id));
      expect(point?.[0]).toBeCloseTo(lng, 4);
      expect(point?.[1]).toBeCloseTo(lat, 4);
    }
    expect(await regionLabelPoint("nope")).toBeNull();
  });

  test("recommendationsSet and recommendationsGet round-trip and overwrite", async () => {
    // The table is keyed by a real region, so keep whatever a warm-up stored there and put it back.
    const id = "bontang";
    const [backup] = await sql`SELECT content, model, generated_at FROM recommendations WHERE region_id = ${id}`;
    const items: RecommendationItem[] = [
      { title: "Judul", category: "kebijakan", body: "Isi.", impact: "Dampak.", priority: 2 },
    ];
    try {
      await sql`DELETE FROM recommendations WHERE region_id = ${id}`;
      expect(await recommendationsGet(id)).toBeNull();
      const at = await recommendationsSet(id, items, "test-model");
      expect(at).toBeInstanceOf(Date);
      expect(await recommendationsGet(id)).toEqual({ items, model: "test-model", generatedAt: at });
      const [shape] = await sql`
        SELECT jsonb_typeof(content) AS content, jsonb_typeof(content->'items') AS items
        FROM recommendations WHERE region_id = ${id}`;
      expect(shape).toEqual({ content: "object", items: "array" });

      const later = await recommendationsSet(id, [{ ...items[0]!, title: "Baru" }], "test-model-2");
      const row = await recommendationsGet(id);
      expect(row?.model).toBe("test-model-2");
      expect((row?.items as RecommendationItem[])[0]?.title).toBe("Baru");
      expect(later.getTime()).toBeGreaterThanOrEqual(at.getTime());
      expect(await recommendationsGet("nope")).toBeNull();
    } finally {
      if (backup) {
        await sql`
          INSERT INTO recommendations (region_id, content, model, generated_at)
          VALUES (${id}, ${backup.content}, ${backup.model}, ${backup.generated_at})
          ON CONFLICT (region_id) DO UPDATE
            SET content = EXCLUDED.content, model = EXCLUDED.model, generated_at = EXCLUDED.generated_at`;
      } else {
        await sql`DELETE FROM recommendations WHERE region_id = ${id}`;
      }
    }
  });

  test("cache functions reject table names outside the whitelist", async () => {
    await expect(cacheGet("regions; DROP TABLE regions" as any, "x")).rejects.toThrow(/Unknown cache table/);
    await expect(cacheSet("regions" as any, "x", {})).rejects.toThrow(/Unknown cache table/);
    expect((await sql`SELECT count(*)::int AS n FROM regions`)[0]?.n).toBe(10);
  });

  test("a chat session is created once and its history returns the last messages oldest first", async () => {
    const id = crypto.randomUUID();
    const action = { name: "fly_to_region", input: { region: "samarinda" } };
    try {
      await ensureChatSession(id);
      await ensureChatSession(id);
      expect((await sql`SELECT count(*)::int AS n FROM chat_sessions WHERE id = ${id}`)[0]?.n).toBe(1);
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 0) await addChatMessage(id, "user", { text: `tanya ${i}` });
        else await addChatMessage(id, "assistant", { text: `jawab ${i}`, actions: [action] });
      }
      expect(await chatHistory(id, 3)).toEqual([
        { role: "user", text: "tanya 2", actions: [] },
        { role: "assistant", text: "jawab 3", actions: [action] },
        { role: "user", text: "tanya 4", actions: [] },
      ]);
      expect(await chatHistory(id, 20)).toHaveLength(5);
      expect(await chatHistory(crypto.randomUUID(), 20)).toEqual([]);
      const [row] = await sql`
        SELECT content FROM chat_messages WHERE session_id = ${id} AND role = 'assistant' ORDER BY id LIMIT 1`;
      expect(row?.content).toEqual({ text: "jawab 1", actions: [action] });
    } finally {
      await sql`DELETE FROM chat_sessions WHERE id = ${id}`;
    }
    expect((await sql`SELECT count(*)::int AS n FROM chat_messages WHERE session_id = ${id}`)[0]?.n).toBe(0);
  });

  test("a chat message for a session that does not exist is rejected", async () => {
    await expect(addChatMessage(crypto.randomUUID(), "user", { text: "x" })).rejects.toThrow();
  });
});
