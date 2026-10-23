import type { GeocodeHit } from "../../src/server/services/geocode.ts";
import type { Home, PemdaRegionSummary, Role, User } from "../../src/shared/auth.ts";
import type { ApplicationCreateResult, ApplicationFileMeta, ApplicationRecord, UserRecord } from "../../src/server/db.ts";
import { FILES_INVALID, MAX_PENDING_FILES, VERSION_CONFLICT } from "../../src/server/db.ts";
import { MAX_FILES_PER_APPLICATION, isActiveStatus } from "../../src/shared/applications.ts";
import { COOKIE_NAME, createSession } from "../../src/server/services/session.ts";
import type { SiteCheck } from "../../src/server/services/siteCheck.ts";
import type { RegionPlant } from "../../src/server/db.ts";
import type { AppDeps } from "../../src/server/index.ts";
import type { ChatModel } from "../../src/server/services/claude.ts";
import type { Climatology } from "../../src/server/services/nasaPower.ts";
import type { PlaceHit, PlaceQuery } from "../../src/server/services/chatTools/placeSearch.ts";
import type { RecommendationWriter } from "../../src/server/services/recommendations.ts";
import type { PoiHit } from "../../src/server/services/tilequery.ts";
import type { ForecastHour } from "../../src/shared/pvForecast.ts";
import type {
  BuildingType,
  EquivalentFactor,
  FuelType,
  GridMix,
  RegionSummary,
} from "../../src/shared/types.ts";

const REGION_IDS = [
  ["berau", "Berau", "kabupaten"],
  ["balikpapan", "Balikpapan", "kota"],
  ["bontang", "Bontang", "kota"],
  ["kutai-barat", "Kutai Barat", "kabupaten"],
  ["kutai-kartanegara", "Kutai Kartanegara", "kabupaten"],
  ["kutai-timur", "Kutai Timur", "kabupaten"],
  ["mahakam-ulu", "Mahakam Ulu", "kabupaten"],
  ["paser", "Paser", "kabupaten"],
  ["penajam-paser-utara", "Penajam Paser Utara", "kabupaten"],
  ["samarinda", "Samarinda", "kota"],
] as const;

export const FAKE_REGIONS: RegionSummary[] = REGION_IDS.map(([id, name, kind], i) => ({
  id,
  name,
  kind,
  kwhYear: 100_000_000 * (i + 1),
  co2KgYear: 114_000_000 * (i + 1),
  population: 100_000,
  customers: 30_000,
  electrificationPct: 99,
  villagesNoPln: null,
  estimated: true,
}));

const TYPES = Object.fromEntries(
  (
    [
      "rumah", "ruko", "kantor", "pemerintahan", "sekolah", "kampus",
      "rumah_sakit", "hotel", "mal", "ibadah", "gudang", "industri",
    ] as BuildingType[]
  ).map((t) => [t, { intensityKwhM2Year: 100, typicalFloors: 2, source: "asumsi" }]),
) as Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number; source: string }>;

const FUELS: FuelType[] = ["batubara", "gas", "diesel", "surya", "air", "biomassa", "lainnya"];
const GRID: GridMix = {
  year: 2023,
  factorKgPerKwh: 1.14,
  shares: Object.fromEntries(FUELS.map((f) => [f, f === "batubara" ? 1 : 0])) as Record<FuelType, number>,
  fuelFactors: Object.fromEntries(FUELS.map((f) => [f, f === "batubara" ? 1.14 : 0])) as Record<FuelType, number>,
  source: "fake",
};

/** Plants inside a region (by id); regions not listed have none. */
export const FAKE_PLANTS: Record<string, RegionPlant[]> = {
  "kutai-kartanegara": [
    { name: "PLTG Senipah", fuel: "gas", capacityMw: 117, status: "operating", approx: false, source: "fake" },
    { name: "PLTU Embalut", fuel: "batubara", capacityMw: 60, status: "operating", approx: true, source: "fake" },
  ],
};

