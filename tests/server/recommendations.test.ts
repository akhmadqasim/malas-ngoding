import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import seedGrid from "../../data/seed/grid.json";
import seedRegions from "../../data/seed/regions.json";
import { warmCaches } from "../../scripts/warm.ts";
import type { RegionPlant } from "../../src/server/db.ts";
import type { Handler } from "../../src/server/http.ts";
import { createServer } from "../../src/server/index.ts";
import { recommendationRoutes } from "../../src/server/routes/recommendations.ts";
import type { SolarSimulation } from "../../src/server/routes/solar.ts";
import { dec, describeRegionFacts, SYSTEM_PROMPT } from "../../src/server/services/recommendationPrompt.ts";
import { ruleBasedRecommendations } from "../../src/server/services/recommendationRules.ts";
import {
  buildRegionFacts,
  createClaudeRecommender,
  GENERATION_BUDGET_MS,
  parseRecommendationItems,
  REFERENCE_GOV_OFFICE,
  type RecommendationWriter,
  type RegionFacts,
} from "../../src/server/services/recommendations.ts";
import type { GridMix, RecommendationItem, Recommendations, RegionSummary } from "../../src/shared/types.ts";
import { type FakeUpstreams, fakeDeps } from "./fakes.ts";

const CATEGORIES = ["akses_listrik", "efisiensi", "energi_terbarukan", "kebijakan", "tata_ruang"];

const VALID: RecommendationItem[] = [
  { title: "Pasang PLTS atap di kantor pemerintah", category: "energi_terbarukan", body: "Isi pertama.", impact: "Dampak pertama (perkiraan).", priority: 1 },
  { title: "Audit energi gedung publik", category: "efisiensi", body: "Isi kedua.", impact: "Dampak kedua.", priority: 2 },
  { title: "Masukkan potensi surya ke RTRW", category: "tata_ruang", body: "Isi ketiga.", impact: "Dampak ketiga.", priority: 3 },
];

// The real seed data, so the rule and prompt tests see the regions as the app does.
const GRID = seedGrid as GridMix;
const REGIONS: RegionSummary[] = seedRegions.map((r) => ({
  id: r.id,
  name: r.name,
  kind: r.kind as RegionSummary["kind"],
  kwhYear: r.kwhYear,
  co2KgYear: r.kwhYear * GRID.factorKgPerKwh,
  population: r.population,
  customers: r.customers,
  electrificationPct: r.electrificationPct,
  villagesNoPln: r.villagesNoPln,
  estimated: r.estimated,
}));
const CLIMATE = { pshByMonth: [4.5, 4.6, 4.7, 4.8, 4.7, 4.3, 4.5, 4.9, 5.1, 4.9, 4.6, 4.5], pshYear: 4.68 };
const PLANTS: RegionPlant[] = [
  { name: "AlamTri captive coal power station", fuel: "batubara", capacityMw: 2200, status: "unknown", approx: true, source: "snippet, captive, not PLN grid" },
  { name: "PLTGU Tanjung Batu", fuel: "gas", capacityMw: 60, status: "operating", approx: false, source: "gem.wiki" },
];

function facts(regionId: string, patch: { plants?: RegionPlant[]; climate?: RegionFacts["climate"]; grid?: GridMix } = {}): RegionFacts {
  const out = buildRegionFacts({
    regionId,
    regions: REGIONS,
    plants: patch.plants ?? [],
    climate: patch.climate ?? CLIMATE,
    grid: patch.grid ?? GRID,
  });
  if (!out) throw new Error(`no facts for ${regionId}`);
  return out;
}

/** A writer that records the facts it was given and answers with `answer` (or throws it). */
function fakeWriter(answer: RecommendationItem[] | Error, model = "claude-sonnet-5-5") {
  const calls: RegionFacts[] = [];
  const fn: RecommendationWriter = async (f) => {
    calls.push(f);
    if (answer instanceof Error) throw answer;
    return { items: answer, model };
  };
  return { fn, calls };
}

/** A writer that answers after `ms`, counting calls that started and finished. */
function slowWriter(answer: RecommendationItem[], ms = 30) {
  const counts = { started: 0, finished: 0 };
  const fn: RecommendationWriter = async () => {
    counts.started++;
    await Bun.sleep(ms);
    counts.finished++;
    return { items: answer, model: "claude-sonnet-5-5" };
  };
  return { fn, counts };
}

/** A Messages API reply as JSON, the way the API sends it. */
function messageJson(content: unknown[], stopReason = "tool_use") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    usage: { input_tokens: 1200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
const toolUse = (input: unknown) => ({ type: "tool_use", id: "toolu_test", name: "save_recommendations", input, caller: { type: "direct" } });

/** A fetch for the Anthropic client that records each request and answers with `reply`. */
function claudeFetch(reply: unknown, status = 200) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(reply, { status });
  }) as unknown as typeof fetch;
  return { fetcher, requests };
}

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(upstreams: FakeUpstreams = {}) {
  const fake = fakeDeps(null, upstreams);
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}
const get = (s: Server<undefined>, id: string) => fetch(new URL(`/api/recommendations/${id}`, s.url));
const refresh = (s: Server<undefined>, id: string) =>
  fetch(new URL(`/api/recommendations/${id}/refresh`, s.url), { method: "POST" });

