import type Anthropic from "@anthropic-ai/sdk";
import { estimateBuilding } from "../../shared/estimate.ts";
import { fmtCompact, fmtKg, fmtKwh, fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { pvFromForecast, summariseDays } from "../../shared/pvForecast.ts";
import { resolveRegion } from "../../shared/regionAlias.ts";
import type { BuildingInput, BuildingType, FuelType, RegionSummary } from "../../shared/types.ts";
import type { AppDeps } from "../index.ts";
import { parseSolarInput, simulateSolarAt } from "../routes/solar.ts";
import { currentConditions } from "../routes/weather.ts";
import { cachedForecast, cachedPoi, poiCacheKey } from "./cache.ts";

// The tools Claude can call in the chat. Server tools run here and their result goes back to Claude.
// Map actions run in the browser: the server checks the input, sends it to the client as an `action`
// event and tells Claude `{ ok: true }` at once. Tool results are JSON; every number Claude may quote
// is already formatted the Indonesian way and marked "(perkiraan)" when it is an estimate.

/** Footprint estimate_building_at assumes: it only has a point, not the building outline. */
export const DEFAULT_FOOTPRINT_M2 = 150;
/** Solar size get_weather uses when Claude does not pass one. */
const DEFAULT_KWP = 1;
const MAX_KWP = 10_000;

const LAYERS = ["regions", "plants", "buildings"] as const;
const METRICS = ["co2", "kwh"] as const;
const RAIN_MODES = ["auto", "on", "off"] as const;
const TABS = ["energi", "emisi", "surya", "cuaca"] as const;

const REGION_NAMES =
  "Balikpapan, Samarinda, Bontang, Berau, Paser, Kutai Kartanegara (Kukar), Kutai Barat (Kubar), " +
  "Kutai Timur (Kutim), Penajam Paser Utara (PPU), Mahakam Ulu (Mahulu)";
const REGION_PARAM = {
  type: "string",
  description: `A kabupaten/kota of Kalimantan Timur by name, alias or id: ${REGION_NAMES}. "Kota ..." and "Kabupaten ..." are fine.`,
};
const lngParam = (of: string) => ({
  type: "number",
  minimum: -180,
  maximum: 180,
  description: `Longitude of ${of} in degrees (Kalimantan Timur spans about 113.8 to 119.0).`,
});
const latParam = (of: string) => ({
  type: "number",
  minimum: -90,
  maximum: 90,
  description: `Latitude of ${of} in degrees (Kalimantan Timur spans about -2.4 to 2.6).`,
});

const SERVER_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "list_regions",
    description:
      "All 10 kabupaten/kota of Kalimantan Timur with their yearly electricity use and CO2 emissions, ranked from the highest to the lowest CO2 (rank 1 emits the most), plus the Kaltim total. Call it to compare regions or to find the region with the highest or lowest use or emissions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_region_stats",
    description:
      "Figures for one kabupaten/kota: electricity use, CO2, its share of Kaltim's electricity, electricity per person, population, PLN customers, electrification ratio, villages without PLN service, and its CO2 rank among the 10 regions. Call it whenever the user asks about a specific region.",
    input_schema: { type: "object", properties: { region: REGION_PARAM }, required: ["region"] },
  },
  {
    name: "get_grid_mix",
    description:
      "The Kaltim electricity grid: its emission factor (kg CO2 per kWh) and the share of each power source (coal, gas, diesel, solar and others). Call it to explain where the electricity comes from and why using it emits CO2.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "estimate_building_at",
    description:
      "Rough electricity and CO2 estimate for the building at a point, without selecting it. It reads the nearest map POI within 25 m to tell the building type (for example a school) and assumes a 150 m2 footprint, so its numbers can differ from the building panel, which measures the real footprint. When the app state has a selected building, use that instead. Good for checking what is at a place before showing it.",
    input_schema: {
      type: "object",
      properties: { lng: lngParam("the building"), lat: latParam("the building") },
      required: ["lng", "lat"],
    },
  },
  {
    name: "simulate_solar",
    description:
      "Rooftop solar for a building: system size (kWp) and panel count, yearly production, share of the building's electricity covered, battery size, cost, yearly saving, payback years and CO2 avoided. For the selected building, use the exact values given in the app state. Use backupHours 4 unless the user asks for another backup time.",
    input_schema: {
      type: "object",
      properties: {
        lat: latParam("the building"),
        lng: lngParam("the building"),
        roofAreaM2: { type: "number", description: "Roof area in m2 (the building footprint), more than 0." },
        kwhYear: { type: "number", description: "Electricity the building uses per year in kWh, more than 0." },
        backupHours: { type: "number", minimum: 0, maximum: 72, description: "Hours of battery backup; 0 means no battery." },
      },
      required: ["lat", "lng", "roofAreaM2", "kwhYear", "backupHours"],
    },
  },
  {
    name: "get_weather",
    description:
      "Weather forecast for the coming days at a point (rain, cloud) and the expected solar production per day for a system of kWp kilowatt-peak. Days are labelled \"hari ini\", \"besok\" and \"lusa\". Pass the kWp from simulate_solar when you have it; without it 1 kWp is used.",
    input_schema: {
      type: "object",
      properties: {
        lat: latParam("the place"),
        lng: lngParam("the place"),
        kWp: { type: "number", description: "Size of the solar system in kWp, more than 0. Optional, default 1." },
      },
      required: ["lat", "lng"],
    },
  },
];

