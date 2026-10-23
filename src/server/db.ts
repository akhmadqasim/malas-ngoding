import { SQL } from "bun";
import type {
  BuildingType,
  EquivalentFactor,
  FuelType,
  GridMix,
  RecommendationItem,
  RegionSummary,
} from "../shared/types.ts";
import type { Home, PemdaHomes, PemdaRegionSummary, Role, User } from "../shared/auth.ts";
import {
  APPLICATION_TIME_ZONE,
  MAX_FILES_PER_APPLICATION,
  type ApplicationContact,
  type ApplicationErrorCode,
  type ApplicationEvent,
  type ApplicationStatus,
  type EstimateSnapshot,
  type FileKind,
  type HomeSnapshot,
  type InstallationReport,
  type SolarApplication,
} from "../shared/applications.ts";
import { env } from "./env.ts";
import type { Climatology } from "./services/nasaPower.ts";

// One pool per process: `bun --hot` re-runs this module on every edit, and a new pool each time kept the
// old pools' connections open until Postgres ran out ("too many clients").
const pools = globalThis as typeof globalThis & { __malasSql?: SQL };
export const sql = (pools.__malasSql ??= new SQL(env.databaseUrl));

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
    ORDER BY ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)) DESC, id
    LIMIT 1`;
  const row = rows[0];
  return row ? { id: row.id, name: row.name } : null;
}

const GRID_EMPTY = "grid_mix is empty; run `bun run seed`";

/** Latest grid factor (kg CO2 per kWh). Throws on an unseeded database, like `getGridMix`. */
async function latestGridFactor(): Promise<number> {
  const rows = await sql`SELECT grid_factor FROM grid_mix ORDER BY year DESC LIMIT 1`;
  if (!rows[0]) throw new Error(GRID_EMPTY);
  return Number(rows[0].grid_factor);
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
 * Joins the label point `lp.center` of region `r`: the centre of the largest circle that fits inside the
 * region's largest part. Unlike the centroid it always lies inside the region (Mahakam Ulu's centroid
 * does not), and it sits where the region is widest.
 */
const labelPointJoin = () => sql`
  CROSS JOIN LATERAL (
    SELECT (ST_MaximumInscribedCircle(d.geom)).center
    FROM ST_Dump(r.geom) d ORDER BY ST_Area(d.geom) DESC LIMIT 1
  ) lp`;

/** `[lng, lat]` of a row's `label_lng`/`label_lat`, rounded to 5 decimals (about 1 m). */
const labelPointOf = (r: Record<string, unknown>): [number, number] => [
  Math.round(Number(r.label_lng) * 1e5) / 1e5,
  Math.round(Number(r.label_lat) * 1e5) / 1e5,
];

/** Display geometry and a label point (see `labelPointJoin`) for every region. */
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
    ${labelPointJoin()}
    ORDER BY name`;
  return {
    type: "FeatureCollection",
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      properties: { ...toSummary(r, factor), labelPoint: labelPointOf(r) },
      geometry: JSON.parse(String(r.geometry)),
    })),
  };
}

/** The label point `[lng, lat]` of one region, the same one `regionGeoJSON` shows, or null for an unknown id. */
export async function regionLabelPoint(regionId: string): Promise<[number, number] | null> {
  const rows = await sql`
    SELECT ST_X(lp.center) AS label_lng, ST_Y(lp.center) AS label_lat
    FROM regions r
    ${labelPointJoin()}
    WHERE r.id = ${regionId}`;
  const row = rows[0];
  return row ? labelPointOf(row) : null;
}