let warn: ReturnType<typeof spyOn>;
beforeEach(() => {
  // Swallowed upstream errors log a warning; keep the output clean and assert on it where it matters.
  warn = spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("GET /api/recommendations/:regionId", () => {
  test("returns the cached content without calling Claude", async () => {
    const writer = fakeWriter(new Error("Claude must not be called"));
    const { server, fake } = start({ recommender: writer.fn });
    const at = await fake.deps.db.recommendationsSet("samarinda", VALID, "claude-sonnet-5-5");

    const res = await get(server, "samarinda");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      regionId: "samarinda",
      items: VALID,
      model: "claude-sonnet-5-5",
      generatedAt: at.toISOString(),
    });
    expect(writer.calls).toHaveLength(0);
  });

  test("a miss is written by Claude from the region's facts, stored, then served from the cache", async () => {
    const writer = fakeWriter(VALID);
    const { server, fake } = start({ recommender: writer.fn });

    const first = (await (await get(server, "kutai-kartanegara")).json()) as Recommendations;
    expect(first.regionId).toBe("kutai-kartanegara");
    expect(first.items).toEqual(VALID);
    expect(first.model).toBe("claude-sonnet-5-5");
    expect(Number.isNaN(Date.parse(first.generatedAt))).toBe(false);

    expect(writer.calls).toHaveLength(1);
    const seen = writer.calls[0]!;
    expect(seen.region.id).toBe("kutai-kartanegara");
    expect(seen.plants.map((p) => p.name)).toEqual(["PLTG Senipah", "PLTU Embalut"]);
    expect(seen.climate.pshYear).toBe(4.8);
    expect(seen.climate.fallback).toBeUndefined();
    expect(seen.grid.factorKgPerKwh).toBe(1.14);
    expect(fake.stored.has("recommendations:kutai-kartanegara")).toBe(true);

    const second = (await (await get(server, "kutai-kartanegara")).json()) as Recommendations;
    expect(second).toEqual(first);
    expect(writer.calls).toHaveLength(1);
  });

  test("a Claude failure gives rule-based items with model null, and caches nothing", async () => {
    const writer = fakeWriter(new Error("anthropic down"));
    const { server, fake } = start({ recommender: writer.fn });

    const res = await get(server, "samarinda");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Recommendations;
    expect(body.regionId).toBe("samarinda");
    expect(body.model).toBeNull();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(parseRecommendationItems(body.items)).toEqual(body.items);
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(fake.stored.has("recommendations:samarinda")).toBe(false);
    expect(warn).toHaveBeenCalled();

    // Nothing was cached, so the next request asks Claude again.
    await get(server, "samarinda");
    expect(writer.calls).toHaveLength(2);
  });

  test("a malformed Claude tool result gives rule-based items", async () => {
    const malformed = { items: [{ title: "", category: "lainnya", body: "x", impact: "y", priority: 5 }] };
    const claude = claudeFetch(messageJson([toolUse(malformed)]));
    const { server, fake } = start({
      recommender: createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 }),
    });

    const res = await get(server, "samarinda");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Recommendations;
    expect(claude.requests).toHaveLength(1);
    expect(body.model).toBeNull();
    expect(parseRecommendationItems(body.items)).toEqual(body.items);
    expect(fake.stored.has("recommendations:samarinda")).toBe(false);
  });

  test("without an API key the rule-based items are served and nothing is cached", async () => {
    const { server, fake } = start();
    const body = (await (await get(server, "berau")).json()) as Recommendations;
    expect(body.model).toBeNull();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(fake.stored.has("recommendations:berau")).toBe(false);
  });

  test("while NASA POWER is down, Claude's content is served but not cached", async () => {
    const writer = fakeWriter(VALID);
    const { server, fake } = start({ recommender: writer.fn, nasa: new Error("nasa down") });
    const body = (await (await get(server, "samarinda")).json()) as Recommendations;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(writer.calls[0]?.climate.fallback).toContain("NASA POWER");
    expect(writer.calls[0]?.climate.pshYear).toBe(4.2);
    expect(fake.stored.has("recommendations:samarinda")).toBe(false);
  });

  test("cached content that no longer validates is treated as a miss", async () => {
    const writer = fakeWriter(VALID);
    const { server, fake } = start({ recommender: writer.fn });
    fake.stored.set("recommendations:bontang", { items: [{ title: "rusak" }], model: "old-model" });
    const body = (await (await get(server, "bontang")).json()) as Recommendations;
    expect(writer.calls).toHaveLength(1);
    expect(body.items).toEqual(VALID);
  });

  test("concurrent misses for one region share one Claude call", async () => {
    const writer = slowWriter(VALID);
    const { server, fake } = start({ recommender: writer.fn });
    const bodies = await Promise.all([get(server, "paser"), get(server, "paser"), get(server, "paser")].map(async (r) => (await r).json()));
    expect(writer.counts.started).toBe(1);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(fake.stored.has("recommendations:paser")).toBe(true);
    // Different regions still run on their own.
    await Promise.all([get(server, "berau"), get(server, "bontang")]);
    expect(writer.counts.started).toBe(3);
  });

  test.each(["nope", "SAMARINDA", "kukar"])("unknown region id %p returns a 404 json error", async (id) => {
    const writer = fakeWriter(VALID);
    const { server } = start({ recommender: writer.fn });
    const res = await get(server, id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(writer.calls).toHaveLength(0);
  });
});