const ACTION_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "fly_to_region",
    description: "Map action: fly the 3D map to a kabupaten/kota so the user sees the region you are talking about.",
    input_schema: { type: "object", properties: { region: REGION_PARAM }, required: ["region"] },
  },
  {
    name: "fly_to",
    description:
      "Map action: fly the camera to a point. Zoom 6 shows all of Kaltim, 10 a city, 14 a district, 17.5 single buildings.",
    input_schema: {
      type: "object",
      properties: {
        lng: lngParam("the point"),
        lat: latParam("the point"),
        zoom: { type: "number", minimum: 0, maximum: 22, description: "Map zoom level." },
      },
      required: ["lng", "lat", "zoom"],
    },
  },
  {
    name: "select_building_at",
    description:
      "Map action: fly to a point, select the building there and open its panel; the app measures that building and estimates its electricity and CO2. Use it to show the user a specific building.",
    input_schema: {
      type: "object",
      properties: { lng: lngParam("the building"), lat: latParam("the building") },
      required: ["lng", "lat"],
    },
  },
  {
    name: "toggle_layer",
    description:
      "Map action: show or hide a map layer: regions (the 3D region columns), plants (power plants) or buildings (3D buildings).",
    input_schema: {
      type: "object",
      properties: { layer: { type: "string", enum: [...LAYERS] }, visible: { type: "boolean" } },
      required: ["layer", "visible"],
    },
  },
  {
    name: "set_metric",
    description: "Map action: colour and raise the regions by CO2 emissions (co2) or by electricity use (kwh).",
    input_schema: { type: "object", properties: { metric: { type: "string", enum: [...METRICS] } }, required: ["metric"] },
  },
  {
    name: "set_rain",
    description: "Map action: the rain effect on the map: auto (follows the live weather), on or off.",
    input_schema: { type: "object", properties: { mode: { type: "string", enum: [...RAIN_MODES] } }, required: ["mode"] },
  },
  {
    name: "open_tab",
    description:
      "Map action: open a tab of the building panel: energi (electricity use), emisi (CO2 and everyday equivalents), surya (solar simulation) or cuaca (weather and solar forecast). Works when a building is selected.",
    input_schema: { type: "object", properties: { tab: { type: "string", enum: [...TABS] } }, required: ["tab"] },
  },
];

/** Every chat tool, in a fixed order so the prompt prefix stays cacheable. */
export const CHAT_TOOLS: Anthropic.Tool[] = [...SERVER_TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS];

export type ClientActionName =
  | "fly_to_region"
  | "fly_to"
  | "select_building_at"
  | "toggle_layer"
  | "set_metric"
  | "set_rain"
  | "open_tab";

/** A map action for the browser, with its input checked and normalised (region aliases resolved to ids). */
export interface ChatAction {
  name: ClientActionName;
  input: Record<string, unknown>;
}

type Checked = { input: Record<string, unknown> } | { problem: string };
type ToolOutput = { result: unknown } | { problem: string };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function point(i: Record<string, unknown>): { lng: number; lat: number } | { problem: string } {
  if (!inRange(i.lng, -180, 180)) return { problem: "lng harus berupa angka dari -180 sampai 180." };
  if (!inRange(i.lat, -90, 90)) return { problem: "lat harus berupa angka dari -90 sampai 90." };
  return { lng: i.lng, lat: i.lat };
}

