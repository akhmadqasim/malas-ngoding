import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import costs from "../../../data/seed/solar-costs.json";
import { yieldPerKwpYear } from "../../shared/solar.ts";
import type {
  GridMix,
  RecommendationCategory,
  RecommendationItem,
  Recommendations,
  RegionSummary,
} from "../../shared/types.ts";
import type { RegionPlant } from "../db.ts";
import type { AppDeps } from "../app.ts";
import { cachedClimatology } from "./cache.ts";
import type { Climatology } from "./nasaPower.ts";
import { CATEGORIES, describeRegionFacts, RECOMMENDATION_TOOL, SYSTEM_PROMPT, TOOL_NAME } from "./recommendationPrompt.ts";
import { ruleBasedRecommendations } from "./recommendationRules.ts";
import { simulateBuildingSolar } from "./solarTariff.ts";

const MODEL = "claude-haiku-5-5";
const MAX_TOKENS = 2048;
/** Per attempt; an answer took 8 to 10 s in testing. The client retries once on a timeout, a 429 or a 5xx. */
const ATTEMPT_TIMEOUT_MS = 45_000;
/** Hard limit for one region's answer, retries included. Routes keep their connection open longer than this. */
export const GENERATION_BUDGET_MS = 100_000;

const MIN_ITEMS = 3;
const MAX_ITEMS = 6;

// --- Facts ---------------------------------------------------------------------------------------

/** Everything the recommendations for one region may use. Every number comes from our data. */
export interface RegionFacts {
  region: RegionSummary;
  /** The region among all kabupaten/kota. Ranks count from the largest value (1 = largest); null without data. */
  comparison: {
    regionCount: number;
    kwhSharePct: number;
    kwhRank: number;
    kwhPerCapita: number | null;
    /** False when the region's population cannot be compared per person (see `POPULATION_NOT_COMPARABLE`). */
    kwhPerCapitaComparable: boolean;
    /** Rank among the `kwhPerCapitaCount` comparable regions; null when not comparable. */
    kwhPerCapitaRank: number | null;
    kwhPerCapitaCount: number;
    /** Total kWh over total population of the comparable regions. */
    kwhPerCapitaAll: number | null;
    /** Names of the regions left out of the per-person average and ranks. */
    kwhPerCapitaLeftOut: string[];
    /** Within 5% of the average counts as "similar"; null when not comparable. */
    kwhPerCapitaVsAll: "above" | "similar" | "below" | null;
    kwhPerCustomer: number | null;
    electrificationRank: number | null;
  };
  /** Plants whose point lies inside the region. */
  plants: RegionPlant[];
  /** Peak sun hours at the region's label point. `fallback` is set when it is the seed assumption. */
  climate: Climatology & { fallback?: string };
  grid: GridMix;
  /**
   * Rooftop PV on the reference government office (`REFERENCE_GOV_OFFICE`) in this region, priced as the
   * Surya tab prices a `pemerintahan` building: only the power used on site saves money and CO2. Per kWp
   * figures are the office's totals over its kWp. No battery. All estimates.
   */
  solar: {
    /** Output of 1 kWp, used or not. */
    kwhPerKwpYear: number;
    /** Share of the panel output the office uses itself, in %; the rest goes to the grid unpaid. */
    selfUsePct: number;
    /** Days a year a government office is open, and its daytime share of an open day's load in %. */
    openDaysPerYear: number;
    daytimeSharePct: number;
    /** Self-use times the solar emission factor (`solarFactorKgPerKwh`). */
    co2AvoidedKgPerKwpYear: number;
    solarFactorKgPerKwh: number;
    costRpPerKwp: number;
    /** Tariff P1, government buildings of 6,600 VA to 200 kVA. */
    govTariffRpPerKwh: number;
    savingRpPerKwpYear: number;
    /** Without a battery: the Surya tab's "Tanpa baterai" payback for the same office. */
    paybackYears: number;
  };
}

/**
 * The government office the region card's PV figures stand for (asumsi): 100 MWh a year, so on tariff P1,
 * with a roof large enough for the panels its daytime use needs, and no battery.
 */
export const REFERENCE_GOV_OFFICE = { kwhYear: 100_000, roofAreaM2: 2_000, backupHours: 0, buildingType: "pemerintahan" } as const;

/** The `solar` facts for a region whose peak sun hours are `peakSunHours`. */
export function regionSolarFacts(peakSunHours: number): RegionFacts["solar"] {
  const { result, tariff, use } = simulateBuildingSolar({ peakSunHours, ...REFERENCE_GOV_OFFICE });
  const perKwp = (n: number) => (result.kWp > 0 ? n / result.kWp : 0);
  return {
    kwhPerKwpYear: yieldPerKwpYear(peakSunHours),
    selfUsePct: result.kwhYear > 0 ? (result.selfUseKwh / result.kwhYear) * 100 : 0,
    openDaysPerYear: use.openDays,
    daytimeSharePct: use.share * 100,
    co2AvoidedKgPerKwpYear: perKwp(result.co2AvoidedKgYear),
    solarFactorKgPerKwh: costs.solarFactorKgPerKwh,
    costRpPerKwp: costs.costRpPerKwp,
    govTariffRpPerKwh: tariff.rpPerKwh,
    savingRpPerKwpYear: perKwp(result.savingRpYear),
    paybackYears: result.paybackYears,
  };
}