export async function getGridMix(): Promise<GridMix> {
  const rows = await sql`
    SELECT year, fuel, share, fuel_factor, grid_factor, source FROM grid_mix
    WHERE year = (SELECT max(year) FROM grid_mix)`;
  const first = rows[0];
  if (!first) throw new Error(GRID_EMPTY);
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

export interface RegionPlant {
  name: string;
  fuel: FuelType;
  capacityMw: number;
  status: string;
  /** True when the plant's coordinates are a guess. */
  approx: boolean;
  source: string;
}

/** Power plants whose point lies inside the region's polygon, largest first. Empty for an unknown id. */
export async function plantsInRegion(regionId: string): Promise<RegionPlant[]> {
  const rows = await sql`
    SELECT p.name, p.fuel, p.capacity_mw, p.status, p.approx, p.source
    FROM power_plants p
    JOIN regions r ON ST_Contains(r.geom, p.geom)
    WHERE r.id = ${regionId}
    ORDER BY p.capacity_mw DESC, p.name`;
  return rows.map((r: Record<string, unknown>) => ({
    name: String(r.name),
    fuel: r.fuel as FuelType,
    capacityMw: Number(r.capacity_mw),
    status: String(r.status),
    approx: Boolean(r.approx),
    source: String(r.source),
  }));
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

/**
 * The NASA POWER grid over Kalimantan Timur as map cells: each grid point's cell (half the grid spacing
 * either side), clipped to the province's land, with the region it falls in (or the nearest one for a
 * coastal cell whose centre is at sea) and the nearest power plant with its distance in km. Cells that do
 * not touch the province are left out.
 */
export async function potentialCells(): Promise<FeatureCollection & { source: string; terrainSource: string | null }> {
  const rows = await sql`
    WITH spacing AS (
      SELECT
        (SELECT min(d) FROM (SELECT lng - lag(lng) OVER (ORDER BY lng) AS d FROM (SELECT DISTINCT lng FROM re_potential) a) b WHERE d > 0) AS dx,
        (SELECT min(d) FROM (SELECT lat - lag(lat) OVER (ORDER BY lat) AS d FROM (SELECT DISTINCT lat FROM re_potential) a) b WHERE d > 0) AS dy
    ),
    land AS (SELECT ST_Union(geom) AS geom FROM regions),
    cells AS (
      SELECT p.*, ST_Intersection(
               ST_MakeEnvelope(p.lng - s.dx / 2, p.lat - s.dy / 2, p.lng + s.dx / 2, p.lat + s.dy / 2, 4326), l.geom) AS cell
      FROM re_potential p, spacing s, land l
      WHERE ST_Intersects(ST_MakeEnvelope(p.lng - s.dx / 2, p.lat - s.dy / 2, p.lng + s.dx / 2, p.lat + s.dy / 2, 4326), l.geom)
    )
    SELECT c.id, c.lng, c.lat, c.ghi, c.ws50, c.ws10, c.source,
           c.elev_mean, c.elev_max, c.slope_mean, c.flat5_pct, c.flat10_pct, c.terrain_source,
           ST_Area(c.cell::geography) / 10000 AS land_ha,
           ST_AsGeoJSON(c.cell, 5) AS cell, ST_X(c.at) AS at_lng, ST_Y(c.at) AS at_lat,
           r.id AS region_id, r.name AS region_name,
           pl.name AS plant_name, pl.km AS plant_km
    FROM (SELECT *, ST_PointOnSurface(cell) AS at FROM cells WHERE NOT ST_IsEmpty(cell)) c
    -- The region that holds most of the cell's land.
    CROSS JOIN LATERAL (
      SELECT id, name FROM regions WHERE ST_Intersects(geom, c.cell)
      ORDER BY ST_Area(ST_Intersection(geom, c.cell)) DESC LIMIT 1
    ) r
    -- Distances from a point on the cell's land, never from a grid centre out at sea or over the border.
    LEFT JOIN LATERAL (
      SELECT name, ST_Distance(geom::geography, c.at::geography) / 1000 AS km
      FROM power_plants ORDER BY geom <-> c.at LIMIT 1
    ) pl ON true
    ORDER BY c.lat, c.lng`;
  return {
    type: "FeatureCollection",
    // Every cell shares one source sentence; it is sent once.
    source: rows[0] ? String(rows[0].source) : "",
    terrainSource: (() => {
      const t = rows.find((r: Record<string, unknown>) => r.terrain_source)?.terrain_source;
      return t ? String(t) : null;
    })(),
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      geometry: JSON.parse(String(r.cell)),
      properties: {
        id: Number(r.id),
        lng: Number(r.lng),
        lat: Number(r.lat),
        at: [Number(r.at_lng), Number(r.at_lat)],
        ghi: Number(r.ghi),
        ws50: Number(r.ws50),
        ws10: Number(r.ws10),
        regionId: String(r.region_id),
        regionName: String(r.region_name),
        plantName: r.plant_name === null ? null : String(r.plant_name),
        plantKm: r.plant_km === null ? null : Number(r.plant_km),
        landHa: Number(r.land_ha),
        terrain:
          r.slope_mean === null
            ? null
            : {
                elevMean: Number(r.elev_mean),
                elevMax: Number(r.elev_max),
                slopeMean: Number(r.slope_mean),
                flat5Pct: Number(r.flat5_pct),
                flat10Pct: Number(r.flat10_pct),
              },
      },
    })),
  };
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
  // Bind the JSON as text and cast it: a string bound straight to a jsonb parameter is stored as a JSON
  // string ("[1,2]"), not as the array.
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