/** The value as one of `values`, ignoring case and spaces around it, or null. */
function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase();
  return (values as readonly string[]).includes(key) ? (key as T) : null;
}

function region(v: unknown): { id: string } | { problem: string } {
  const text = typeof v === "string" ? v : "";
  const id = resolveRegion(text);
  if (id) return { id };
  return { problem: `"${text.slice(0, 80)}" bukan kabupaten/kota di Kalimantan Timur. Pilihan: ${REGION_NAMES}.` };
}

const ACTIONS: Record<ClientActionName, (i: Record<string, unknown>) => Checked> = {
  fly_to_region: (i) => {
    const r = region(i.region);
    return "problem" in r ? r : { input: { region: r.id } };
  },
  fly_to: (i) => {
    const p = point(i);
    if ("problem" in p) return p;
    if (!inRange(i.zoom, 0, 22)) return { problem: "zoom harus berupa angka dari 0 sampai 22." };
    return { input: { lng: p.lng, lat: p.lat, zoom: i.zoom } };
  },
  select_building_at: (i) => {
    const p = point(i);
    return "problem" in p ? p : { input: { lng: p.lng, lat: p.lat } };
  },
  toggle_layer: (i) => {
    const layer = oneOf(i.layer, LAYERS);
    if (!layer) return { problem: `layer harus salah satu dari: ${LAYERS.join(", ")}.` };
    if (typeof i.visible !== "boolean") return { problem: "visible harus true atau false." };
    return { input: { layer, visible: i.visible } };
  },
  set_metric: (i) => {
    const metric = oneOf(i.metric, METRICS);
    return metric ? { input: { metric } } : { problem: `metric harus salah satu dari: ${METRICS.join(", ")}.` };
  },
  set_rain: (i) => {
    const mode = oneOf(i.mode, RAIN_MODES);
    return mode ? { input: { mode } } : { problem: `mode harus salah satu dari: ${RAIN_MODES.join(", ")}.` };
  },
  open_tab: (i) => {
    const tab = oneOf(i.tab, TABS);
    return tab ? { input: { tab } } : { problem: `tab harus salah satu dari: ${TABS.join(", ")}.` };
  },
};

// ---------- formatting shared by the server tools ----------

const NO_DATA = "belum ada data";
const REGION_NOTE =
  "Listrik per wilayah adalah perkiraan dari penjualan listrik PLN 2024 per cabang, dibagi menurut jumlah pelanggan. " +
  "Emisi CO2 = kWh dikali faktor emisi jaringan Kaltim. Sumber: BPS Kalimantan Timur 2024 dan Kementerian ESDM.";
const FOOTPRINT_NOTE =
  `Luas lantai dasar belum diketahui karena gedungnya belum dipilih di peta, jadi dipakai asumsi ${DEFAULT_FOOTPRINT_M2} m2. ` +
  "Angka di panel gedung bisa berbeda karena memakai luas sebenarnya.";
const POI_DOWN_NOTE = "Data POI peta sedang tidak bisa diambil, jadi jenis gedung ditebak dari luas lantai dasar.";
const WEATHER_DOWN = "Prakiraan cuaca sedang tidak tersedia.";
const FUEL_WORDS: Record<FuelType, string> = {
  batubara: "batu bara",
  gas: "gas",
  diesel: "diesel",
  surya: "surya",
  air: "air",
  biomassa: "biomassa",
  lainnya: "lainnya",
};

const estimated = (text: string, isEstimate = true) => (isEstimate ? `${text} (perkiraan)` : text);
const kwhPerYear = (kwh: number) => `${fmtCompact(kwh)} kWh per tahun`;
const co2PerYear = (kg: number) => `${fmtCompact(kg / 1000)} ton CO2 per tahun`;
const percent = (n: number, digits = 1) => `${fmtNumber(n, digits)}%`;

/** A building type in words: "rumah_sakit" reads "rumah sakit". */
export function buildingTypeLabel(type: BuildingType): string {
  return type.replace("_", " ");
}