const EQUIVALENTS: EquivalentFactor[] = [
  { key: "mobil_km", label: "Mobil", kgCo2PerUnit: 0.2, unit: "km" },
  { key: "motor_km", label: "Motor", kgCo2PerUnit: 0.1, unit: "km" },
  { key: "pohon", label: "Pohon", kgCo2PerUnit: 21, unit: "pohon" },
  { key: "charge_hp", label: "Isi daya HP", kgCo2PerUnit: 0.01, unit: "kali" },
  { key: "penerbangan", label: "Penerbangan", kgCo2PerUnit: 90, unit: "penerbangan" },
];

export interface FakeChatMessage {
  sessionId: string;
  role: "user" | "assistant";
  content: Record<string, unknown>;
}

export interface FakeDeps {
  deps: AppDeps;
  /** Cache rows written so far, keyed "table:key", to assert what was (not) stored. */
  stored: Map<string, Record<string, unknown>>;
  /** `fetched_at` of rows in `stored` (rows without an entry count as just fetched). Set it to age a row. */
  ages: Map<string, Date>;
  poiCalls: Array<[number, number]>;
  nasaCalls: Array<[number, number]>;
  meteoCalls: Array<[number, number]>;
  /** Place searches asked for by the chat's find_places tool. */
  placeCalls: PlaceQuery[];
  /** Chat session ids created so far. */
  chatSessions: Set<string>;
  /** Chat messages stored so far, oldest first. Push to it to seed a history. */
  chatMessages: FakeChatMessage[];
  /** Users by id, with their password hash. */
  users: Map<number, UserRecord>;
  /** Homes by user id, and the `demo` flag each was saved with. */
  homes: Map<number, { home: Home; demo: boolean }>;
  /** Solar installation reports by id, as the database holds them. */
  applications: Map<string, ApplicationRecord>;
  /** Uploaded photos by id, with their bytes. */
  files: Map<string, ApplicationFileMeta & { bytes: Uint8Array }>;
  /** Adds a user directly (no hashing unless `passwordHash` is given). */
  addUser(u: { email: string; name: string; role: Role; demo?: boolean; passwordHash?: string }): UserRecord;
  /** Adds a user and a live session; `cookie` is the Cookie header value that signs a request in as them. */
  signIn(role: Role, who?: { email?: string; name?: string; demo?: boolean }): Promise<{ user: User; cookie: string }>;
}

export interface FakeUpstreams {
  /** NASA POWER answer: a climatology or an Error to throw. Default: 4.8 peak sun hours all year. */
  nasa?: Climatology | Error;
  /** Open-Meteo answer: hours or an Error to throw. Default: a forecast that fails the test if used. */
  meteo?: ForecastHour[] | Error;
  /** The Claude model behind the chat. Default: one that fails the request if used. */
  chat?: ChatModel;
  /** Claude recommendations writer. Default: none, as with an empty ANTHROPIC_API_KEY. */
  recommender?: RecommendationWriter | null;
  /** Mapbox place search answer: hits or an Error to throw. Default: one that fails the test if used. */
  places?: PlaceHit[] | Error;
  /** Site check by point: a function of [lng, lat], or an Error to throw. Default: every spot is clear. */
  site?: ((lng: number, lat: number) => SiteCheck) | Error;
  /** Address search hits (filtered by the query), or an Error to throw. Default: none. */
  geocode?: GeocodeHit[] | Error;
}

/**
 * In-memory AppDeps. Points with lng 116.5 to 118 and lat -2 to 1 count as Samarinda; anything else is
 * outside Kaltim. `poi` answers with `poiAnswer` (a hit, null, or an Error to throw).
 */