/** A stored chat message as the history needs it. `actions` are the map actions of an answer ([] if none). */
export interface ChatHistoryRow {
  role: ChatRole;
  text: string;
  actions: { name: string; input: Record<string, unknown> }[];
}

/** The last `limit` messages of a session, oldest first ("" when a message has no text). */
export async function chatHistory(sessionId: string, limit: number): Promise<ChatHistoryRow[]> {
  const rows = await sql`
    SELECT role, content->>'text' AS text, content->'actions' AS actions FROM (
      SELECT id, role, content FROM chat_messages
      WHERE session_id = ${sessionId}
      ORDER BY id DESC LIMIT ${limit}
    ) recent
    ORDER BY id`;
  return rows.map((r: Record<string, unknown>) => {
    const actions: unknown = typeof r.actions === "string" ? JSON.parse(r.actions) : r.actions;
    return {
      role: r.role as ChatRole,
      text: typeof r.text === "string" ? r.text : "",
      actions: Array.isArray(actions) ? (actions as ChatHistoryRow["actions"]) : [],
    };
  });
}

/** Stores one chat message. The session row must exist (see `ensureChatSession`). */
export async function addChatMessage(
  sessionId: string,
  role: ChatRole,
  content: Record<string, unknown>,
): Promise<void> {
  await sql`INSERT INTO chat_messages (session_id, role, content) VALUES (${sessionId}, ${role}, ${content})`;
}

/** The recommendations stored for a region, or null on a miss. `items` is as stored; the caller validates it. */
export async function recommendationsGet(
  regionId: string,
): Promise<{ items: unknown; model: string; generatedAt: Date } | null> {
  const rows = await sql`
    SELECT content, model, generated_at FROM recommendations WHERE region_id = ${regionId}`;
  const row = rows[0];
  if (!row) return null;
  const content: unknown = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
  const items = content && typeof content === "object" ? (content as { items?: unknown }).items : undefined;
  return { items, model: String(row.model), generatedAt: new Date(row.generated_at) };
}

/** Stores a region's recommendations, replacing any earlier copy. Returns the time they were stored. */
export async function recommendationsSet(
  regionId: string,
  items: RecommendationItem[],
  model: string,
): Promise<Date> {
  const content = { items };
  const rows = await sql`
    INSERT INTO recommendations (region_id, content, model, generated_at)
    VALUES (${regionId}, ${content}, ${model}, now())
    ON CONFLICT (region_id) DO UPDATE
      SET content = EXCLUDED.content, model = EXCLUDED.model, generated_at = now()
    RETURNING generated_at`;
  return new Date(rows[0]?.generated_at);
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

// ---------- accounts, sessions and homes (db/migrations/004_auth.sql) ----------

/** A user with the password hash; only the sign-in code reads the hash, and it never leaves the server. */
export interface UserRecord extends User {
  passwordHash: string;
  demo: boolean;
}

const toUser = (r: Record<string, unknown>): User => ({
  id: Number(r.id),
  name: String(r.name),
  email: String(r.email),
  role: r.role as Role,
});

/** Creates a user; null when the email is already taken. The email must already be lower-case. */
export async function createUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  demo?: boolean;
}): Promise<User | null> {
  const rows = await sql`
    INSERT INTO users (email, name, password_hash, role, demo)
    VALUES (${input.email}, ${input.name}, ${input.passwordHash}, ${input.role}, ${input.demo ?? false})
    ON CONFLICT (email) DO NOTHING
    RETURNING id, email, name, role`;
  return rows[0] ? toUser(rows[0]) : null;
}

/** The user with this (lower-case) email, with the password hash, or null. */
export async function userByEmail(email: string): Promise<UserRecord | null> {
  const rows = await sql`SELECT id, email, name, role, password_hash, demo FROM users WHERE email = ${email}`;
  const r = rows[0];
  return r ? { ...toUser(r), passwordHash: String(r.password_hash), demo: Boolean(r.demo) } : null;
}