function rankByCo2(regions: RegionSummary[]): RegionSummary[] {
  return [...regions].sort((a, b) => b.co2KgYear - a.co2KgYear);
}

const DAY_MS = 86_400_000;
const WITA_MS = 8 * 3600_000;
const WEEKDAY = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" });

/** Today's date in WITA (UTC+8, no daylight saving) as YYYY-MM-DD, the format of the forecast days. */
function witaDate(ms: number): string {
  return new Date(ms + WITA_MS).toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string): string {
  const at = Date.parse(`${date}T00:00:00Z`);
  const weekday = WEEKDAY.format(at);
  const ahead = Math.round((at - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (ahead === 0) return `hari ini (${weekday})`;
  if (ahead === 1) return `besok (${weekday})`;
  if (ahead === 2) return `lusa (${weekday})`;
  return weekday;
}

function comparedToBest(kwh: number, best: number): string {
  if (best <= 0 || kwh >= best) return "hari terbaik dalam prakiraan";
  const lowerPct = Math.round((1 - kwh / best) * 100);
  if (lowerPct === 0) return "hampir sama dengan hari terbaik dalam prakiraan";
  return `${fmtNumber(lowerPct)}% lebih rendah dari hari terbaik dalam prakiraan`;
}

// ---------- server tools ----------

type ServerToolName =
  | "list_regions"
  | "get_region_stats"
  | "get_grid_mix"
  | "estimate_building_at"
  | "simulate_solar"
  | "get_weather";

const SERVER_TOOLS: Record<ServerToolName, (deps: AppDeps, i: Record<string, unknown>) => Promise<ToolOutput>> = {
  list_regions: async (deps) => {
    const regions = await deps.db.listRegions();
    const totalKwh = regions.reduce((sum, r) => sum + r.kwhYear, 0);
    const totalCo2 = regions.reduce((sum, r) => sum + r.co2KgYear, 0);
    return {
      result: {
        note: REGION_NOTE,
        kaltim: { kwhText: estimated(kwhPerYear(totalKwh)), co2Text: estimated(co2PerYear(totalCo2)) },
        regions: rankByCo2(regions).map((r, i) => ({
          rank: i + 1,
          id: r.id,
          name: r.name,
          kind: r.kind,
          kwhText: estimated(kwhPerYear(r.kwhYear), r.estimated),
          co2Text: estimated(co2PerYear(r.co2KgYear)),
          kwhShareText: estimated(percent(totalKwh > 0 ? (r.kwhYear / totalKwh) * 100 : 0), r.estimated),
        })),
      },
    };
  },

  get_region_stats: async (deps, i) => {
    const wanted = region(i.region);
    if ("problem" in wanted) return wanted;
    const regions = await deps.db.listRegions();
    const ranked = rankByCo2(regions);
    const rank = ranked.findIndex((r) => r.id === wanted.id) + 1;
    const r = ranked[rank - 1];
    if (!r) return { problem: `Data wilayah ${wanted.id} belum ada.` };
    const totalKwh = regions.reduce((sum, x) => sum + x.kwhYear, 0);
    return {
      result: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        co2Rank: `${rank} dari ${ranked.length} wilayah (1 = emisi tertinggi)`,
        facts: {
          "Listrik terpakai": estimated(kwhPerYear(r.kwhYear), r.estimated),
          "Emisi CO2": estimated(co2PerYear(r.co2KgYear)),
          "Bagian dari listrik Kaltim": estimated(percent(totalKwh > 0 ? (r.kwhYear / totalKwh) * 100 : 0), r.estimated),
          "Listrik per orang": r.population
            ? estimated(`${fmtNumber(r.kwhYear / r.population)} kWh per tahun`, r.estimated)
            : NO_DATA,
          Penduduk: r.population === null ? NO_DATA : `${fmtNumber(r.population)} jiwa`,
          "Pelanggan PLN": r.customers === null ? NO_DATA : fmtNumber(r.customers),
          "Rasio elektrifikasi": r.electrificationPct === null ? NO_DATA : percent(r.electrificationPct),
          "Desa belum dilayani PLN": r.villagesNoPln === null ? NO_DATA : `${fmtNumber(r.villagesNoPln)} desa`,
        },
        note: REGION_NOTE,
      },
    };
  },

  get_grid_mix: async (deps) => {
    const grid = await deps.db.getGridMix();
    const mix = (Object.entries(grid.shares) as [FuelType, number][])
      .filter(([, share]) => share > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([fuel, share]) => ({ fuel: FUEL_WORDS[fuel] ?? fuel, shareText: percent(share * 100, 0) }));
    return {
      result: {
        year: grid.year,
        gridFactorText: `${fmtNumber(grid.factorKgPerKwh, 2)} kg CO2 per kWh`,
        mix,
        note:
          "Porsi tiap sumber adalah perkiraan. Listrik PLN di Kaltim mengalir lewat satu jaringan, jadi campuran ini " +
          "berlaku untuk semua pelanggan; listrik satu gedung tidak bisa ditelusuri ke satu pembangkit.",
        source: grid.source,
      },
    };
  },

  estimate_building_at: async (deps, i) => {
    const p = point(i);
    if ("problem" in p) return p;
    const found = await cachedPoi(deps, p.lng, p.lat);
    const input: BuildingInput = {
      featureId: `chat:${poiCacheKey(p.lng, p.lat)}`,
      lng: p.lng,
      lat: p.lat,
      footprintM2: DEFAULT_FOOTPRINT_M2,
      heightM: null,
      poiClass: found.poi?.class ?? null,
      poiType: found.poi?.type ?? null,
    };
    const [where, types, grid, equivalents] = await Promise.all([
      deps.db.regionAt(p.lng, p.lat),
      deps.db.getBuildingTypes(),
      deps.db.getGridMix(),
      deps.db.getEquivalentFactors(),
    ]);
    const est = estimateBuilding(input, { types, grid, equivalents, region: where });
    return {
      result: {
        location: { lng: p.lng, lat: p.lat },
        region: est.region?.name ?? "Di luar Kalimantan Timur",
        poi: found.poi
          ? { name: found.poi.name, class: found.poi.class, type: found.poi.type, distanceM: Math.round(found.poi.distanceM) }
          : null,
        type: buildingTypeLabel(est.type),
        typeFrom: est.typeSource === "poi" ? "POI peta terdekat" : "tebakan dari luas lantai dasar",
        floors: est.floors,
        footprintM2: DEFAULT_FOOTPRINT_M2,
        floorAreaM2: est.floorAreaM2,
        kwhYear: Math.round(est.kwhYear),
        kwhYearText: estimated(`${fmtKwh(est.kwhYear)} per tahun`),
        kwhMonthText: estimated(`${fmtKwh(est.kwhMonth)} per bulan`),
        co2YearText: estimated(`${fmtKg(est.co2KgYear)} CO2 per tahun`),
        equivalents: est.equivalents.map((e) => `${fmtNumber(e.value)} ${e.label}`),
        assumptions: [FOOTPRINT_NOTE, ...(found.degraded ? [POI_DOWN_NOTE] : []), ...est.assumptions],
      },
    };
  },

  simulate_solar: async (deps, i) => {
    const parsed = parseSolarInput(i);
    if ("problem" in parsed) return parsed;
    const sim = await simulateSolarAt(deps, parsed.input);
    if (sim.kWp <= 0) {
      return { result: { kWp: 0, note: "Atap terlalu kecil untuk dipasangi panel surya.", assumptions: sim.assumptions } };
    }
    return {
      result: {
        input: parsed.input,
        kWp: sim.kWp,
        systemText: estimated(`${fmtNumber(sim.kWp, 1)} kWp, ${fmtNumber(sim.panels)} panel`),
        productionText: estimated(`${fmtKwh(sim.kwhYear)} per tahun`),
        coverageText: estimated(`${percent(sim.coveragePct, 0)} kebutuhan listrik gedung`),
        batteryText:
          sim.batteryKwh > 0
            ? estimated(`${fmtNumber(sim.batteryKwh, 1)} kWh untuk ${fmtNumber(parsed.input.backupHours)} jam cadangan`)
            : "tanpa baterai",
        costText: estimated(fmtRupiah(sim.costRp)),
        savingText: estimated(`${fmtRupiah(sim.savingRpYear)} per tahun`),
        paybackText: estimated(`${fmtNumber(sim.paybackYears, 1)} tahun`),
        co2AvoidedText: estimated(`${fmtKg(sim.co2AvoidedKgYear)} CO2 per tahun`),
        peakSunHoursText: `${fmtNumber(sim.peakSunHours, 1)} jam matahari puncak per hari`,
        assumptions: sim.assumptions,
      },
    };
  },

  get_weather: async (deps, i) => {
    const p = point(i);
    if ("problem" in p) return p;
    const given = i.kWp !== undefined && i.kWp !== null;
    if (given && !(inRange(i.kWp, 0, MAX_KWP) && i.kWp > 0)) {
      return { problem: `kWp harus berupa angka lebih dari 0 dan paling besar ${fmtNumber(MAX_KWP)}.` };
    }
    const kWp = given ? (i.kWp as number) : DEFAULT_KWP;
    const nowMs = Date.now();
    const forecast = await cachedForecast(deps, p.lat, p.lng, nowMs);
    if (!forecast) return { problem: WEATHER_DOWN };
    const today = witaDate(nowMs);
    // A stale forecast can start before today; only today and later days are useful.
    const days = summariseDays(pvFromForecast(forecast.hours, kWp)).filter((d) => d.date >= today);
    if (days.length === 0) return { problem: WEATHER_DOWN };
    const best = Math.max(...days.map((d) => d.pvKwh));
    const now = currentConditions(forecast.hours, nowMs);
    return {
      result: {
        location: { lat: p.lat, lng: p.lng },
        kWp,
        ...(given ? {} : { kWpNote: `Ukuran panel belum diketahui, jadi produksi surya dihitung untuk ${DEFAULT_KWP} kWp.` }),
        now: { raining: now.raining, cloudText: percent(now.cloudPct, 0), daytime: now.isDay },
        days: days.map((d) => ({
          date: d.date,
          day: dayLabel(d.date, today),
          rain: d.rainy,
          heaviestRainText: `${fmtNumber(d.maxPrecipMm, 1)} mm per jam`,
          solarText: estimated(`${fmtNumber(d.pvKwh, 1)} kWh`),
          comparedToBestDay: comparedToBest(d.pvKwh, best),
        })),
        ...(forecast.stale ? { note: "Prakiraan ini dari simpanan lama karena Open-Meteo sedang tidak bisa dihubungi." } : {}),
        source: "Prakiraan cuaca Open-Meteo. Produksi surya = kWp x radiasi matahari x 0,78.",
      },
    };
  },
};

const ALL_TOOL_NAMES = CHAT_TOOLS.map((t) => t.name).join(", ");

const result = (id: string, value: unknown): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: JSON.stringify(value),
});
const failure = (id: string, problem: string): Anthropic.ToolResultBlockParam => ({
  type: "tool_result",
  tool_use_id: id,
  content: problem,
  is_error: true,
});