/** 1 + the number of values above `value`, or null when there is no value. */
function rankOf(value: number | null, values: (number | null)[]): number | null {
  if (value === null) return null;
  return 1 + values.filter((v) => v !== null && v > value).length;
}

const perCapita = (r: RegionSummary): number | null => (r.population ? r.kwhYear / r.population : null);

/**
 * Regions whose population cannot be compared per person. The BPS 2025 projection for Penajam Paser Utara
 * already includes the planned move of IKN, so it is far above today's head count
 * (docs/research/gaps-filled.md, section 4).
 */
export const POPULATION_NOT_COMPARABLE: ReadonlySet<string> = new Set(["penajam-paser-utara"]);
/** Use per person within this share of the average counts as level with it; the kWh split itself is rough. */
const SIMILAR_SHARE = 0.05;

/** Pure part of `gatherRegionFacts`: derives the comparison and PV figures. Null for an unknown region. */
export function buildRegionFacts(input: {
  regionId: string;
  regions: RegionSummary[];
  plants: RegionPlant[];
  climate: Climatology & { fallback?: string };
  grid: GridMix;
}): RegionFacts | null {
  const { regions, plants, climate, grid } = input;
  const region = regions.find((r) => r.id === input.regionId);
  if (!region) return null;

  const totalKwh = regions.reduce((sum, r) => sum + r.kwhYear, 0);
  const comparable = regions.filter((r) => r.population && !POPULATION_NOT_COMPARABLE.has(r.id));
  const people = comparable.reduce((sum, r) => sum + (r.population ?? 0), 0);
  const kwhPerCapitaAll = people > 0 ? comparable.reduce((sum, r) => sum + r.kwhYear, 0) / people : null;
  const own = POPULATION_NOT_COMPARABLE.has(region.id) ? null : perCapita(region);
  const vsAll =
    own === null || kwhPerCapitaAll === null
      ? null
      : own > kwhPerCapitaAll * (1 + SIMILAR_SHARE)
        ? "above"
        : own < kwhPerCapitaAll * (1 - SIMILAR_SHARE)
          ? "below"
          : "similar";
  return {
    region,
    comparison: {
      regionCount: regions.length,
      kwhSharePct: totalKwh > 0 ? (region.kwhYear / totalKwh) * 100 : 0,
      kwhRank: 1 + regions.filter((r) => r.kwhYear > region.kwhYear).length,
      kwhPerCapita: perCapita(region),
      kwhPerCapitaComparable: !POPULATION_NOT_COMPARABLE.has(region.id),
      kwhPerCapitaRank: rankOf(own, comparable.map(perCapita)),
      kwhPerCapitaCount: comparable.length,
      kwhPerCapitaAll,
      kwhPerCapitaLeftOut: regions.filter((r) => POPULATION_NOT_COMPARABLE.has(r.id)).map((r) => r.name),
      kwhPerCapitaVsAll: vsAll,
      kwhPerCustomer: region.customers ? region.kwhYear / region.customers : null,
      electrificationRank: rankOf(region.electrificationPct, regions.map((r) => r.electrificationPct)),
    },
    plants,
    climate,
    grid,
    solar: regionSolarFacts(climate.pshYear),
  };
}

/**
 * Reads the facts for a region: its summary next to all others, the plants inside it, the grid mix and
 * the peak sun hours at its label point (NASA POWER through the cache). Null for an unknown region.
 * Throws on database errors.
 */
export async function gatherRegionFacts(
  deps: Pick<AppDeps, "db" | "nasa">,
  regionId: string,
): Promise<RegionFacts | null> {
  const [regions, plants, point, grid] = await Promise.all([
    deps.db.listRegions(),
    deps.db.plantsInRegion(regionId),
    deps.db.regionLabelPoint(regionId),
    deps.db.getGridMix(),
  ]);
  if (!point || !regions.some((r) => r.id === regionId)) return null;
  const [lng, lat] = point;
  const climate = await cachedClimatology(deps, lat, lng);
  return buildRegionFacts({ regionId, regions, plants, climate, grid });
}

// --- Validation ----------------------------------------------------------------------------------

const isCategory = (v: unknown): v is RecommendationCategory => CATEGORIES.includes(v as RecommendationCategory);
const isPriority = (v: unknown): v is RecommendationItem["priority"] => v === 1 || v === 2 || v === 3;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Items from Claude or the cache, checked: 3 to 6 items, known categories, priority 1 to 3 and non-empty
 * text. Returns them trimmed, with only the known fields, ordered by priority; null when anything is off.
 */