/** Stores a session by the hash of its token; also drops expired sessions so the table does not grow. */
export async function sessionCreate(tokenHash: string, userId: number, expiresAt: Date): Promise<void> {
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${tokenHash}, ${userId}, ${expiresAt})`;
}

/** The user of a live (not expired) session, or null. */
export async function sessionUser(tokenHash: string): Promise<User | null> {
  const rows = await sql`
    SELECT u.id, u.email, u.name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()`;
  return rows[0] ? toUser(rows[0]) : null;
}

export async function sessionDelete(tokenHash: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

/** What a saved home holds beyond what the resident typed: all of `Home` but the fields the database derives. */
export type HomeSave = Omit<Home, "regionName" | "roofAreaM2" | "updatedAt">;

const toHome = (r: Record<string, unknown>): Home => {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    featureId: String(r.feature_id),
    lng: Number(r.lng),
    lat: Number(r.lat),
    footprintM2: Number(r.footprint_m2),
    heightM: num(r.height_m),
    buildingType: r.building_type as BuildingType,
    floors: Number(r.floors),
    kwhMonth: num(r.kwh_month),
    billRpMonth: num(r.bill_rp_month),
    interestedPv: Boolean(r.interested_pv),
    installedPv: Boolean(r.installed_pv),
    installedKwp: num(r.installed_kwp),
    consentMap: Boolean(r.consent_map),
    regionId: r.region_id === null ? null : String(r.region_id),
    regionName: r.region_name === null || r.region_name === undefined ? null : String(r.region_name),
    kwhYear: Number(r.kwh_year),
    kwhSource: r.kwh_source as Home["kwhSource"],
    roofAreaM2: Number(r.footprint_m2),
    potentialKwp: Number(r.potential_kwp),
    updatedAt: new Date(r.updated_at as string | Date).toISOString(),
    verifiedKwp: num(r.verified_kwp),
    verifiedAt: r.verified_at == null ? null : new Date(r.verified_at as string | Date).toISOString(),
  };
};

/** The user's home, or null when they have not marked one. */
export async function homeGet(userId: number): Promise<Home | null> {
  const rows = await sql`
    SELECT h.*, r.name AS region_name FROM homes h LEFT JOIN regions r ON r.id = h.region_id
    WHERE h.user_id = ${userId}`;
  return rows[0] ? toHome(rows[0]) : null;
}

/** Creates or replaces the user's one home and returns it as saved. */
export async function homeUpsert(userId: number, h: HomeSave, demo = false): Promise<Home> {
  await sql`
    INSERT INTO homes (user_id, feature_id, lng, lat, geom, region_id, building_type, floors, footprint_m2,
                       height_m, kwh_month, bill_rp_month, kwh_year, kwh_source, potential_kwp,
                       interested_pv, installed_pv, installed_kwp, consent_map, demo, updated_at)
    VALUES (${userId}, ${h.featureId}, ${h.lng}, ${h.lat}, ST_SetSRID(ST_MakePoint(${h.lng}, ${h.lat}), 4326),
            ${h.regionId}, ${h.buildingType}, ${h.floors}, ${h.footprintM2}, ${h.heightM}, ${h.kwhMonth},
            ${h.billRpMonth}, ${h.kwhYear}, ${h.kwhSource}, ${h.potentialKwp}, ${h.interestedPv},
            ${h.installedPv ?? false}, ${h.installedKwp ?? null}, ${h.consentMap}, ${demo}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      feature_id = EXCLUDED.feature_id, lng = EXCLUDED.lng, lat = EXCLUDED.lat, geom = EXCLUDED.geom,
      region_id = EXCLUDED.region_id, building_type = EXCLUDED.building_type, floors = EXCLUDED.floors,
      footprint_m2 = EXCLUDED.footprint_m2, height_m = EXCLUDED.height_m, kwh_month = EXCLUDED.kwh_month,
      bill_rp_month = EXCLUDED.bill_rp_month, kwh_year = EXCLUDED.kwh_year, kwh_source = EXCLUDED.kwh_source,
      potential_kwp = EXCLUDED.potential_kwp, interested_pv = EXCLUDED.interested_pv,
      installed_pv = EXCLUDED.installed_pv, installed_kwp = EXCLUDED.installed_kwp,
      consent_map = EXCLUDED.consent_map, demo = EXCLUDED.demo, updated_at = now(),
      -- A verified capacity belongs to the building; moving the home to another building drops it.
      verified_kwp = CASE WHEN homes.feature_id = EXCLUDED.feature_id THEN homes.verified_kwp END,
      verified_at = CASE WHEN homes.feature_id = EXCLUDED.feature_id THEN homes.verified_at END`;
  const saved = await homeGet(userId);
  if (!saved) throw new Error("home was not saved");
  return saved;
}

export async function homeDelete(userId: number): Promise<void> {
  await sql`DELETE FROM homes WHERE user_id = ${userId}`;
}

/** Registered homes per region (every region with at least one home), by region name. */
export async function pemdaSummary(): Promise<{ regions: PemdaRegionSummary[]; demoHomes: number }> {
  const rows = await sql`
    SELECT r.id AS region_id, r.name AS region_name, count(*) AS homes,
           count(*) FILTER (WHERE h.interested_pv) AS interested,
           count(*) FILTER (WHERE h.installed_pv) AS installed,
           coalesce(sum(h.installed_kwp) FILTER (WHERE h.installed_pv), 0) AS installed_kwp,
           count(h.verified_kwp) AS verified, coalesce(sum(h.verified_kwp), 0) AS verified_kwp,
           sum(h.potential_kwp) AS potential_kwp, sum(h.kwh_year) AS kwh_year
    FROM homes h JOIN regions r ON r.id = h.region_id
    GROUP BY r.id, r.name ORDER BY r.name`;
  const [demo] = await sql`SELECT count(*) AS n FROM homes WHERE demo`;
  return {
    regions: rows.map((r: Record<string, unknown>) => ({
      regionId: String(r.region_id),
      regionName: String(r.region_name),
      homes: Number(r.homes),
      interested: Number(r.interested),
      installed: Number(r.installed),
      installedKwp: Number(r.installed_kwp),
      verified: Number(r.verified),
      verifiedKwp: Number(r.verified_kwp),
      potentialKwp: Number(r.potential_kwp),
      kwhYear: Number(r.kwh_year),
    })),
    demoHomes: Number(demo?.n ?? 0),
  };
}

/** The homes whose owners agreed to share them, as anonymous points: no user id, name or email. */
export async function pemdaHomes(): Promise<PemdaHomes> {
  const rows = await sql`
    SELECT lng, lat, building_type, potential_kwp, interested_pv, installed_pv, installed_kwp, footprint_m2, height_m, region_id, demo
    FROM homes WHERE consent_map ORDER BY id`;
  return {
    type: "FeatureCollection",
    features: rows.map((r: Record<string, unknown>) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [Number(r.lng), Number(r.lat)] as [number, number] },
      properties: {
        buildingType: r.building_type as BuildingType,
        potentialKwp: Number(r.potential_kwp),
        interested: Boolean(r.interested_pv),
        installed: Boolean(r.installed_pv),
        installedKwp: r.installed_kwp == null ? null : Number(r.installed_kwp),
        footprintM2: Number(r.footprint_m2),
        heightM: r.height_m == null ? null : Number(r.height_m),
        regionId: r.region_id === null ? null : String(r.region_id),
        demo: Boolean(r.demo),
      },
    })),
  };
}

// ---------- solar installation reports (db/migrations/006_solar_applications.sql) ----------

/** A report as stored, with its photos (metadata only) and the full audit trail. Routes decide what to show. */
export interface ApplicationRecord {
  id: string;
  seq: number;
  reference: string;
  userId: number;
  status: ApplicationStatus;
  version: number;
  regionId: string | null;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
  homeSnapshot: HomeSnapshot;
  estimate: EstimateSnapshot;
  report: InstallationReport;
  contact: ApplicationContact;
  survey: SolarApplication["survey"];
  verification: SolarApplication["verification"];
  files: ApplicationFileMeta[];
  events: ApplicationEventRecord[];
}
export interface ApplicationFileMeta {
  id: string;
  userId: number;
  applicationId: string | null;
  kind: FileKind;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}
export interface ApplicationEventRecord {
  id: string;
  at: string;
  action: ApplicationEvent["action"];
  status: ApplicationStatus;
  title: string;
  publicNote: string | null;
  internalNote: string | null;
  actorRole: Role | null;
  actorName: string | null;
}
export interface NewApplicationEvent {
  action: ApplicationEvent["action"];
  title: string;
  publicNote: string | null;
  internalNote: string | null;
  actorUserId: number;
  actorRole: Role;
  data?: Record<string, unknown> | null;
}
export interface ApplicationDraft {
  regionId: string | null;
  homeSnapshot: HomeSnapshot;
  estimate: EstimateSnapshot;
  report: InstallationReport;
  contact: ApplicationContact;
}
export type ApplicationCreateResult =
  | { kind: "created" | "replayed"; app: ApplicationRecord }
  | { kind: "idempotency_mismatch" | "active_exists" | "home_missing" | "home_changed" | "files_invalid" };
export interface ApplicationFailure {
  status: number;
  code: ApplicationErrorCode;
  message: string;
}
/**
 * What an action does to a locked report: a failure, or the fields to change plus the timeline event. The
 * version goes up by one and everything is written in one transaction.
 */
export type ApplicationDecision =
  | { fail: ApplicationFailure }
  | {
      set: Partial<Pick<ApplicationRecord, "status" | "report" | "contact" | "estimate" | "survey" | "verification">>;
      event: NewApplicationEvent;
      attachFileIds?: string[];
      /** On verify: write the checked capacity to the resident's home, if it is still the same building. */
      verifyHome?: { featureId: string; kWp: number };
    };
export type ApplicationUpdateResult = { app: ApplicationRecord } | { fail: ApplicationFailure };

export const FILES_INVALID: ApplicationFailure = {
  status: 400,
  code: "files_invalid",
  message: "Foto tidak ditemukan, sudah dipakai di laporan lain, atau melebihi batas 10 foto.",
};
export const VERSION_CONFLICT: ApplicationFailure = {
  status: 409,
  code: "version_conflict",
  message: "Laporan sudah berubah. Muat ulang untuk melihat data terbaru.",
};

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

const toFileMeta = (r: Record<string, unknown>): ApplicationFileMeta => ({
  id: String(r.id),
  userId: Number(r.user_id),
  applicationId: r.application_id == null ? null : String(r.application_id),
  kind: r.kind as FileKind,
  contentType: String(r.content_type),
  sizeBytes: Number(r.size_bytes),
  createdAt: iso(r.created_at),
});

const toApplication = (r: Record<string, unknown>, files: ApplicationFileMeta[], events: ApplicationEventRecord[]): ApplicationRecord => ({
  id: String(r.id),
  seq: Number(r.seq),
  reference: String(r.reference),
  userId: Number(r.user_id),
  status: r.status as ApplicationStatus,
  version: Number(r.version),
  regionId: r.region_id == null ? null : String(r.region_id),
  demo: Boolean(r.demo),
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  homeSnapshot: r.home_snapshot as HomeSnapshot,
  estimate: r.estimate as EstimateSnapshot,
  report: r.report as InstallationReport,
  contact: r.contact as ApplicationContact,
  survey: (r.survey ?? null) as ApplicationRecord["survey"],
  verification: (r.verification ?? null) as ApplicationRecord["verification"],
  files,
  events,
});

/** `sql` or a transaction's `tx`: both are tagged templates and take `q(array)` for IN lists. */
type Query = SQL;

async function loadApplication(q: Query, id: string, lock = false): Promise<ApplicationRecord | null> {
  const rows = lock
    ? await q`SELECT * FROM solar_applications WHERE id = ${id} FOR UPDATE`
    : await q`SELECT * FROM solar_applications WHERE id = ${id}`;
  const row = rows[0];
  if (!row) return null;
  const files = await q`
    SELECT id, user_id, application_id, kind, content_type, size_bytes, created_at
    FROM solar_application_files WHERE application_id = ${id} ORDER BY created_at, id`;
  const events = await q`
    SELECT e.*, u.name AS actor_name FROM solar_application_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.application_id = ${id} ORDER BY e.id`;
  return toApplication(
    row,
    files.map(toFileMeta),
    events.map((e: Record<string, unknown>) => ({
      id: String(e.id),
      at: iso(e.at),
      action: e.action as ApplicationEventRecord["action"],
      status: e.status as ApplicationStatus,
      title: String(e.title),
      publicNote: e.public_note == null ? null : String(e.public_note),
      internalNote: e.internal_note == null ? null : String(e.internal_note),
      actorRole: (e.actor_role ?? null) as Role | null,
      actorName: e.actor_name == null ? null : String(e.actor_name),
    })),
  );
}

async function insertEvent(q: Query, applicationId: string, status: ApplicationStatus, e: NewApplicationEvent): Promise<void> {
  await q`
    INSERT INTO solar_application_events (application_id, action, status, title, public_note, internal_note, actor_user_id, actor_role, data)
    VALUES (${applicationId}, ${e.action}, ${status}, ${e.title}, ${e.publicNote}, ${e.internalNote}, ${e.actorUserId}, ${e.actorRole}, ${e.data ?? null})`;
}

/** Attaches the user's unattached photos to a report; false when one is missing, someone else's, already attached, or over the limit. */
async function attachFiles(q: Query, userId: number, applicationId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await q`
    UPDATE solar_application_files SET application_id = ${applicationId}
    WHERE id IN ${q(ids)} AND user_id = ${userId} AND application_id IS NULL
    RETURNING id`;
  if (rows.length !== new Set(ids).size) return false;
  const [n] = await q`SELECT count(*) AS n FROM solar_application_files WHERE application_id = ${applicationId}`;
  return Number(n?.n) <= MAX_FILES_PER_APPLICATION;
}

/** Thrown inside a transaction to roll it back and answer with a result instead. */
class Rollback<T> extends Error {
  constructor(readonly result: T) {
    super("rollback");
  }
}

/**
 * Stores a new report atomically. The user's row is locked first, so concurrent sends by the same user run
 * one after the other: the idempotency key, the one-active-report rule, the home version check and the
 * photo attachment all see each other's writes.
 */
export async function applicationCreate(p: {
  userId: number;
  idempotencyKey: string;
  requestHash: string;
  homeUpdatedAt: string;
  draft: ApplicationDraft;
  fileIds: string[];
  event: NewApplicationEvent;
}): Promise<ApplicationCreateResult> {
  try {
    return await sql.begin(async (tx: Query): Promise<ApplicationCreateResult> => {
      const [user] = await tx`SELECT demo FROM users WHERE id = ${p.userId} FOR UPDATE`;
      const [prior] = await tx`
        SELECT request_hash, application_id FROM solar_application_requests WHERE user_id = ${p.userId} AND key = ${p.idempotencyKey}`;
      if (prior) {
        if (prior.request_hash !== p.requestHash) return { kind: "idempotency_mismatch" };
        const app = await loadApplication(tx, String(prior.application_id));
        if (app) return { kind: "replayed", app };
      }
      const [home] = await tx`SELECT updated_at FROM homes WHERE user_id = ${p.userId} FOR SHARE`;
      if (!home) return { kind: "home_missing" };
      if (iso(home.updated_at) !== p.homeUpdatedAt) return { kind: "home_changed" };
      const [active] = await tx`
        SELECT 1 FROM solar_applications WHERE user_id = ${p.userId} AND status NOT IN ('verified', 'rejected', 'cancelled')`;
      if (active) return { kind: "active_exists" };

      const [next] = await tx`
        SELECT nextval('solar_application_seq') AS seq, to_char(now() AT TIME ZONE ${APPLICATION_TIME_ZONE}, 'YYYY') AS year`;
      const seq = Number(next!.seq);
      const reference = `PLTS-${next!.year}-${String(seq).padStart(6, "0")}`;
      const d = p.draft;
      const [row] = await tx`
        INSERT INTO solar_applications (seq, reference, user_id, status, region_id, demo, home_snapshot, estimate, report, contact)
        VALUES (${seq}, ${reference}, ${p.userId}, 'submitted', ${d.regionId}, ${Boolean(user?.demo)}, ${d.homeSnapshot},
                ${d.estimate}, ${d.report}, ${d.contact})
        RETURNING id`;
      const id = String(row!.id);
      if (!(await attachFiles(tx, p.userId, id, p.fileIds))) throw new Rollback<ApplicationCreateResult>({ kind: "files_invalid" });
      await insertEvent(tx, id, "submitted", p.event);
      await tx`
        INSERT INTO solar_application_requests (user_id, key, request_hash, application_id)
        VALUES (${p.userId}, ${p.idempotencyKey}, ${p.requestHash}, ${id})`;
      return { kind: "created", app: (await loadApplication(tx, id))! };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.result as ApplicationCreateResult;
    throw err;
  }
}

/** One report with its photos and timeline, or null. */
export async function applicationGet(id: string): Promise<ApplicationRecord | null> {
  return loadApplication(sql, id);
}

/**
 * Changes a report in one transaction: locks the row, refuses a stale `expectedVersion` (409), asks
 * `decide` what to change, then writes the fields, the version, the event, new photos and the verified
 * capacity together. Null when the report does not exist.
 */
export async function applicationUpdate(
  id: string,
  expectedVersion: number,
  decide: (app: ApplicationRecord) => ApplicationDecision,
): Promise<ApplicationUpdateResult | null> {
  try {
    return await sql.begin(async (tx: Query): Promise<ApplicationUpdateResult | null> => {
      const app = await loadApplication(tx, id, true);
      if (!app) return null;
      if (app.version !== expectedVersion) return { fail: VERSION_CONFLICT };
      const d = decide(app);
      if ("fail" in d) return d;
      const next = { ...app, ...d.set };
      await tx`
        UPDATE solar_applications SET
          status = ${next.status}, report = ${next.report}, contact = ${next.contact}, estimate = ${next.estimate},
          survey = ${next.survey}, verification = ${next.verification},
          version = version + 1, updated_at = now()
        WHERE id = ${id}`;
      if (d.attachFileIds && !(await attachFiles(tx, app.userId, id, d.attachFileIds))) {
        throw new Rollback<ApplicationUpdateResult>({ fail: FILES_INVALID });
      }
      await insertEvent(tx, id, next.status, d.event);
      if (d.verifyHome) {
        await tx`
          UPDATE homes SET verified_kwp = ${d.verifyHome.kWp}, verified_at = now()
          WHERE user_id = ${app.userId} AND feature_id = ${d.verifyHome.featureId}`;
      }
      return { app: (await loadApplication(tx, id))! };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.result as ApplicationUpdateResult;
    throw err;
  }
}

export interface ApplicationFilter {
  userId?: number;
  statuses?: ApplicationStatus[];
  regionId?: string;
  /** Reference or contact name, case-insensitive substring. */
  q?: string;
  /** Only reports older than this `seq` (the cursor). */
  beforeSeq?: number;
  limit: number;
}

/** Reports newest first, without photos and events. */
export async function applicationList(f: ApplicationFilter): Promise<ApplicationRecord[]> {
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const statuses = f.statuses?.length ? f.statuses : null;
  const rows = await sql`
    SELECT * FROM solar_applications
    WHERE (${f.userId ?? null}::int IS NULL OR user_id = ${f.userId ?? null})
      AND (${statuses === null} OR status IN ${sql(statuses ?? ["-"])})
      AND (${f.regionId ?? null}::text IS NULL OR region_id = ${f.regionId ?? null})
      AND (${like}::text IS NULL OR reference ILIKE ${like} OR contact->>'name' ILIKE ${like})
      AND (${f.beforeSeq ?? null}::bigint IS NULL OR seq < ${f.beforeSeq ?? null})
    ORDER BY seq DESC
    LIMIT ${f.limit}`;
  return rows.map((r: Record<string, unknown>) => toApplication(r, [], []));
}

/** True when the user has a report that is not verified, rejected or cancelled. */
export async function applicationActiveFor(userId: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM solar_applications WHERE user_id = ${userId} AND status NOT IN ('verified', 'rejected', 'cancelled') LIMIT 1`;
  return rows.length > 0;
}