export function fakeDeps(poiAnswer: PoiHit | null | Error = null, upstreams: FakeUpstreams = {}): FakeDeps {
  const stored = new Map<string, Record<string, unknown>>();
  const ages = new Map<string, Date>();
  const poiCalls: Array<[number, number]> = [];
  const nasaCalls: Array<[number, number]> = [];
  const meteoCalls: Array<[number, number]> = [];
  const placeCalls: PlaceQuery[] = [];
  const chatSessions = new Set<string>();
  const chatMessages: FakeChatMessage[] = [];
  const users = new Map<number, UserRecord>();
  const homes = new Map<number, { home: Home; demo: boolean }>();
  const sessions = new Map<string, { userId: number; expiresAt: Date }>();
  const applications = new Map<string, ApplicationRecord>();
  const files = new Map<string, ApplicationFileMeta & { bytes: Uint8Array }>();
  const requests = new Map<string, { hash: string; applicationId: string }>();
  let nextSeq = 1;
  let nextEvent = 1;
  // The report fakes below never await, so each runs to the end before another request starts: the same
  // all-or-nothing behaviour the database gets from its transaction and row locks.
  const clone = <T>(v: T): T => structuredClone(v);
  const metaOf = ({ bytes: _bytes, ...meta }: ApplicationFileMeta & { bytes: Uint8Array }): ApplicationFileMeta => ({ ...meta });
  const loadApp = (id: string): ApplicationRecord | null => {
    const app = applications.get(id);
    if (!app) return null;
    return clone({ ...app, files: [...files.values()].filter((f) => f.applicationId === id).map(metaOf) });
  };
  const canAttach = (userId: number, applicationId: string, ids: string[]): boolean => {
    const ok = ids.every((id) => {
      const f = files.get(id);
      return f !== undefined && f.userId === userId && f.applicationId === null;
    });
    const already = [...files.values()].filter((f) => f.applicationId === applicationId).length;
    return ok && new Set(ids).size === ids.length && already + ids.length <= MAX_FILES_PER_APPLICATION;
  };
  const attach = (applicationId: string, ids: string[]) => {
    for (const id of ids) files.get(id)!.applicationId = applicationId;
  };
  const eventOf = (e: Parameters<AppDeps["db"]["applicationCreate"]>[0]["event"], status: ApplicationRecord["status"]) => ({
    id: String(nextEvent++),
    at: new Date().toISOString(),
    action: e.action,
    status,
    title: e.title,
    publicNote: e.publicNote,
    internalNote: e.internalNote,
    actorRole: e.actorRole,
    actorName: users.get(e.actorUserId)?.name ?? null,
  });
  let lastWrite = 0;
  const nasaAnswer = upstreams.nasa ?? { pshByMonth: Array<number>(12).fill(4.8), pshYear: 4.8 };
  const meteoAnswer = upstreams.meteo ?? new Error("meteo not expected");
  const placesAnswer = upstreams.places ?? new Error("place search not expected");
  let nextUserId = 1;
  const addUser: FakeDeps["addUser"] = (u) => {
    const record: UserRecord = { id: nextUserId++, name: u.name, email: u.email, role: u.role, demo: u.demo ?? false, passwordHash: u.passwordHash ?? "x" };
    users.set(record.id, record);
    return record;
  };
  const deps: AppDeps = {
    db: {
      regionAt: async (lng, lat) =>
        lng >= 116.5 && lng <= 118 && lat >= -2 && lat <= 1 ? { id: "samarinda", name: "Samarinda" } : null,
      regionById: async (id) => {
        const r = FAKE_REGIONS.find((x) => x.id === id);
        return r ? { ...r, centroid: [117.15, -0.5] } : null;
      },
      listRegions: async () => FAKE_REGIONS,
      regionGeoJSON: async () => ({
        type: "FeatureCollection",
        features: FAKE_REGIONS.map((r) => ({
          type: "Feature" as const,
          properties: { ...r },
          geometry: { type: "MultiPolygon", coordinates: [] },
        })),
      }),
      getGridMix: async () => GRID,
      listPlants: async () => ({ type: "FeatureCollection", features: [] }),
      getBuildingTypes: async () => TYPES,
      getEquivalentFactors: async () => EQUIVALENTS,
      cacheGet: async (table, key) => stored.get(`${table}:${key}`) ?? null,
      cacheSet: async (table, key, payload) => {
        stored.set(`${table}:${key}`, JSON.parse(JSON.stringify(payload)));
        ages.set(`${table}:${key}`, new Date());
      },
      cacheGetAged: async (table, key) => {
        const payload = stored.get(`${table}:${key}`);
        return payload ? { payload, fetchedAt: ages.get(`${table}:${key}`) ?? new Date() } : null;
      },
      climatologyGet: async (key) => {
        const row = stored.get(`solar_climatology:${key}`);
        return row ? (row as unknown as Climatology) : null;
      },
      climatologySet: async (key, _lat, _lng, value) => {
        stored.set(`solar_climatology:${key}`, JSON.parse(JSON.stringify(value)));
      },
      ensureChatSession: async (id) => {
        chatSessions.add(id);
      },
      chatHistory: async (sessionId, limit) =>
        chatMessages
          .filter((m) => m.sessionId === sessionId)
          .slice(-limit)
          .map((m) => ({
            role: m.role,
            text: typeof m.content.text === "string" ? m.content.text : "",
            actions: Array.isArray(m.content.actions) ? (m.content.actions as { name: string; input: Record<string, unknown> }[]) : [],
          })),
      addChatMessage: async (sessionId, role, content) => {
        if (!chatSessions.has(sessionId)) throw new Error("chat session does not exist");
        chatMessages.push({ sessionId, role, content: JSON.parse(JSON.stringify(content)) });
      },
      plantsInRegion: async (id) => FAKE_PLANTS[id] ?? [],
      potentialCells: async () => ({
        type: "FeatureCollection",
        source: "NASA POWER",
        terrainSource: null,
        features: [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [[[116.5, -1], [117.5, -1], [117.5, 0], [116.5, 0], [116.5, -1]]] },
            properties: { id: 1, lng: 117, lat: -0.5, at: [117.1, -0.5], ghi: 4.9, ws50: 2.1, ws10: 1.4, regionId: "samarinda", regionName: "Samarinda", plantName: "PLTU Teluk Balikpapan", plantKm: 12.5, landHa: 1e6, terrain: null },
          },
        ],
      }),
      regionLabelPoint: async (id) => (FAKE_REGIONS.some((r) => r.id === id) ? [117.15, -0.5] : null),
      recommendationsGet: async (id) => {
        const row = stored.get(`recommendations:${id}`);
        if (!row) return null;
        return { items: row.items, model: String(row.model), generatedAt: ages.get(`recommendations:${id}`) ?? new Date() };
      },
      recommendationsSet: async (id, items, model) => {
        // Each write is stamped later than the one before, as rows written seconds apart are in the database.
        lastWrite = Math.max(Date.now(), lastWrite + 1);
        const at = new Date(lastWrite);
        stored.set(`recommendations:${id}`, JSON.parse(JSON.stringify({ items, model })));
        ages.set(`recommendations:${id}`, at);
        return at;
      },
      createUser: async (input) => {
        if ([...users.values()].some((u) => u.email === input.email)) return null;
        const u = addUser(input);
        return { id: u.id, name: u.name, email: u.email, role: u.role };
      },
      userByEmail: async (email) => [...users.values()].find((u) => u.email === email) ?? null,
      sessionCreate: async (tokenHash, userId, expiresAt) => {
        sessions.set(tokenHash, { userId, expiresAt });
      },
      sessionUser: async (tokenHash) => {
        const s = sessions.get(tokenHash);
        const u = s && s.expiresAt.getTime() > Date.now() ? users.get(s.userId) : undefined;
        return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
      },
      sessionDelete: async (tokenHash) => {
        sessions.delete(tokenHash);
      },
      homeGet: async (userId) => homes.get(userId)?.home ?? null,
      homeUpsert: async (userId, h, demo = false) => {
        const before = homes.get(userId)?.home;
        const same = before?.featureId === h.featureId;
        const home: Home = {
          ...h,
          verifiedKwp: same ? before?.verifiedKwp ?? null : null,
          verifiedAt: same ? before?.verifiedAt ?? null : null,
          regionName: FAKE_REGIONS.find((r) => r.id === h.regionId)?.name ?? null,
          roofAreaM2: h.footprintM2,
          // Two fake writes can share one millisecond; keep the home revision distinct like separate DB writes.
          updatedAt: new Date(Math.max(Date.now(), before ? Date.parse(before.updatedAt) + 1 : 0)).toISOString(),
        };
        homes.set(userId, { home, demo });
        return structuredClone(home);
      },
      homeDelete: async (userId) => {
        homes.delete(userId);
      },
      pemdaSummary: async () => {
        const byRegion = new Map<string, PemdaRegionSummary>();
        for (const { home } of homes.values()) {
          if (!home.regionId) continue;
          const row = byRegion.get(home.regionId) ?? {
            regionId: home.regionId,
            regionName: home.regionName ?? home.regionId,
            homes: 0,
            interested: 0,
            installed: 0,
            installedKwp: 0,
            verified: 0,
            verifiedKwp: 0,
            potentialKwp: 0,
            kwhYear: 0,
          };
          row.homes += 1;
          row.interested += home.interestedPv ? 1 : 0;
          row.installed += home.installedPv ? 1 : 0;
          row.installedKwp += home.installedPv ? home.installedKwp ?? 0 : 0;
          row.verified = (row.verified ?? 0) + (home.verifiedKwp ? 1 : 0);
          row.verifiedKwp = (row.verifiedKwp ?? 0) + (home.verifiedKwp ?? 0);
          row.potentialKwp += home.potentialKwp;
          row.kwhYear += home.kwhYear;
          byRegion.set(home.regionId, row);
        }
        return {
          regions: [...byRegion.values()].sort((a, b) => a.regionName.localeCompare(b.regionName)),
          demoHomes: [...homes.values()].filter((h) => h.demo).length,
        };
      },
      applicationCreate: async (p): Promise<ApplicationCreateResult> => {
        const prior = requests.get(`${p.userId}:${p.idempotencyKey}`);
        if (prior) {
          if (prior.hash !== p.requestHash) return { kind: "idempotency_mismatch" };
          return { kind: "replayed", app: loadApp(prior.applicationId)! };
        }
        const home = homes.get(p.userId)?.home;
        if (!home) return { kind: "home_missing" };
        if (home.updatedAt !== p.homeUpdatedAt) return { kind: "home_changed" };
        if ([...applications.values()].some((a) => a.userId === p.userId && isActiveStatus(a.status))) return { kind: "active_exists" };
        const id = crypto.randomUUID();
        if (!canAttach(p.userId, id, p.fileIds)) return { kind: "files_invalid" };
        const seq = nextSeq++;
        const now = new Date().toISOString();
        applications.set(id, clone({
          id,
          seq,
          reference: `PLTS-${new Date(Date.now() + 8 * 3600_000).getUTCFullYear()}-${String(seq).padStart(6, "0")}`,
          userId: p.userId,
          status: "submitted" as const,
          version: 1,
          demo: users.get(p.userId)?.demo ?? false,
          createdAt: now,
          updatedAt: now,
          ...p.draft,
          survey: null,
          verification: null,
          files: [],
          events: [eventOf(p.event, "submitted")],
        }));
        attach(id, p.fileIds);
        requests.set(`${p.userId}:${p.idempotencyKey}`, { hash: p.requestHash, applicationId: id });
        return { kind: "created", app: loadApp(id)! };
      },
      applicationGet: async (id) => loadApp(id),
      applicationUpdate: async (id, expectedVersion, decide) => {
        const app = loadApp(id);
        if (!app) return null;
        if (app.version !== expectedVersion) return { fail: VERSION_CONFLICT };
        const d = decide(clone(app));
        if ("fail" in d) return d;
        if (d.attachFileIds && !canAttach(app.userId, id, d.attachFileIds)) return { fail: FILES_INVALID };
        const next: ApplicationRecord = { ...app, ...clone(d.set), version: app.version + 1, updatedAt: new Date().toISOString() };
        next.events = [...app.events, eventOf(d.event, next.status)];
        applications.set(id, next);
        if (d.attachFileIds) attach(id, d.attachFileIds);
        const home = homes.get(app.userId);
        if (d.verifyHome && home && home.home.featureId === d.verifyHome.featureId) {
          home.home = { ...home.home, verifiedKwp: d.verifyHome.kWp, verifiedAt: new Date().toISOString() };
        }
        return { app: loadApp(id)! };
      },
      applicationList: async (f) =>
        [...applications.values()]
          .filter((a) => f.userId === undefined || a.userId === f.userId)
          .filter((a) => !f.statuses?.length || f.statuses.includes(a.status))
          .filter((a) => f.regionId === undefined || a.regionId === f.regionId)
          .filter((a) => !f.q || a.reference.toLowerCase().includes(f.q.toLowerCase()) || a.contact.name.toLowerCase().includes(f.q.toLowerCase()))
          .filter((a) => f.beforeSeq === undefined || a.seq < f.beforeSeq)
          .sort((a, b) => b.seq - a.seq)
          .slice(0, f.limit)
          .map((a) => clone({ ...a, files: [], events: [] })),
      applicationActiveFor: async (userId) => [...applications.values()].some((a) => a.userId === userId && isActiveStatus(a.status)),
      applicationFileCreate: async (f) => {
        const pending = [...files.values()].filter((x) => x.userId === f.userId && x.applicationId === null).length;
        if (pending >= MAX_PENDING_FILES) return null;
        const meta: ApplicationFileMeta = {
          id: crypto.randomUUID(),
          userId: f.userId,
          applicationId: null,
          kind: f.kind,
          contentType: f.contentType,
          sizeBytes: f.bytes.byteLength,
          createdAt: new Date().toISOString(),
        };
        files.set(meta.id, { ...meta, bytes: f.bytes });
        return { ...meta };
      },
      applicationFilesMeta: async (ids) => ids.flatMap((id) => (files.has(id) ? [metaOf(files.get(id)!)] : [])),
      applicationFileGet: async (id) => (files.has(id) ? { ...files.get(id)! } : null),
      pemdaHomes: async () => ({
        type: "FeatureCollection",
        features: [...homes.values()]
          .filter(({ home }) => home.consentMap)
          .map(({ home, demo }) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [home.lng, home.lat] as [number, number] },
            properties: {
              buildingType: home.buildingType,
              potentialKwp: home.potentialKwp,
              interested: home.interestedPv,
              installed: home.installedPv ?? false,
              installedKwp: home.installedKwp ?? null,
              footprintM2: home.footprintM2,
              heightM: home.heightM,
              regionId: home.regionId,
              demo,
            },
          })),
      }),
    },
    poi: async (lng, lat) => {
      poiCalls.push([lng, lat]);
      if (poiAnswer instanceof Error) throw poiAnswer;
      return poiAnswer;
    },
    nasa: async (lat, lng) => {
      nasaCalls.push([lat, lng]);
      if (nasaAnswer instanceof Error) throw nasaAnswer;
      return nasaAnswer;
    },
    meteo: async (lat, lng) => {
      meteoCalls.push([lat, lng]);
      if (meteoAnswer instanceof Error) throw meteoAnswer;
      return meteoAnswer;
    },
    places: async (query) => {
      placeCalls.push(structuredClone(query));
      if (placesAnswer instanceof Error) throw placesAnswer;
      return placesAnswer;
    },
    geocode: async (query) => (upstreams.geocode instanceof Error ? Promise.reject(upstreams.geocode) : (upstreams.geocode ?? []).filter((h) => h.name.toLowerCase().includes(query.toLowerCase()))),
    site: async (lng, lat) => {
      const answer = upstreams.site;
      if (answer instanceof Error) throw answer;
      return answer ? answer(lng, lat) : { buildings: 0, settlement: false, water: false, protectedLand: false };
    },
    chatModel:
      upstreams.chat ??
      (() => {
        throw new Error("chat model not expected");
      }),
    recommender: upstreams.recommender ?? null,
  };
  const signIn: FakeDeps["signIn"] = async (role, who = {}) => {
    const n = nextUserId;
    const record = addUser({ email: who.email ?? `${role}${n}@example.test`, name: who.name ?? `Pengguna ${n}`, role, demo: who.demo });
    const { token } = await createSession(deps.db, record.id);
    return { user: { id: record.id, name: record.name, email: record.email, role }, cookie: `${COOKIE_NAME}=${token}` };
  };
  return { deps, stored, ages, poiCalls, nasaCalls, meteoCalls, placeCalls, chatSessions, chatMessages, users, homes, applications, files, addUser, signIn };
}