/**
 * Runs the tool calls of one Claude reply. Map actions are checked and handed to `onAction` right away,
 * in the order Claude asked for them; server tools run concurrently. Returns one result per call, in the
 * same order, to send back in a single user message. Never throws: a failing tool becomes an error result.
 */
export async function runToolCalls(
  deps: AppDeps,
  calls: Anthropic.ToolUseBlock[],
  onAction: (action: ChatAction) => void,
): Promise<Anthropic.ToolResultBlockParam[]> {
  return Promise.all(
    calls.map(async (call): Promise<Anthropic.ToolResultBlockParam> => {
      const input = asObject(call.input);
      if (Object.hasOwn(ACTIONS, call.name)) {
        const name = call.name as ClientActionName;
        const checked = ACTIONS[name](input);
        if ("problem" in checked) return failure(call.id, checked.problem);
        onAction({ name, input: checked.input });
        return result(call.id, { ok: true });
      }
      if (!Object.hasOwn(SERVER_TOOLS, call.name)) {
        return failure(call.id, `Alat "${call.name.slice(0, 80)}" tidak ada. Alat yang tersedia: ${ALL_TOOL_NAMES}.`);
      }
      try {
        const out = await SERVER_TOOLS[call.name as ServerToolName](deps, input);
        return "problem" in out ? failure(call.id, out.problem) : result(call.id, out.result);
      } catch (err) {
        console.warn(`chat tool ${call.name} failed:`, err instanceof Error ? err.message : "unknown error");
        return failure(call.id, "Data sedang tidak bisa dimuat. Sampaikan ke pengguna bahwa datanya belum bisa diambil sekarang.");
      }
    }),
  );
}
