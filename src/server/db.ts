import { SQL } from "bun";
import type {
  BuildingType,
  EquivalentFactor,
  FuelType,
  GridMix,
  RegionSummary,
} from "../shared/types.ts";
import { env } from "./env.ts";
import type { Climatology } from "./services/nasaPower.ts";

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

/**
 * Polygon parts smaller than this are left out of the display geometry: tiny islands and delta slivers
 * extrude into thin "fence" columns at the province view. `regionAt` still uses the full geometry, so a
 * click on Derawan still resolves to Berau.
 */
export const DISPLAY_MIN_PART_M2 = 30e6;

/**
 * Display geometry and a label point for every region. The label point is the centre of the largest
 * circle that fits inside the region's largest part: unlike the centroid it always lies inside the
 * region (Mahakam Ulu's centroid does not), and it sits where the region is widest.
 */
export async function regionGeoJSON(): Promise<FeatureCollection> {
  const factor = await latestGridFactor();
  const rows = await sql`
    SELECT id, name, kind, kwh_year, population, customers, electrification_pct,
           villages_no_pln, estimated,
           ST_AsGeoJSON(
             COALESCE(
               (SELECT ST_Multi(ST_Collect(d.geom)) FROM ST_Dump(r.geom) d
                WHERE ST_Area(d.geom::geography) >= ${DISPLAY_MIN_PART_M2}),
               r.geom),
             6)::text AS geometry,
           ST_X(lp.center) AS label_lng, ST_Y(lp.center) AS label_lat
    FROM regions r
    CROSS JOIN LATERAL (
      SELECT (ST_MaximumInscribedCircle(d.geom)).center
      FROM ST_Dump(r.geom) d ORDER BY ST_Area(d.geom) DESC LIMIT 1
    ) lp
    ORDER BY name`;
  return {
    type: "FeatureCollection",
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      properties: {
        ...toSummary(r, factor),
        labelPoint: [Math.round(Number(r.label_lng) * 1e5) / 1e5, Math.round(Number(r.label_lat) * 1e5) / 1e5],
      },
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

/** One region with its centroid, or null when the id does not exist. */
export async function regionById(
  id: string,
): Promise<(RegionSummary & { centroid: [number, number] }) | null> {
  const factor = await latestGridFactor();
  const rows = await sql`
    SELECT id, name, kind, kwh_year, population, customers, electrification_pct,
           villages_no_pln, estimated,
           ST_X(centroid) AS lng, ST_Y(centroid) AS lat
    FROM regions WHERE id = ${id}`;
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row, factor), centroid: [Number(row.lng), Number(row.lat)] };
}

/** Cache tables and the columns that hold the key and the cached value. */
const CACHE_TABLES = {
  poi_cache: { key: "key", value: "payload" },
  weather_cache: { key: "key", value: "payload" },
  building_estimates: { key: "feature_id", value: "result" },
} as const;
export type CacheTable = keyof typeof CACHE_TABLES;

function cacheColumns(table: string) {
  if (!Object.hasOwn(CACHE_TABLES, table)) throw new Error(`Unknown cache table: ${table}`);
  return CACHE_TABLES[table as CacheTable];
}

/** Cached JSON object for `key`, or null on a miss. */
export async function cacheGet(table: CacheTable, key: string): Promise<Record<string, unknown> | null> {
  const col = cacheColumns(table);
  const rows = await sql`
    SELECT ${sql(col.value)} AS payload FROM ${sql(table)} WHERE ${sql(col.key)} = ${key}`;
  const payload = rows[0]?.payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

/** Like `cacheGet`, plus when the row was stored. Only for tables that have a `fetched_at` column. */
export async function cacheGetAged(
  table: "poi_cache" | "weather_cache",
  key: string,
): Promise<{ payload: Record<string, unknown>; fetchedAt: Date } | null> {
  if (table !== "poi_cache" && table !== "weather_cache") throw new Error(`Unknown cache table: ${table}`);
  const rows = await sql`
    SELECT payload, fetched_at FROM ${sql(table)} WHERE key = ${key}`;
  const row = rows[0];
  if (!row || !row.payload || typeof row.payload !== "object") return null;
  return { payload: row.payload as Record<string, unknown>, fetchedAt: new Date(row.fetched_at) };
}

/** NASA POWER climatology stored for `key` (coordinates rounded by the caller), or null on a miss. */
export async function climatologyGet(key: string): Promise<Climatology | null> {
  const rows = await sql`SELECT psh_by_month, psh_year FROM solar_climatology WHERE key = ${key}`;
  const row = rows[0];
  if (!row) return null;
  const months: unknown = typeof row.psh_by_month === "string" ? JSON.parse(row.psh_by_month) : row.psh_by_month;
  if (!Array.isArray(months)) return null;
  return { pshByMonth: months.map(Number), pshYear: Number(row.psh_year) };
}

export async function climatologySet(key: string, lat: number, lng: number, value: Climatology): Promise<void> {
  const months = JSON.stringify(value.pshByMonth);
  await sql`
    INSERT INTO solar_climatology (key, lat, lng, psh_by_month, psh_year, fetched_at)
    VALUES (${key}, ${lat}, ${lng}, ${months}::text::jsonb, ${value.pshYear}, now())
    ON CONFLICT (key) DO UPDATE
      SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, psh_by_month = EXCLUDED.psh_by_month,
          psh_year = EXCLUDED.psh_year, fetched_at = now()`;
}

export type ChatRole = "user" | "assistant";

/** Creates the chat session row the first time a session id is used. */
export async function ensureChatSession(id: string): Promise<void> {
  await sql`INSERT INTO chat_sessions (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
}

/** The last `limit` messages of a session, oldest first, as role and text ("" when a message has no text). */
export async function chatHistory(sessionId: string, limit: number): Promise<{ role: ChatRole; text: string }[]> {
  const rows = await sql`
    SELECT role, content->>'text' AS text FROM (
      SELECT id, role, content FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY id DESC LIMIT ${limit}
    ) recent
    ORDER BY id`;
  return rows.map((r: Record<string, unknown>) => ({
    role: r.role as ChatRole,
    text: typeof r.text === "string" ? r.text : "",
  }));
}

/** Stores one chat message. The session row must exist (see `ensureChatSession`). */
export async function addChatMessage(
  sessionId: string,
  role: ChatRole,
  content: Record<string, unknown>,
): Promise<void> {
  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, ${role}, ${content})`;
}

/**
 * Insert or replace a cached JSON object. `input` is only stored by `building_estimates`,
 * whose `input` column is required.
 */
export async function cacheSet(
  table: CacheTable,
  key: string,
  payload: Record<string, unknown>,
  input: Record<string, unknown> = {},
): Promise<void> {
  cacheColumns(table);
  if (table === "building_estimates") {
    await sql`
      INSERT INTO building_estimates (feature_id, input, result)
      VALUES (${key}, ${input}, ${payload})
      ON CONFLICT (feature_id) DO UPDATE
        SET input = EXCLUDED.input, result = EXCLUDED.result, created_at = now()`;
    return;
  }
  await sql`
    INSERT INTO ${sql(table)} (key, payload, fetched_at)
    VALUES (${key}, ${payload}, now())
    ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now()`;
}