export function parseRecommendationItems(list: unknown): RecommendationItem[] | null {
  if (!Array.isArray(list) || list.length < MIN_ITEMS || list.length > MAX_ITEMS) return null;
  const items: RecommendationItem[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) return null;
    const v = raw as Record<string, unknown>;
    const title = text(v.title);
    const body = text(v.body);
    const impact = text(v.impact);
    if (!title || !body || !impact || !isCategory(v.category) || !isPriority(v.priority)) return null;
    items.push({ title, category: v.category, body, impact, priority: v.priority });
  }
  return items.sort((a, b) => a.priority - b.priority);
}

// --- Claude --------------------------------------------------------------------------------------

/** Writes recommendations for a region. Throws on API errors and on answers that fail validation. */
export type RecommendationWriter = (facts: RegionFacts) => Promise<{ items: RecommendationItem[]; model: string }>;

/**
 * One Messages API call per region. The answer comes back as the input of a strict tool call; this model
 * rejects a forced `tool_choice`, so the prompt asks for the call and a missing call counts as a failure.
 */
export function createClaudeRecommender(
  apiKey: string,
  opts: { fetch?: ClientOptions["fetch"]; maxRetries?: number; budgetMs?: number } = {},
): RecommendationWriter {
  const client = new Anthropic({
    apiKey,
    fetch: opts.fetch,
    timeout: ATTEMPT_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? 1,
  });
  const budgetMs = opts.budgetMs ?? GENERATION_BUDGET_MS;
  return async (facts) => {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Content generation: low effort keeps any thinking short, so the answer fits in max_tokens.
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [RECOMMENDATION_TOOL],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: [{ role: "user", content: describeRegionFacts(facts) }],
      },
      { signal: AbortSignal.timeout(budgetMs) },
    );
    if (message.stop_reason !== "tool_use") {
      throw new Error(`Claude stopped with ${message.stop_reason ?? "no stop reason"} instead of calling ${TOOL_NAME}`);
    }
    const call = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
    );
    if (!call) throw new Error(`Claude made no ${TOOL_NAME} call`);
    const input = call.input;
    const items = parseRecommendationItems(
      typeof input === "object" && input !== null ? (input as { items?: unknown }).items : undefined,
    );
    if (!items) throw new Error("Claude's recommendations failed validation");
    return { items, model: message.model };
  };
}

// --- Read-through cache --------------------------------------------------------------------------

type Deps = Pick<AppDeps, "db" | "nasa" | "recommender">;

function warn(what: string, err: unknown): void {
  console.warn(`${what}:`, err instanceof Error ? err.message : "unknown error");
}

async function cachedRecommendations(deps: Deps, regionId: string): Promise<Recommendations | null> {
  try {
    const row = await deps.db.recommendationsGet(regionId);
    const items = row ? parseRecommendationItems(row.items) : null;
    if (row && items) return { regionId, items, model: row.model, generatedAt: row.generatedAt.toISOString() };
  } catch (err) {
    // A broken cache must not break the panel; fall through to a fresh answer.
    warn("recommendations cache read failed", err);
  }
  return null;
}

/** Generations in flight per dependency set and region, so concurrent requests share one Claude call. */
const inFlight = new WeakMap<object, Map<string, Promise<Recommendations | null>>>();

/**
 * Recommendations for a region: the cached copy, or new ones from Claude (and stored) on a miss or a
 * refresh. Concurrent misses and refreshes for one region share one generation. When Claude is
 * unavailable or its answer is invalid, a refresh keeps the cached copy and otherwise rule-based items
 * come back with `model: null` (never stored, so the next request retries). Null for an unknown region.
 * Throws only when reading the region's data from the database fails.
 */
export async function recommendationsFor(
  deps: Deps,
  regionId: string,
  opts: { refresh?: boolean } = {},
): Promise<Recommendations | null> {
  const previous = await cachedRecommendations(deps, regionId);
  if (previous && !opts.refresh) return previous;

  let running = inFlight.get(deps);
  if (!running) {
    running = new Map();
    inFlight.set(deps, running);
  }
  const pending = running.get(regionId);
  if (pending) return pending;
  const job = generate(deps, regionId, previous).finally(() => running.delete(regionId));
  running.set(regionId, job);
  return job;
}

/** One generation for `recommendationsFor`; `previous` is the valid cached copy, if any. */
async function generate(deps: Deps, regionId: string, previous: Recommendations | null): Promise<Recommendations | null> {
  const facts = await gatherRegionFacts(deps, regionId);
  if (!facts) return null;
  // Without NASA data a new answer would rest on the assumed sun hours; keep what was written with real data.
  if (previous && facts.climate.fallback) return previous;

  if (deps.recommender) {
    try {
      const { items, model } = await deps.recommender(facts);
      let generatedAt = new Date();
      // Written with the assumed peak sun hours: serve it, but let the next request retry with NASA data.
      if (!facts.climate.fallback) {
        try {
          generatedAt = await deps.db.recommendationsSet(regionId, items, model);
        } catch (err) {
          warn("recommendations cache write failed", err);
        }
      }
      return { regionId, items, model, generatedAt: generatedAt.toISOString() };
    } catch (err) {
      warn("claude recommendations failed", err);
    }
  }
  return previous ?? { regionId, items: ruleBasedRecommendations(facts), model: null, generatedAt: new Date().toISOString() };
}