describe("recommendation routes", () => {
  // Bun closes a connection after 10 s without a byte written, and a Claude answer takes longer.
  test.each([
    ["/api/recommendations/:regionId", "GET"],
    ["/api/recommendations/:regionId/refresh", "POST"],
  ] as const)("%s %s raises the idle timeout above the generation budget", async (path, method) => {
    const timeouts: number[] = [];
    const server = { timeout: (_req: Request, seconds: number) => void timeouts.push(seconds) };
    const handler = (recommendationRoutes(fakeDeps().deps)[path] as Partial<Record<"GET" | "POST", Handler>>)[method]!;
    const req = Object.assign(new Request(`http://x/api/recommendations/nope`, { method }), { params: { regionId: "nope" } });
    const res = await handler(req as unknown as Parameters<Handler>[0], server as unknown as Parameters<Handler>[1]);
    expect(res.status).toBe(404);
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]! * 1000).toBeGreaterThan(GENERATION_BUDGET_MS);
    expect(timeouts[0]).toBeLessThanOrEqual(255);
  });
});

describe("POST /api/recommendations/:regionId/refresh", () => {
  const NEW: RecommendationItem[] = VALID.map((i) => ({ ...i, title: `${i.title} (baru)` }));

  test("regenerates and stores new content even when a copy is cached", async () => {
    const writer = fakeWriter(NEW);
    const { server, fake } = start({ recommender: writer.fn });
    await fake.deps.db.recommendationsSet("samarinda", VALID, "old-model");

    const res = await refresh(server, "samarinda");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Recommendations;
    expect(body.items).toEqual(NEW);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(writer.calls).toHaveLength(1);
    expect(((await (await get(server, "samarinda")).json()) as Recommendations).items).toEqual(NEW);
  });

  test("a Claude failure keeps and returns the cached content", async () => {
    const writer = fakeWriter(new Error("anthropic down"));
    const { server, fake } = start({ recommender: writer.fn });
    const at = await fake.deps.db.recommendationsSet("samarinda", VALID, "old-model");

    const body = (await (await refresh(server, "samarinda")).json()) as Recommendations;
    expect(body).toEqual({ regionId: "samarinda", items: VALID, model: "old-model", generatedAt: at.toISOString() });
    expect(writer.calls).toHaveLength(1);
  });

  test("repeated refreshes share one Claude call", async () => {
    const writer = slowWriter(NEW);
    const { server, fake } = start({ recommender: writer.fn });
    await fake.deps.db.recommendationsSet("samarinda", VALID, "old-model");
    const bodies = await Promise.all([refresh(server, "samarinda"), refresh(server, "samarinda")].map(async (r) => (await r).json()));
    expect(writer.counts.started).toBe(1);
    expect((bodies[0] as Recommendations).items).toEqual(NEW);
    expect(bodies[1]).toEqual(bodies[0]);
    // Once it has finished, a new refresh asks Claude again.
    await refresh(server, "samarinda");
    expect(writer.counts.started).toBe(2);
  });

  test("a refresh while NASA POWER is down keeps the cached copy and does not call Claude", async () => {
    const writer = fakeWriter(NEW);
    const { server, fake } = start({ recommender: writer.fn, nasa: new Error("nasa down") });
    const at = await fake.deps.db.recommendationsSet("samarinda", VALID, "old-model");
    const body = (await (await refresh(server, "samarinda")).json()) as Recommendations;
    expect(body).toEqual({ regionId: "samarinda", items: VALID, model: "old-model", generatedAt: at.toISOString() });
    expect(writer.calls).toHaveLength(0);
  });

  test("a Claude failure with nothing cached gives rule-based items", async () => {
    const writer = fakeWriter(new Error("anthropic down"));
    const { server } = start({ recommender: writer.fn });
    const body = (await (await refresh(server, "paser")).json()) as Recommendations;
    expect(body.model).toBeNull();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  test("an unknown region returns a 404 json error", async () => {
    const writer = fakeWriter(VALID);
    const { server } = start({ recommender: writer.fn });
    const res = await refresh(server, "nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(writer.calls).toHaveLength(0);
  });
});

describe("createClaudeRecommender", () => {
  test("sends one claude-sonnet-5-5 request with a strict tool, auto tool choice and the region's facts", async () => {
    const claude = claudeFetch(messageJson([{ type: "thinking", thinking: "", signature: "sig" }, toolUse({ items: VALID })]));
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });

    expect(await write(facts("kutai-kartanegara"))).toEqual({ items: VALID, model: "claude-sonnet-5-5" });
    expect(claude.requests).toHaveLength(1);
    const { url, body } = claude.requests[0]!;
    expect(new URL(url).pathname).toBe("/v1/messages");
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(2048);
    // Forced tool_choice is rejected by this model, so the call is steered by the prompt.
    expect(body.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    const tools = body.tools as { name: string; strict: boolean; input_schema: unknown }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("save_recommendations");
    expect(tools[0]?.strict).toBe(true);
    const schema = JSON.stringify(tools[0]?.input_schema);
    for (const c of CATEGORIES) expect(schema).toContain(c);
    const system = JSON.stringify(body.system);
    expect(system).toContain("save_recommendations");
    expect(system).toContain("perkiraan");
    const user = JSON.stringify(body.messages);
    expect(user).toContain("Kabupaten Kutai Kartanegara");
    expect(user).toContain("89,32%");
  });

  test("rejects a reply without the tool call", async () => {
    const claude = claudeFetch(messageJson([{ type: "text", text: "Berikut rekomendasinya.", citations: null }], "end_turn"));
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });
    await expect(write(facts("samarinda"))).rejects.toThrow(/end_turn/);
  });

  test("rejects a reply cut off at max_tokens", async () => {
    const claude = claudeFetch(messageJson([toolUse({ items: VALID })], "max_tokens"));
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });
    await expect(write(facts("samarinda"))).rejects.toThrow(/max_tokens/);
  });

  test("rejects a refusal", async () => {
    const claude = claudeFetch(messageJson([], "refusal"));
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });
    await expect(write(facts("samarinda"))).rejects.toThrow(/refusal/);
  });

  test("rejects items that fail validation", async () => {
    const claude = claudeFetch(messageJson([toolUse({ items: VALID.slice(0, 2) })]));
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });
    await expect(write(facts("samarinda"))).rejects.toThrow(/validation/);
  });

  test("passes API errors through", async () => {
    const claude = claudeFetch({ type: "error", error: { type: "api_error", message: "boom" } }, 500);
    const write = createClaudeRecommender("test-key", { fetch: claude.fetcher, maxRetries: 0 });
    await expect(write(facts("samarinda"))).rejects.toThrow();
    expect(claude.requests).toHaveLength(1);
  });

  test("gives up once the generation budget is spent, retries included", async () => {
    const hangs = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    const write = createClaudeRecommender("test-key", { fetch: hangs, budgetMs: 50 });
    const started = Date.now();
    await expect(write(facts("samarinda"))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("SYSTEM_PROMPT", () => {
  test("names every exception to the kWh split by customers", () => {
    expect(SYSTEM_PROMPT).toContain("angka Samarinda dari tabel BPS Kota Samarinda");
    expect(SYSTEM_PROMPT).toContain("Mahakam Ulu dihitung dari asumsi 1.500 kWh per pelanggan");
    expect(SYSTEM_PROMPT).toContain("Kutai Kartanegara dibagi ke tiga cabang");
    expect(SYSTEM_PROMPT).toContain("Berau mendapat 78%");
  });

  test("forbids invented scenarios and keeps impacts on per-kWh and per-kWp units", () => {
    expect(SYSTEM_PROMPT).toContain("skenario");
    expect(SYSTEM_PROMPT).toContain("per kWh yang dihemat atau per 1 kWp yang dipasang");
    expect(SYSTEM_PROMPT).toContain("Dasar hitungan dampak harus sesuai dengan tindakannya");
    expect(SYSTEM_PROMPT).toContain("jangan dipakai untuk PLTS komunal di desa yang belum berlistrik");
    expect(SYSTEM_PROMPT).toContain("dalam poin persentase");
  });

  test("asks for labelled averages, no growth forecasts, matching verbs, real actions and qualified absences", () => {
    expect(SYSTEM_PROMPT).toContain("termasuk rata-rata");
    expect(SYSTEM_PROMPT).toContain("Jangan meramalkan pertumbuhan");
    expect(SYSTEM_PROMPT).toContain("judulnya juga memakai \"Usulkan\" atau \"Ajukan\"");
    expect(SYSTEM_PROMPT).toContain("hanya berisi koordinasi atau pemutakhiran data");
    expect(SYSTEM_PROMPT).toContain("dalam data kami");
    expect(SYSTEM_PROMPT).toContain('jangan menulis "Dataan"');
  });

  test("bans outcome claims, asks for a complete plant list and labels mix shares and rupiah figures", () => {
    expect(SYSTEM_PROMPT).toContain("Jangan menulis hasil atau peringkat yang akan dicapai");
    expect(SYSTEM_PROMPT).toContain("mengangkat dari posisi terendah");
    expect(SYSTEM_PROMPT).toContain("Uraikan daftar pembangkit dengan lengkap");
    expect(SYSTEM_PROMPT).toContain('Jangan menulis "satu-satunya"');
    expect(SYSTEM_PROMPT).toContain("persentase bauran listrik, dan nilai rupiah hasil hitungan");
  });
});

describe("parseRecommendationItems", () => {
  test("accepts 3 to 6 items, trims the text and orders them by priority", () => {
    const messy = [{ ...VALID[2]!, title: "  Masukkan potensi surya ke RTRW \n" }, VALID[0]!, VALID[1]!];
    expect(parseRecommendationItems(messy)).toEqual(VALID);
    const six = [...VALID, ...VALID];
    expect(parseRecommendationItems(six)).toHaveLength(6);
  });

  test("keeps only the known fields", () => {
    const extra = VALID.map((i) => ({ ...i, note: "x" }));
    expect(parseRecommendationItems(extra)).toEqual(VALID);
  });

  test.each([
    ["two items", VALID.slice(0, 2)],
    ["seven items", [...VALID, ...VALID, VALID[0]]],
    ["an unknown category", [...VALID.slice(0, 2), { ...VALID[2], category: "lainnya" }]],
    ["priority 4", [...VALID.slice(0, 2), { ...VALID[2], priority: 4 }]],
    ["priority as text", [...VALID.slice(0, 2), { ...VALID[2], priority: "1" }]],
    ["an empty title", [...VALID.slice(0, 2), { ...VALID[2], title: "" }]],
    ["a blank body", [...VALID.slice(0, 2), { ...VALID[2], body: "  \n " }]],
    ["a missing impact", [...VALID.slice(0, 2), { ...VALID[2], impact: undefined }]],
    ["an item that is not an object", [...VALID.slice(0, 2), "teks"]],
    ["an object instead of a list", { items: VALID }],
    ["null", null],
  ])("rejects %s", (_name, list) => {
    expect(parseRecommendationItems(list)).toBeNull();
  });
});

describe("buildRegionFacts", () => {
  test("compares the region with all kabupaten/kota", () => {
    const f = facts("kutai-kartanegara");
    const totalKwh = REGIONS.reduce((a, r) => a + r.kwhYear, 0);
    const comparable = REGIONS.filter((r) => r.id !== "penajam-paser-utara");
    const comparableKwh = comparable.reduce((a, r) => a + r.kwhYear, 0);
    const comparablePeople = comparable.reduce((a, r) => a + (r.population ?? 0), 0);
    expect(f.region.name).toBe("Kutai Kartanegara");
    expect(f.comparison.regionCount).toBe(10);
    expect(f.comparison.kwhRank).toBe(2);
    expect(f.comparison.kwhSharePct).toBeCloseTo((1_195_500_000 / totalKwh) * 100, 9);
    expect(f.comparison.kwhPerCapita).toBeCloseTo(1_195_500_000 / 845_620, 9);
    expect(f.comparison.kwhPerCapitaAll).toBeCloseTo(comparableKwh / comparablePeople, 9);
    expect(f.comparison.kwhPerCapitaCount).toBe(9);
    expect(f.comparison.kwhPerCapitaRank).toBe(3);
    expect(f.comparison.kwhPerCapitaVsAll).toBe("above");
    expect(f.comparison.kwhPerCustomer).toBeCloseTo(1_195_500_000 / 245_946, 9);
    // 100, 99.62, 94.82, 94.43, 92.83, 92.31, 89.58, then Kutai Kartanegara at 89.32.
    expect(f.comparison.electrificationRank).toBe(8);
    expect(facts("samarinda").comparison.electrificationRank).toBe(1);
  });

  test("prices one kWp of rooftop PV on a government office from its self-use, as the Surya tab does", () => {
    const { solar } = facts("samarinda");
    const yieldKwh = 4.68 * 365 * 0.78;
    expect(solar.kwhPerKwpYear).toBeCloseTo(yieldKwh, 9);
    expect(solar.costRpPerKwp).toBe(15_000_000);
    expect(solar.govTariffRpPerKwh).toBe(1699.53);
    expect(solar.solarFactorKgPerKwh).toBe(1.13);
    expect(solar.openDaysPerYear).toBe(250);
    expect(solar.daytimeSharePct).toBeCloseTo(85, 9);
    // Open 250 days, 85% by day: about 72% of the output is used on site, the rest earns nothing.
    expect(solar.selfUsePct).toBeGreaterThan(70);
    expect(solar.selfUsePct).toBeLessThan(75);
    const selfUseKwh = (yieldKwh * solar.selfUsePct) / 100;
    expect(solar.savingRpPerKwpYear).toBeCloseTo(selfUseKwh * 1699.53, 3);
    expect(solar.co2AvoidedKgPerKwpYear).toBeCloseTo(selfUseKwh * 1.13, 6);
    expect(solar.paybackYears).toBeCloseTo(15_000_000 / solar.savingRpPerKwpYear, 9);
    // Not the old "every kWh used" figure (6,6 years at this sun).
    expect(solar.paybackYears).toBeGreaterThan(9);
  });

  test("the region card and the Surya tab give the same payback for the same government office", async () => {
    const nasa = { pshByMonth: Array<number>(12).fill(4.6), pshYear: 4.6 };
    const { server } = start({ nasa });
    const res = await fetch(new URL("/api/solar/simulate", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: -0.5, lng: 117.15, ...REFERENCE_GOV_OFFICE }),
    });
    const tab = (await res.json()) as SolarSimulation;
    const card = facts("samarinda", { climate: nasa }).solar;
    expect(card.paybackYears).toBe(tab.paybackYears);
    expect(card.paybackYears).toBe(tab.paybackPanelYears);
    expect(card.savingRpPerKwpYear).toBeCloseTo(tab.savingRpYear / tab.kWp, 6);
    expect(card.co2AvoidedKgPerKwpYear).toBeCloseTo(tab.co2AvoidedKgYear / tab.kWp, 6);
    // The reviewer's case: about 9,3 years at 4,6 sun hours, and the card text says so.
    expect(dec(card.paybackYears, 1)).toBe("9,3");
    const pv = ruleBasedRecommendations(facts("samarinda", { climate: nasa })).find((i) => i.category === "energi_terbarukan");
    expect(pv?.impact).toContain("balik modal sekitar 9,3 tahun tanpa baterai");
    expect(describeRegionFacts(facts("samarinda", { climate: nasa }))).toContain("balik modal sekitar 9,3 tahun tanpa baterai");
  });

  test("leaves PPU, whose projected population includes IKN, out of the per-person average and ranks", () => {
    // 1.264 kWh per person with PPU, 1.333 without; Balikpapan (1.334) is then level with the average.
    const avg = facts("balikpapan").comparison.kwhPerCapitaAll!;
    expect(avg).toBeGreaterThan(1333);
    expect(avg).toBeLessThan(1334);
    expect(facts("balikpapan").comparison.kwhPerCapitaVsAll).toBe("similar");
    expect(facts("paser").comparison.kwhPerCapitaVsAll).toBe("below");
    const ppu = facts("penajam-paser-utara").comparison;
    expect(ppu.kwhPerCapitaComparable).toBe(false);
    expect(ppu.kwhPerCapitaRank).toBeNull();
    expect(ppu.kwhPerCapitaVsAll).toBeNull();
    // Mahakam Ulu is last of the 9 comparable regions, not of 10.
    expect(facts("mahakam-ulu").comparison.kwhPerCapitaRank).toBe(9);
  });

  test("returns null for an unknown region", () => {
    expect(buildRegionFacts({ regionId: "nope", regions: REGIONS, plants: [], climate: CLIMATE, grid: GRID })).toBeNull();
  });

  test("leaves per-person figures empty without a population", () => {
    const regions = REGIONS.map((r) => (r.id === "paser" ? { ...r, population: null, customers: null, electrificationPct: null } : r));
    const f = buildRegionFacts({ regionId: "paser", regions, plants: [], climate: CLIMATE, grid: GRID })!;
    expect(f.comparison.kwhPerCapita).toBeNull();
    expect(f.comparison.kwhPerCapitaRank).toBeNull();
    expect(f.comparison.kwhPerCustomer).toBeNull();
    expect(f.comparison.electrificationRank).toBeNull();
    expect(Number.isFinite(f.comparison.kwhPerCapitaAll ?? Number.NaN)).toBe(true);
  });
});

describe("describeRegionFacts", () => {
  test("states the region's figures in id-ID format, with estimates labelled", () => {
    const text = describeRegionFacts(facts("kutai-kartanegara"));
    expect(text).toContain("Kabupaten Kutai Kartanegara");
    expect(text).toContain("1,20 miliar kWh (perkiraan)");
    expect(text).toContain("terbesar kedua dari 10 kabupaten/kota");
    expect(text).toContain("1,4 juta ton CO2 per tahun (perkiraan)");
    expect(text).toContain("845.620 jiwa");
    expect(text).toContain("245.946");
    expect(text).toContain("89,32%, terendah ketiga dari 10 kabupaten/kota");
    expect(text).toContain("Desa yang belum mendapat listrik PLN: tidak tersedia");
    expect(text).toContain("batu bara 66%");
    expect(text).toContain("1,14 kg CO2 per kWh");
    expect(text).toContain("4,7 jam puncak matahari per hari");
    expect(text).toContain("terendah 4,3 (Juni)");
    expect(text).toContain("tertinggi 5,1 (September)");
    expect(text).toContain("1.332 kWh per tahun (perkiraan)");
    expect(text).toContain("Rp 1.699,53 per kWh");
    expect(text).toContain("% listrik panel dipakai sendiri (perkiraan)");
    expect(text).toContain("faktor emisi PLTS 1,13 kg CO2 per kWh");
  });

  test("names a kota as Kota and gives the village count when it is known", () => {
    expect(describeRegionFacts(facts("samarinda"))).toContain("Kota Samarinda");
    expect(describeRegionFacts(facts("mahakam-ulu"))).toContain("Desa yang belum mendapat listrik PLN: 11");
  });

  test("puts ranks in words at the top and bottom, and as a position in between", () => {
    const samarinda = describeRegionFacts(facts("samarinda"));
    expect(samarinda).toContain("terbesar dari 10 kabupaten/kota");
    expect(samarinda).toContain("100%, tertinggi dari 10 kabupaten/kota");
    expect(describeRegionFacts(facts("mahakam-ulu"))).toContain("87,41%, terendah dari 10 kabupaten/kota");
    expect(describeRegionFacts(facts("penajam-paser-utara"))).toContain(
      "92,83%, urutan ke-5 dari 10 kabupaten/kota bila diurutkan dari yang tertinggi",
    );
  });

  test("lists the plants with capacity, status and guessed locations", () => {
    const text = describeRegionFacts(facts("kutai-kartanegara", { plants: PLANTS }));
    expect(text).toContain("AlamTri captive coal power station: batu bara, 2.200 MW, status tidak diketahui, lokasi perkiraan");
    expect(text).toContain("PLTGU Tanjung Batu: gas, 60 MW, beroperasi");
    expect(text).toContain("snippet, captive, not PLN grid");
  });

  test("says when no listed plant lies in the region, without claiming there is none", () => {
    const text = describeRegionFacts(facts("mahakam-ulu"));
    expect(text).toContain("Dalam data kami, tidak ada pembangkit utama");
    expect(text).toContain("tidak memuat PLTD");
  });

  test("names the regions left out of the per-person average, and calls a near-equal figure level with it", () => {
    const text = describeRegionFacts(facts("balikpapan"));
    expect(text).toContain("rata-rata 9 kabupaten/kota 1.333 kWh (perkiraan; tanpa Penajam Paser Utara");
    expect(text).toContain("setara dengan rata-rata");
    expect(text).not.toContain("di atas rata-rata");
    expect(describeRegionFacts(facts("kutai-barat"))).toContain("di atas rata-rata");
    expect(describeRegionFacts(facts("penajam-paser-utara"))).toContain("tidak layak dibandingkan");
  });

  test("flags the solar assumption when NASA POWER was unavailable", () => {
    const climate = { pshByMonth: Array<number>(12).fill(4.2), pshYear: 4.2, fallback: "NASA POWER down" };
    const text = describeRegionFacts(facts("samarinda", { climate }));
    expect(text).toContain("asumsi 4,2 jam puncak matahari per hari");
    expect(text).not.toContain("terendah");
  });
});

describe("ruleBasedRecommendations", () => {
  test("every region gets 3 to 6 valid items, and together they use every category", () => {
    const seen = new Set<string>();
    for (const r of REGIONS) {
      const items = ruleBasedRecommendations(facts(r.id));
      expect(parseRecommendationItems(items)).toEqual(items);
      for (const i of items) seen.add(i.category);
    }
    expect([...seen].sort()).toEqual(CATEGORIES);
  });

  test("villages without PLN lead to communal PV, first in line", () => {
    const items = ruleBasedRecommendations(facts("mahakam-ulu"));
    const communal = items.find((i) => i.title.includes("PLTS komunal"));
    expect(communal?.category).toBe("akses_listrik");
    expect(communal?.priority).toBe(1);
    expect(communal?.body).toContain("11 desa");
    expect(communal?.body).toContain("belum terverifikasi");
    expect(communal?.impact).not.toContain("tanpa menunggu");
    expect(items[0]?.priority).toBe(1);
  });

  test("a low electrification ratio leads to an access item quoting the BPS figure", () => {
    const items = ruleBasedRecommendations(facts("kutai-kartanegara"));
    const access = items.find((i) => i.category === "akses_listrik");
    expect(access?.body).toContain("89,32% (BPS 2024), terendah ketiga dari 10 kabupaten/kota");
    // Connecting homes is PLN's job: the region proposes it, it does not do it.
    expect(access?.title).toContain("usulkan penyambungan");
    expect(access?.title).not.toContain("sambungkan");
    // Prompt rule 9 bans outcome claims, so the fallback text states the current gap and promises nothing.
    expect(access?.impact).toContain("Selisih rasio elektrifikasi ke 100% saat ini");
    expect(access?.impact).not.toContain("Menutup");
    expect(access?.body).toContain("Dinas ESDM Provinsi Kalimantan Timur");
    expect(access?.priority).toBe(1);
    expect(ruleBasedRecommendations(facts("samarinda")).some((i) => i.category === "akses_listrik")).toBe(false);
  });

  test("the coal-heavy grid leads to rooftop PV on government buildings with grounded numbers", () => {
    const pv = ruleBasedRecommendations(facts("samarinda")).find((i) => i.category === "energi_terbarukan");
    expect(pv?.title).toContain("PLTS atap");
    expect(pv?.title).toContain("pemerintah");
    expect(pv?.body.startsWith("Batu bara menyumbang 66% listrik Kalimantan Timur")).toBe(true);
    expect(pv?.body).toContain("1.332 kWh");
    expect(`${pv?.body} ${pv?.impact}`).toContain("perkiraan");
  });

  test("the coal share sets the rooftop PV priority", () => {
    const pv = (f: RegionFacts) => ruleBasedRecommendations(f).find((i) => i.category === "energi_terbarukan");
    // Samarinda uses a quarter of Kaltim's electricity; Berau uses a few percent.
    expect(pv(facts("samarinda"))?.priority).toBe(1);
    expect(pv(facts("berau"))?.priority).toBe(2);
    const grid: GridMix = { ...GRID, shares: { ...GRID.shares, batubara: 0.3, gas: 0.61 } };
    expect(pv(facts("samarinda", { grid }))?.priority).toBe(3);
    expect(ruleBasedRecommendations(facts("samarinda", { grid })).length).toBeGreaterThanOrEqual(3);
  });

  test("use per person above the Kaltim figure leads to an efficiency item", () => {
    expect(ruleBasedRecommendations(facts("kutai-barat")).some((i) => i.category === "efisiensi")).toBe(true);
    expect(ruleBasedRecommendations(facts("paser")).some((i) => i.category === "efisiensi")).toBe(false);
    // Level with the average once PPU is left out: no efficiency item from the rules.
    expect(ruleBasedRecommendations(facts("balikpapan")).some((i) => i.category === "efisiensi")).toBe(false);
  });

  test("every text that quotes an estimated quantity says perkiraan", () => {
    // Published figures, not estimates: the government tariff and the official grid factor.
    const published = /Rp 1\.699,53|1,14 kg CO2/g;
    const estimate = /\d(\s(ribu|juta|miliar))?\s?(kWh|ton|tahun)\b|Rp \d/;
    for (const r of REGIONS) {
      for (const i of ruleBasedRecommendations(facts(r.id))) {
        for (const text of [i.body, i.impact]) {
          if (estimate.test(text.replace(published, ""))) expect(`${r.id}: ${text}`).toContain("perkiraan");
        }
      }
    }
  });
});

describe("warmCaches", () => {
  const silent = () => {};

  test("without an API key it warms the climatology of every region and skips the AI", async () => {
    const fake = fakeDeps();
    const summary = await warmCaches(fake.deps, silent);
    expect(summary.regions).toBe(10);
    expect(summary.climateStored).toBe(10);
    expect(summary.aiSkipped).toBe(true);
    expect(summary.aiStored).toBe(0);
    expect(fake.nasaCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("with a key it stores recommendations for every region, and a second run changes nothing", async () => {
    const writer = fakeWriter(VALID);
    const fake = fakeDeps(null, { recommender: writer.fn });
    const lines: string[] = [];
    const first = await warmCaches(fake.deps, (l) => lines.push(l));
    expect(first.aiCreated).toBe(10);
    expect(first.aiStored).toBe(10);
    expect(first.failures).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);

    const nasaBefore = fake.nasaCalls.length;
    const second = await warmCaches(fake.deps, silent);
    expect(second.aiCreated).toBe(0);
    expect(second.aiStored).toBe(10);
    expect(writer.calls).toHaveLength(10);
    expect(fake.nasaCalls.length).toBe(nasaBefore);
  });

  test("a NASA POWER failure skips the AI for that region and is reported, not thrown", async () => {
    const writer = fakeWriter(VALID);
    const fake = fakeDeps(null, { recommender: writer.fn, nasa: new Error("nasa down") });
    const summary = await warmCaches(fake.deps, silent);
    expect(summary.climateStored).toBe(0);
    expect(summary.aiStored).toBe(0);
    expect(writer.calls).toHaveLength(0);
    expect(summary.failures.length).toBeGreaterThan(0);
  });

  test("a Claude failure is reported, not thrown", async () => {
    const writer = fakeWriter(new Error("anthropic down"));
    const fake = fakeDeps(null, { recommender: writer.fn });
    const summary = await warmCaches(fake.deps, silent);
    expect(summary.aiStored).toBe(0);
    expect(summary.failures.length).toBeGreaterThan(0);
  });

  test("with refresh it regenerates every region, and a failed refresh keeps the old copy", async () => {
    const writer = fakeWriter(VALID);
    const fake = fakeDeps(null, { recommender: writer.fn });
    await warmCaches(fake.deps, silent);
    const again = await warmCaches(fake.deps, silent, { refresh: true });
    expect(again.aiCreated).toBe(10);
    expect(writer.calls).toHaveLength(20);

    fake.deps.recommender = fakeWriter(new Error("anthropic down")).fn;
    const failed = await warmCaches(fake.deps, silent, { refresh: true });
    expect(failed.aiCreated).toBe(0);
    expect(failed.aiStored).toBe(10);
    expect(failed.failures).toHaveLength(10);
  });

  test("a database failure is thrown only after the other workers have finished", async () => {
    const writer = slowWriter(VALID);
    const fake = fakeDeps(null, { recommender: writer.fn });
    const labelPoint = fake.deps.db.regionLabelPoint;
    fake.deps.db.regionLabelPoint = async (id) => {
      if (id === "bontang") throw new Error("db down");
      return labelPoint(id);
    };
    await expect(warmCaches(fake.deps, silent)).rejects.toThrow(/db down/);
    expect(writer.counts.finished).toBe(writer.counts.started);
  });

  test("a database failure is thrown", async () => {
    const fake = fakeDeps();
    fake.deps.db.listRegions = async () => {
      throw new Error("db down");
    };
    await expect(warmCaches(fake.deps, silent)).rejects.toThrow(/db down/);
  });

  test("a recommendation that was written but not stored counts as a database failure", async () => {
    const writer = fakeWriter(VALID);
    const fake = fakeDeps(null, { recommender: writer.fn });
    fake.deps.db.recommendationsSet = async () => {
      throw new Error("write failed");
    };
    await expect(warmCaches(fake.deps, silent)).rejects.toThrow();
  });
});