/** Most unattached photos a user may hold; ones older than a day are dropped on each upload. */
export const MAX_PENDING_FILES = 20;

/** Stores an uploaded photo, not yet attached; null when the user already holds too many unattached photos. */
export async function applicationFileCreate(f: {
  userId: number;
  kind: FileKind;
  contentType: string;
  bytes: Uint8Array;
}): Promise<ApplicationFileMeta | null> {
  return sql.begin(async (tx: Query): Promise<ApplicationFileMeta | null> => {
    await tx`SELECT 1 FROM users WHERE id = ${f.userId} FOR UPDATE`;
    await tx`
      DELETE FROM solar_application_files
      WHERE user_id = ${f.userId} AND application_id IS NULL AND created_at < now() - interval '1 day'`;
    const [n] = await tx`SELECT count(*) AS n FROM solar_application_files WHERE user_id = ${f.userId} AND application_id IS NULL`;
    if (Number(n?.n) >= MAX_PENDING_FILES) return null;
    const [row] = await tx`
      INSERT INTO solar_application_files (user_id, kind, content_type, size_bytes, bytes)
      VALUES (${f.userId}, ${f.kind}, ${f.contentType}, ${f.bytes.byteLength}, ${f.bytes})
      RETURNING id, user_id, application_id, kind, content_type, size_bytes, created_at`;
    return toFileMeta(row!);
  });
}

/** Photo metadata for these ids (any owner); the route checks the owner. */
export async function applicationFilesMeta(ids: string[]): Promise<ApplicationFileMeta[]> {
  if (ids.length === 0) return [];
  const rows = await sql`
    SELECT id, user_id, application_id, kind, content_type, size_bytes, created_at
    FROM solar_application_files WHERE id IN ${sql(ids)}`;
  return rows.map(toFileMeta);
}

/** A photo with its bytes, or null. */
export async function applicationFileGet(id: string): Promise<(ApplicationFileMeta & { bytes: Uint8Array }) | null> {
  const rows = await sql`SELECT * FROM solar_application_files WHERE id = ${id}`;
  const r = rows[0];
  return r ? { ...toFileMeta(r), bytes: r.bytes as Uint8Array } : null;
}
