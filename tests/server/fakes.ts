import type { RegionPlant } from "../../src/server/db.ts";
import type { AppDeps } from "../../src/server/index.ts";
import type { ChatModel } from "../../src/server/services/claude.ts";
import type { Climatology } from "../../src/server/services/nasaPower.ts";
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
  /** Chat session ids created so far. */
  chatSessions: Set<string>;
  /** Chat messages stored so far, oldest first. Push to it to seed a history. */
  chatMessages: FakeChatMessage[];
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
  const chatSessions = new Set<string>();
  const chatMessages: FakeChatMessage[] = [];
  const nasaAnswer = upstreams.nasa ?? { pshByMonth: Array<number>(12).fill(4.8), pshYear: 4.8 };
  const meteoAnswer = upstreams.meteo ?? new Error("meteo not expected");
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
      regionLabelPoint: async (id) => (FAKE_REGIONS.some((r) => r.id === id) ? [117.15, -0.5] : null),
      recommendationsGet: async (id) => {
        const row = stored.get(`recommendations:${id}`);
        if (!row) return null;
        return { items: row.items, model: String(row.model), generatedAt: ages.get(`recommendations:${id}`) ?? new Date() };
      },
      recommendationsSet: async (id, items, model) => {
        const at = new Date();
        stored.set(`recommendations:${id}`, JSON.parse(JSON.stringify({ items, model })));
        ages.set(`recommendations:${id}`, at);
        return at;
      },
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
    chatModel:
      upstreams.chat ??
      (() => {
        throw new Error("chat model not expected");
      }),
    recommender: upstreams.recommender ?? null,
  };
  return { deps, stored, ages, poiCalls, nasaCalls, meteoCalls, chatSessions, chatMessages };
}
