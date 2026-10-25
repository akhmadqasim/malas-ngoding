import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { eventStream } from "../../src/server/routes/chat.ts";
import type { PlaceHit } from "../../src/server/services/chatTools/placeSearch.ts";
import {
  CHAT_MAX_ITERATIONS,
  CHAT_MAX_TOKENS,
  CHAT_MODEL,
  type ChatModel,
  type ChatModelStream,
  LAST_CALL_NOTICE,
  createChatModel,
  runChat,
} from "../../src/server/services/claude.ts";
import type { PoiHit } from "../../src/server/services/tilequery.ts";
import { fmtKwh, fmtNumber, fmtRupiah } from "../../src/shared/format.ts";
import { dayAgainstClearSky, dropSentence, pvFromForecast, summariseDays } from "../../src/shared/pvForecast.ts";
import type { ForecastHour } from "../../src/shared/pvForecast.ts";
import type { BuildingEstimate } from "../../src/shared/types.ts";
import { dayRows } from "../../src/web/panels/solarWeather.ts";
import { type FakeDeps, type FakeUpstreams, fakeDeps } from "./fakes.ts";

const SESSION = "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b";
const CONTEXT = { selectedRegionId: null, selectedBuilding: null, view: { center: [117.15, -0.5], zoom: 9 } };
const SCHOOL: PoiHit = { class: "education", type: "School", name: "SMA 1", distanceM: 6 };
const BUILDING: BuildingEstimate = {
  featureId: "b1",
  type: "sekolah",
  typeSource: "poi",
  floors: 2,
  floorAreaM2: 800,
  kwhYear: 145_600,
  kwhMonth: 12_133.3,
  co2KgYear: 165_984,
  bySource: [],
  equivalents: [],
  region: { id: "samarinda", name: "Samarinda" },
  assumptions: ["Tinggi bangunan tidak ada di data peta, dipakai jumlah lantai umum: 2 lantai."],
};
const TOOL_NAMES = [
  "list_regions",
  "get_region_stats",
  "get_grid_mix",
  "get_recommendations",
  "estimate_building_at",
  "simulate_solar",
  "get_weather",
  "find_places",
  "fly_to_region",
  "show_all_regions",
  "fly_to",
  "select_building_at",
  "toggle_layer",
  "set_metric",
  "set_rain",
  "open_tab",
];

// ---------- a fake Claude that streams scripted replies the way the SDK does ----------

interface ToolCall {
  name: string;
  input: unknown;
}
/** One scripted reply. A bare Error is thrown before anything streams; `fail` is thrown after the text. */
type Turn =
  | { text?: string; tools?: ToolCall[]; thinking?: boolean; stop?: Anthropic.StopReason; fail?: Error }
  | Error;

interface FakeModel {
  model: ChatModel;
  /** Request params of every call, copied when the call was made. */
  calls: Anthropic.MessageStreamParams[];
  signals: AbortSignal[];
}

const textDelta = (text: string): Anthropic.MessageStreamEvent => ({
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text },
});

function replay(turn: Turn, n: number): ChatModelStream {
  if (turn instanceof Error) {
    return {
      async *[Symbol.asyncIterator]() {
        throw turn;
      },
      finalMessage: () => Promise.reject(turn),
    };
  }
  const tools = turn.tools ?? [];
  const content: unknown[] = [];
  if (turn.thinking) content.push({ type: "thinking", thinking: "", signature: `sig_${n}` });
  if (turn.text) content.push({ type: "text", text: turn.text, citations: null });
  tools.forEach((t, i) =>
    content.push({ type: "tool_use", id: `toolu_${n}_${i}`, name: t.name, input: t.input, caller: { type: "direct" } }),
  );
  const message = {
    id: `msg_${n}`,
    type: "message",
    role: "assistant",
    model: CHAT_MODEL,
    content,
    stop_reason: turn.stop ?? (tools.length > 0 ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as Anthropic.Message;
  const text = turn.text ?? "";
  return {
    async *[Symbol.asyncIterator]() {
      // Two deltas, so the answer really streams.
      const cut = Math.ceil(text.length / 2);
      for (const part of [text.slice(0, cut), text.slice(cut)]) if (part) yield textDelta(part);
      if (turn.fail) throw turn.fail;
      for (const [i, t] of tools.entries()) {
        yield {
          type: "content_block_start",
          index: i + 1,
          content_block: { type: "tool_use", id: `toolu_${n}_${i}`, name: t.name, input: {}, caller: { type: "direct" } },
        } as Anthropic.MessageStreamEvent;
        yield { type: "content_block_delta", index: i + 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(t.input) } };
      }
    },
    finalMessage: async () => message,
  };
}

function fakeModel(script: Turn[] | ((call: number) => Turn)): FakeModel {
  const calls: Anthropic.MessageStreamParams[] = [];
  const signals: AbortSignal[] = [];
  const model: ChatModel = (params, { signal }) => {
    calls.push(structuredClone(params));
    signals.push(signal);
    const n = calls.length;
    return replay(typeof script === "function" ? script(n) : (script[n - 1] ?? { text: "" }), n);
  };
  return { model, calls, signals };
}

/** A model whose stream hangs after `before` until its signal aborts. */
function hangingModel(before: string[] = []): FakeModel {
  const calls: Anthropic.MessageStreamParams[] = [];
  const signals: AbortSignal[] = [];
  const model: ChatModel = (params, { signal }) => {
    calls.push(structuredClone(params));
    signals.push(signal);
    return {
      async *[Symbol.asyncIterator]() {
        for (const text of before) yield textDelta(text);
        await new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()), { once: true }),
        );
      },
      finalMessage: async () => {
        throw new Error("not reached");
      },
    };
  };
  return { model, calls, signals };
}

// ---------- server and SSE helpers ----------

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(upstreams: FakeUpstreams = {}, poi: PoiHit | null | Error = null): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps(poi, upstreams);
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const body = (message: string, context: unknown = CONTEXT, sessionId: unknown = SESSION) => ({ sessionId, message, context });

const post = (s: Server<undefined>, payload: unknown, signal?: AbortSignal) =>
  fetch(new URL("/api/chat", s.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal,
  });

interface Received {
  event: string;
  data: any;
}

function parseSse(text: string): Received[] {
  return text
    .split("\n\n")
    // Keep-alive comments (": ping") carry no event.
    .filter((chunk) => chunk.trim() !== "" && !chunk.startsWith(":"))
    .map((chunk) => {
      let event = "message";
      const data: string[] = [];
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data.push(line.slice(6));
      }
      return { event, data: JSON.parse(data.join("\n")) };
    });
}

async function chat(s: Server<undefined>, payload: unknown): Promise<Received[]> {
  const res = await post(s, payload);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  return parseSse(await res.text());
}

const eventNames = (events: Received[]) => events.map((e) => e.event);
const streamedText = (events: Received[]) =>
  events
    .filter((e) => e.event === "text")
    .map((e) => e.data.delta)
    .join("");
const actions = (events: Received[]) => events.filter((e) => e.event === "action").map((e) => e.data);

/** The tool_result blocks Claude received in the last user message of a call. */
function toolResults(params: Anthropic.MessageStreamParams | undefined): Anthropic.ToolResultBlockParam[] {
  const last = params?.messages.at(-1);
  if (!last || last.role !== "user" || typeof last.content === "string") return [];
  return last.content.filter((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result");
}
const resultJson = (r: Anthropic.ToolResultBlockParam | undefined): any =>
  JSON.parse(typeof r?.content === "string" ? r.content : "null");

/** Runs one server tool through the chat and returns what Claude got back. */
async function callTool(name: string, input: unknown, upstreams: FakeUpstreams = {}, poi: PoiHit | null | Error = null) {
  const model = fakeModel([{ tools: [{ name, input }] }, { text: "Selesai." }]);
  const { server, fake } = start({ ...upstreams, chat: model.model }, poi);
  const events = await chat(server, body("Tolong cek."));
  const [result] = toolResults(model.calls[1]);
  // Error results are plain text for Claude to read; only successful ones are JSON.
  return { events, result, json: result?.is_error ? null : resultJson(result), fake };
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await Bun.sleep(10);
}

/** Hourly forecast from today 00:00 WITA for two days; tomorrow has rain and dim sun from 12:00 to 15:00. */
/** Two days from today (WITA): dry and sunny, then 3 mm an hour at the hours `rainAt` counts from today's 00:00. */
function forecastFromToday(rainAt: (i: number) => boolean = (i) => i >= 36 && i < 39): ForecastHour[] {
  const witaMs = 8 * 3600_000;
  const today = new Date(Date.now() + witaMs).toISOString().slice(0, 10);
  const startMs = Date.parse(`${today}T00:00:00+08:00`);
  return Array.from({ length: 48 }, (_, i) => {
    const hour = i % 24;
    const rainy = rainAt(i);
    const sunny = hour >= 6 && hour < 18;
    return {
      time: new Date(startMs + i * 3600_000 + witaMs).toISOString().slice(0, 13) + ":00",
      ghiWm2: sunny ? (rainy ? 150 : 600) : 0,
      cloudPct: rainy ? 90 : 20,
      precipMm: rainy ? 3 : 0,
      weatherCode: rainy ? 63 : 1,
    };
  });
}

// ---------- tests ----------

describe("POST /api/chat", () => {
  let warn: ReturnType<typeof spyOn>;
  let logError: ReturnType<typeof spyOn>;
  // Failures are logged on purpose; keep the test output clean and assert on the logs where it matters.
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
    logError = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    logError.mockRestore();
  });

  test("streams the answer as text events, then done, using the model settings of the plan", async () => {
    const model = fakeModel([{ text: "Halo! Saya asisten energi Kaltim." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Halo"));

    expect(eventNames(events)).toEqual(["text", "text", "done"]);
    expect(streamedText(events)).toBe("Halo! Saya asisten energi Kaltim.");
    expect(events.at(-1)?.data).toEqual({});

    const params = model.calls[0]!;
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(2048);
    expect(CHAT_MAX_TOKENS).toBe(2048);
    expect(CHAT_MAX_ITERATIONS).toBe(8);
    expect(params.tool_choice).toBeUndefined();
    expect((params.tools ?? []).map((t) => ("name" in t ? t.name : t.type)).sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of params.tools ?? []) {
      expect("description" in tool && typeof tool.description === "string" && tool.description.length > 20).toBe(true);
    }
    expect(typeof params.system).toBe("string");
    expect(String(params.system)).toContain("Malas Ngoding");
    expect(String(params.system)).toContain("perkiraan");
  });

  test.each([
    ["Kukar", "kutai-kartanegara"],
    ["balikpapan", "balikpapan"],
    ["Kota Samarinda", "samarinda"],
  ])("fly_to_region with %p emits an action with region %p and answers Claude with ok", async (alias, id) => {
    const model = fakeModel([{ tools: [{ name: "fly_to_region", input: { region: alias } }] }, { text: "Ini wilayahnya." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body(`Tunjukkan ${alias}`));

    expect(eventNames(events)).toEqual(["action", "text", "text", "done"]);
    expect(actions(events)).toEqual([{ name: "fly_to_region", input: { region: id } }]);
    const [result] = toolResults(model.calls[1]);
    expect(result?.tool_use_id).toBe("toolu_1_0");
    expect(result?.is_error).toBeUndefined();
    expect(resultJson(result)).toEqual({ ok: true });
  });

  test("a region that cannot be resolved returns an error result to Claude and emits no action", async () => {
    const model = fakeModel([{ tools: [{ name: "fly_to_region", input: { region: "Jakarta" } }] }, { text: "Jakarta di luar Kaltim." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Tunjukkan Jakarta"));

    expect(actions(events)).toEqual([]);
    expect(eventNames(events).at(-1)).toBe("done");
    const [result] = toolResults(model.calls[1]);
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("Jakarta");
  });

  test("the tool loop stops after 8 model calls with done and no error", async () => {
    const model = fakeModel(() => ({ tools: [{ name: "set_metric", input: { metric: "kwh" } }] }));
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Ganti metrik terus"));

    expect(model.calls).toHaveLength(8);
    expect(eventNames(events)).not.toContain("error");
    expect(eventNames(events).at(-1)).toBe("done");
    // Only the last call ends with a system message telling Claude to answer with what it has.
    expect(model.calls.slice(0, 7).every((c) => c.messages.at(-1)?.role === "user")).toBe(true);
    expect(model.calls[7]?.messages.at(-1)).toEqual({ role: "system", content: LAST_CALL_NOTICE });
    expect(model.calls[7]?.messages.at(-2)?.role).toBe("user");
    expect(model.calls.every((c) => c.tool_choice === undefined)).toBe(true);
    // Tool calls of the 8th reply are not run.
    expect(actions(events)).toHaveLength(7);
    expect(streamedText(events).length).toBeGreaterThan(0);
  });

  test.each([
    ["a connection error", new Anthropic.APIConnectionError({ message: "Connection error." }), /terhubung/],
    ["a timeout", new Anthropic.APIConnectionTimeoutError(), /terlalu lama/],
    ["a rate limit", new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "slow" } }, undefined, new Headers()), /sibuk/],
    ["an overload", new Anthropic.InternalServerError(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers()), /sibuk/],
    ["a rejected key", new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers()), /kunci API/],
    ["an unknown error", new Error("boom"), /bermasalah/],
  ])("Anthropic throwing %s gives an Indonesian error event and ends the stream", async (_name, err, message) => {
    const model = fakeModel([err]);
    const { server, fake } = start({ chat: model.model });
    const events = await chat(server, body("Halo"));

    expect(eventNames(events)).toEqual(["error"]);
    expect(events[0]?.data.message).toMatch(message);
    expect(logError).toHaveBeenCalled();
    // The question is kept; there is no answer to keep.
    expect(fake.chatMessages.map((m) => m.role)).toEqual(["user"]);
  });

  test("an error halfway through an answer keeps the streamed text and ends with error, not done", async () => {
    const overloaded = new Anthropic.InternalServerError(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers());
    const model = fakeModel([{ text: "Sebentar, saya cek.", fail: overloaded }]);
    const { server, fake } = start({ chat: model.model });
    const events = await chat(server, body("Halo"));

    expect(eventNames(events)).toEqual(["text", "text", "error"]);
    expect(events.at(-1)?.data.message).toMatch(/sibuk/);
    expect(fake.chatMessages.map((m) => m.role)).toEqual(["user"]);
  });

  test("without an API key the chat answers with an Indonesian error instead of crashing", async () => {
    const { server } = start({ chat: createChatModel("") });
    const events = await chat(server, body("Halo"));
    expect(eventNames(events)).toEqual(["error"]);
    expect(events[0]?.data.message).toMatch(/kunci API/);
  });

  test("a refusal ends with an Indonesian error event", async () => {
    const model = fakeModel([{ stop: "refusal" }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Halo"));
    expect(eventNames(events)).toEqual(["error"]);
    expect(events[0]?.data.message).toMatch(/tidak bisa membantu/);
  });

  test("stores the question and the answer with its map actions, in a session created on first use", async () => {
    const model = fakeModel([
      { text: "Saya tunjukkan.", tools: [{ name: "fly_to_region", input: { region: "Kukar" } }] },
      { text: "Ini Kutai Kartanegara." },
    ]);
    const { server, fake } = start({ chat: model.model });
    await chat(server, body("  Tunjukkan Kukar  "));

    expect(fake.chatSessions.has(SESSION)).toBe(true);
    expect(fake.chatMessages).toEqual([
      { sessionId: SESSION, role: "user", content: { text: "Tunjukkan Kukar" } },
      {
        sessionId: SESSION,
        role: "assistant",
        content: {
          text: "Saya tunjukkan.\n\nIni Kutai Kartanegara.",
          actions: [{ name: "fly_to_region", input: { region: "kutai-kartanegara" } }],
        },
      },
    ]);
  });

  /** Runs one question after the given stored history and returns the messages sent to Claude. */
  async function sentAfter(history: { role: "user" | "assistant"; content: Record<string, unknown> }[]) {
    const model = fakeModel([{ text: "Baik." }]);
    const { server, fake } = start({ chat: model.model });
    fake.chatSessions.add(SESSION);
    for (const m of history) fake.chatMessages.push({ sessionId: SESSION, ...m });
    await chat(server, body("Pertanyaan baru"));
    return model.calls[0]!.messages;
  }
  const isQuestion = (m: Anthropic.MessageParam | undefined) =>
    m?.role === "user" && Array.isArray(m.content) && m.content.at(-1)?.type === "text";

  test("sends the last 20 messages as strict question and answer pairs", async () => {
    const history = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0
        ? { role: "user" as const, content: { text: `tanya ${i}` } }
        : // Message 9 has neither text nor actions: question 8 then has no answer.
          { role: "assistant" as const, content: { text: i === 9 ? "" : `jawab ${i}`, actions: [] } },
    );
    const model = fakeModel([{ text: "Baik." }]);
    const { server, fake } = start({ chat: model.model });
    fake.chatSessions.add(SESSION);
    for (const m of history) fake.chatMessages.push({ sessionId: SESSION, ...m });
    fake.chatMessages.push({ sessionId: "0b9c4d1e-2f3a-4b5c-8d6e-7f8091a2b3c4", role: "user", content: { text: "sesi lain" } });
    await chat(server, body("Pertanyaan baru"));

    const sent = model.calls[0]!.messages;
    // The last 20 are messages 5 to 24. Answer 5 has no question, question 8 no answer, and question 24 no
    // answer yet, so pairs 6/7 and 10/11 ... 22/23 remain, then the new question.
    expect(sent).toHaveLength(17);
    expect(sent[0]).toEqual({ role: "user", content: "tanya 6" });
    expect(sent[1]).toEqual({ role: "assistant", content: "jawab 7" });
    expect(sent[2]).toEqual({ role: "user", content: "tanya 10" });
    expect(sent.at(-2)).toEqual({ role: "assistant", content: "jawab 23" });
    sent.slice(0, -1).forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? "user" : "assistant"));
    expect(sent.some((m) => ["tanya 8", "tanya 24", "sesi lain"].includes(m.content as string))).toBe(false);
    expect(isQuestion(sent.at(-1))).toBe(true);
    expect((sent.at(-1)!.content as Anthropic.TextBlockParam[]).at(-1)).toEqual({ type: "text", text: "Pertanyaan baru" });
  });

  test("a history that ends with an unanswered question drops it, so the turns still alternate", async () => {
    const sent = await sentAfter([
      { role: "user", content: { text: "Berapa emisi Samarinda?" } },
      { role: "assistant", content: { text: "Sekitar 1,6 juta ton CO2 per tahun (perkiraan).", actions: [] } },
      { role: "user", content: { text: "Bagaimana dengan Berau?" } },
    ]);
    expect(sent).toHaveLength(3);
    expect(sent.slice(0, 2)).toEqual([
      { role: "user", content: "Berapa emisi Samarinda?" },
      { role: "assistant", content: "Sekitar 1,6 juta ton CO2 per tahun (perkiraan)." },
    ]);
    expect(isQuestion(sent[2])).toBe(true);
  });

  test("an answer that only moved the map is replayed as a short map note", async () => {
    const sent = await sentAfter([
      { role: "user", content: { text: "Tunjukkan Kukar dan sembunyikan pembangkit" } },
      {
        role: "assistant",
        content: {
          text: "",
          actions: [
            { name: "fly_to_region", input: { region: "kutai-kartanegara" } },
            { name: "toggle_layer", input: { layer: "plants", visible: false } },
          ],
        },
      },
    ]);
    expect(sent[1]).toEqual({ role: "assistant", content: "(peta: fly_to_region kutai-kartanegara; toggle_layer plants false)" });
    expect(sent).toHaveLength(3);
  });

  test("two answers in a row are merged into one turn", async () => {
    const sent = await sentAfter([
      { role: "user", content: { text: "Halo" } },
      { role: "assistant", content: { text: "Halo juga.", actions: [] } },
      { role: "assistant", content: { text: "Ada yang bisa dibantu?", actions: [] } },
    ]);
    expect(sent.slice(0, 2)).toEqual([
      { role: "user", content: "Halo" },
      { role: "assistant", content: "Halo juga.\n\nAda yang bisa dibantu?" },
    ]);
  });

  test("a reply that only moves the map still says something", async () => {
    const model = fakeModel([{ tools: [{ name: "fly_to_region", input: { region: "Kukar" } }] }, { text: "" }]);
    const { server, fake } = start({ chat: model.model });
    const events = await chat(server, body("Tunjukkan Kukar"));
    expect(eventNames(events)).toEqual(["action", "text", "done"]);
    expect(streamedText(events)).toBe("Sudah saya tampilkan di peta.");
    expect(fake.chatMessages.at(-1)?.content).toEqual({
      text: "Sudah saya tampilkan di peta.",
      actions: [{ name: "fly_to_region", input: { region: "kutai-kartanegara" } }],
    });
  });

  test("puts the app state in front of the question: time, view, region and the selected building", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const context = { selectedRegionId: "samarinda", selectedBuilding: BUILDING, view: { center: [117.15, -0.5], zoom: 17.5 } };
    await chat(server, body("Kalau gedung ini pakai panel surya?", context));

    const last = model.calls[0]!.messages.at(-1)!;
    expect(Array.isArray(last.content)).toBe(true);
    const blocks = last.content as Anthropic.TextBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: "text", text: "Kalau gedung ini pakai panel surya?" });
    const state = blocks[0]!.text;
    expect(state).toContain("WITA");
    expect(state).toContain("lng 117.15000, lat -0.50000, zoom 17.5");
    expect(state).toContain("samarinda");
    expect(state).toContain("sekolah");
    expect(state).toContain("2 lantai");
    expect(state).toContain("145.600 kWh");
    // Exact values for the tools: the roof is the footprint (floor area / floors) and the point is the map centre.
    expect(state).toContain('{"lat":-0.5,"lng":117.15,"roofAreaM2":400,"kwhYear":145600,"buildingType":"sekolah"}');
    expect(state).toContain("Tinggi bangunan tidak ada di data peta");
  });

  test("client-supplied assumptions reach the prompt as at most 5 texts of at most 200 characters", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const assumptions = Array.from({ length: 7 }, (_, i) => `asumsi${i} ${"x".repeat(250)}`);
    const context = { ...CONTEXT, selectedBuilding: { ...BUILDING, assumptions } };
    await chat(server, body("Halo", context));

    const state = (model.calls[0]!.messages.at(-1)!.content as Anthropic.TextBlockParam[])[0]!.text;
    for (let i = 0; i < 5; i++) {
      const head = `asumsi${i} `;
      // Cut at exactly 200 characters: 192 x's survive, the 193rd does not.
      expect(state).toContain(head + "x".repeat(200 - head.length));
      expect(state).not.toContain(head + "x".repeat(201 - head.length));
    }
    expect(state).not.toContain("asumsi5");
    expect(state).not.toContain("asumsi6");
  });

  test("the selected building's own point is used for the tool values when the app sends it", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const context = { ...CONTEXT, selectedBuilding: BUILDING, selectedBuildingAt: [117.16123456, -0.49] };
    await chat(server, body("Kalau gedung ini pakai panel surya?", context));
    const state = (model.calls[0]!.messages.at(-1)!.content as Anthropic.TextBlockParam[])[0]!.text;
    expect(state).toContain('{"lat":-0.49,"lng":117.16123,"roofAreaM2":400,"kwhYear":145600,"buildingType":"sekolah"}');
    expect(state).toContain("koordinat gedung");
    expect(state).not.toContain("dipakai pusat peta");
  });

  test.each([["x"], [[117.1]], [[200, 0]], [[117.1, "a"]]])(
    "an invalid selectedBuildingAt %j is a 400",
    async (at) => {
      const model = fakeModel([{ text: "Baik." }]);
      const { server } = start({ chat: model.model });
      const res = await post(server, body("Halo", { ...CONTEXT, selectedBuilding: BUILDING, selectedBuildingAt: at }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("selectedBuildingAt");
      expect(model.calls).toHaveLength(0);
    },
  );

  test("selectedBuildingAt null is fine", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Halo", { ...CONTEXT, selectedBuildingAt: null }));
    expect(eventNames(events).at(-1)).toBe("done");
  });

  test("with nothing selected the app state says so", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    await chat(server, body("Halo"));
    const blocks = model.calls[0]!.messages.at(-1)!.content as Anthropic.TextBlockParam[];
    expect(blocks[0]!.text).toContain("Wilayah terpilih: tidak ada");
    expect(blocks[0]!.text).toContain("Gedung terpilih: tidak ada");
  });

  test.each([["Samarinda paling tinggi."], ["\n\nSamarinda paling tinggi."]])(
    "text from consecutive model calls is separated by exactly one blank line (second reply %j)",
    async (second) => {
      const model = fakeModel([
        { text: "Saya cek dulu.", tools: [{ name: "list_regions", input: {} }] },
        { text: second },
      ]);
      const { server } = start({ chat: model.model });
      const events = await chat(server, body("Wilayah mana emisinya paling tinggi?"));
      expect(streamedText(events)).toBe("Saya cek dulu.\n\nSamarinda paling tinggi.");
    },
  );

  test("assistant turns, thinking blocks included, go back to Claude unchanged within the tool loop", async () => {
    const model = fakeModel([{ thinking: true, tools: [{ name: "set_metric", input: { metric: "co2" } }] }, { text: "Sudah." }]);
    const { server } = start({ chat: model.model });
    await chat(server, body("Tampilkan emisi"));

    const replayed = model.calls[1]!.messages.at(-2)!;
    expect(replayed.role).toBe("assistant");
    expect(replayed.content).toEqual([
      { type: "thinking", thinking: "", signature: "sig_1" },
      { type: "tool_use", id: "toolu_1_0", name: "set_metric", input: { metric: "co2" }, caller: { type: "direct" } },
    ]);
  });

  test("several tool calls in one reply: actions go out in order, all results come back in one message in order", async () => {
    const model = fakeModel([
      {
        tools: [
          { name: "fly_to_region", input: { region: "Kukar" } },
          { name: "list_regions", input: {} },
          { name: "toggle_layer", input: { layer: "plants", visible: false } },
        ],
      },
      { text: "Selesai." },
    ]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Tunjukkan Kukar tanpa pembangkit"));

    expect(actions(events)).toEqual([
      { name: "fly_to_region", input: { region: "kutai-kartanegara" } },
      { name: "toggle_layer", input: { layer: "plants", visible: false } },
    ]);
    const results = toolResults(model.calls[1]);
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_1_0", "toolu_1_1", "toolu_1_2"]);
    expect(resultJson(results[1]).regions).toHaveLength(10);
    expect(model.calls[1]!.messages.at(-1)!.content).toHaveLength(3);
  });

  test.each([
    ["show_all_regions", { anything: 1 }, {}],
    ["fly_to", { lng: 117.15, lat: -0.5, zoom: 15 }, { lng: 117.15, lat: -0.5, zoom: 15 }],
    ["select_building_at", { lng: 117.1466, lat: -0.4998 }, { lng: 117.1466, lat: -0.4998 }],
    ["toggle_layer", { layer: "Buildings", visible: true }, { layer: "buildings", visible: true }],
    ["set_metric", { metric: "CO2" }, { metric: "co2" }],
    ["set_rain", { mode: "on" }, { mode: "on" }],
    ["open_tab", { tab: "surya" }, { tab: "surya" }],
  ])("%s emits its action with a clean input", async (name, input, expected) => {
    const model = fakeModel([{ tools: [{ name, input }] }, { text: "Sudah." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Tolong"));
    expect(actions(events)).toEqual([{ name, input: expected }]);
    expect(resultJson(toolResults(model.calls[1])[0])).toEqual({ ok: true });
  });

  test.each([
    ["toggle_layer", { layer: "jalan", visible: true }],
    ["toggle_layer", { layer: "plants", visible: "ya" }],
    ["set_metric", { metric: "suhu" }],
    ["set_rain", { mode: "kadang" }],
    ["open_tab", { tab: "cuaca-buruk" }],
    ["fly_to", { lng: 117.15, lat: -95, zoom: 10 }],
    ["fly_to", { lng: 117.15, lat: -0.5 }],
    ["select_building_at", { lng: "117", lat: -0.5 }],
    ["hapus_peta", {}],
  ])("%s with input %j returns an error result and emits no action", async (name, input) => {
    const model = fakeModel([{ tools: [{ name, input }] }, { text: "Maaf." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Tolong"));
    expect(actions(events)).toEqual([]);
    const [result] = toolResults(model.calls[1]);
    expect(result?.is_error).toBe(true);
    expect(String(result?.content).length).toBeGreaterThan(0);
  });

  test("a reply cut off at max_tokens does not run its tool calls", async () => {
    const model = fakeModel([{ text: "Saya tunjukkan", tools: [{ name: "fly_to_region", input: { region: "Kukar" } }], stop: "max_tokens" }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Tunjukkan Kukar"));
    expect(model.calls).toHaveLength(1);
    expect(actions(events)).toEqual([]);
    expect(eventNames(events).at(-1)).toBe("done");
    expect(streamedText(events)).toContain("terpotong");
  });

  test("an empty reply still gives the user a short text", async () => {
    const model = fakeModel([{ text: "" }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Halo"));
    expect(eventNames(events)).toEqual(["text", "done"]);
    expect(streamedText(events).length).toBeGreaterThan(10);
  });

  test("a 2,000-character message is accepted", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("a".repeat(2000)));
    expect(eventNames(events).at(-1)).toBe("done");
  });

  test("a context without selectedRegionId and selectedBuilding counts them as null", async () => {
    const model = fakeModel([{ text: "Baik." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Halo", { view: { center: [117.15, -0.5], zoom: 9 } }));
    expect(eventNames(events).at(-1)).toBe("done");
  });

  test("a failing chat store still answers", async () => {
    const model = fakeModel([{ text: "Halo juga." }]);
    const { server, fake } = start({ chat: model.model });
    const down = async () => {
      throw new Error("db down");
    };
    fake.deps.db.ensureChatSession = down;
    fake.deps.db.chatHistory = down;
    fake.deps.db.addChatMessage = down;
    const events = await chat(server, body("Halo"));
    expect(eventNames(events)).toEqual(["text", "text", "done"]);
    expect(warn).toHaveBeenCalled();
  });

  test("closing the connection aborts the upstream Claude stream and stores no answer", async () => {
    const model = hangingModel(["Sebentar"]);
    const { server, fake } = start({ chat: model.model });
    const client = new AbortController();
    const res = await post(server, body("Halo"), client.signal);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: text");

    client.abort();
    await waitFor(() => model.signals[0]?.aborted === true);
    expect(model.signals[0]?.aborted).toBe(true);
    await Bun.sleep(30);
    expect(fake.chatMessages.map((m) => m.role)).toEqual(["user"]);
  });

  test.each([
    ["body is not json", "nope{"],
    ["body is an array", [1]],
    ["sessionId is missing", { message: "Halo", context: CONTEXT }],
    ["sessionId is not a uuid", body("Halo", CONTEXT, "sesi-1")],
    ["message is missing", { sessionId: SESSION, context: CONTEXT }],
    ["message is not a string", { sessionId: SESSION, message: 5, context: CONTEXT }],
    ["message is empty", body("")],
    ["message is only spaces", body("   ")],
    ["message is over 2,000 characters", body("a".repeat(2001))],
    ["context is missing", { sessionId: SESSION, message: "Halo" }],
    ["context is a string", body("Halo", "peta")],
    ["view is missing", body("Halo", { selectedRegionId: null, selectedBuilding: null })],
    ["center is not a pair", body("Halo", { ...CONTEXT, view: { center: [117.15], zoom: 9 } })],
    ["center is out of range", body("Halo", { ...CONTEXT, view: { center: [200, -0.5], zoom: 9 } })],
    ["zoom is not a number", body("Halo", { ...CONTEXT, view: { center: [117.15, -0.5], zoom: "9" } })],
    ["selectedRegionId is a number", body("Halo", { ...CONTEXT, selectedRegionId: 3 })],
    ["selectedBuilding is a string", body("Halo", { ...CONTEXT, selectedBuilding: "gedung" })],
    ["selectedBuilding has an unknown type", body("Halo", { ...CONTEXT, selectedBuilding: { ...BUILDING, type: "kastil" } })],
    ["selectedBuilding has a text kWh", body("Halo", { ...CONTEXT, selectedBuilding: { ...BUILDING, kwhYear: "banyak" } })],
    ["selectedBuilding has zero floors", body("Halo", { ...CONTEXT, selectedBuilding: { ...BUILDING, floors: 0 } })],
    ["selectedBuilding assumptions are not text", body("Halo", { ...CONTEXT, selectedBuilding: { ...BUILDING, assumptions: [1] } })],
  ])("invalid body (%s) returns 400 with an Indonesian error and never calls Claude", async (_name, payload) => {
    const model = fakeModel([{ text: "tidak boleh" }]);
    const { server, fake } = start({ chat: model.model });
    const res = await post(server, payload);
    expect(res.status).toBe(400);
    const out = (await res.json()) as { error: string };
    expect(out.error.length).toBeGreaterThan(0);
    expect(model.calls).toHaveLength(0);
    expect(fake.chatMessages).toHaveLength(0);
  });
});

describe("chat server tools", () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("list_regions ranks all regions by CO2 with Indonesian number text", async () => {
    const { json, result } = await callTool("list_regions", {});
    expect(result?.is_error).toBeUndefined();
    expect(json.regions).toHaveLength(10);
    expect(json.regions[0]).toMatchObject({ rank: 1, id: "samarinda", name: "Samarinda", kind: "kota" });
    expect(json.regions[9]).toMatchObject({ rank: 10, id: "berau" });
    // Fake Samarinda: 1.000.000.000 kWh and 1.140.000.000 kg CO2, in the region panel's format.
    expect(json.regions[0].kwhText).toBe("1,00 miliar kWh per tahun (perkiraan)");
    expect(json.regions[0].co2Text).toBe("1,1 juta ton CO2 per tahun (perkiraan)");
    expect(json.regions[0].kwhShareText).toBe("18,2% (perkiraan)");
    expect(json.kaltim.kwhText).toBe("5,50 miliar kWh per tahun (perkiraan)");
    expect(json.note).toContain("perkiraan");
  });

  test("get_region_stats resolves an alias and returns the region figures with perkiraan labels", async () => {
    const { json, result } = await callTool("get_region_stats", { region: "Kukar" });
    expect(result?.is_error).toBeUndefined();
    expect(json).toMatchObject({ id: "kutai-kartanegara", name: "Kutai Kartanegara", kind: "kabupaten" });
    expect(json.co2Rank).toContain("6 dari 10");
    // Same format as the region panel (fmtCompact keeps one decimal for juta).
    expect(json.facts["Listrik terpakai"]).toBe("500,0 juta kWh per tahun (perkiraan)");
    expect(json.facts["Penduduk"]).toBe("100.000 jiwa");
    expect(json.facts["Desa belum dilayani PLN"]).toBe("belum ada data");
  });

  test("get_region_stats with a region outside Kaltim returns an error result", async () => {
    const { result } = await callTool("get_region_stats", { region: "Bandung" });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("Bandung");
  });

  test("get_grid_mix returns the grid factor and the shares by fuel", async () => {
    const { json } = await callTool("get_grid_mix", {});
    expect(json.year).toBe(2023);
    expect(json.gridFactorText).toBe("1,14 kg CO2 per kWh");
    expect(json.mix).toEqual([{ fuel: "batu bara", shareText: "100%" }]);
    expect(json.note).toContain("perkiraan");
  });

  test("the region note says how the kWh split works, with its exceptions", async () => {
    const { json } = await callTool("list_regions", {});
    expect(json.note).toContain("per cabang");
    // All four exceptions to the plain split by customers (architecture.md, Metodologi section 1).
    expect(json.note).toContain("Samarinda memakai angka tabel BPS Kota Samarinda");
    expect(json.note).toContain("Mahakam Ulu memakai asumsi 1.500 kWh per pelanggan");
    expect(json.note).toContain("Kutai Kartanegara dibagi ke tiga cabang");
    expect(json.note).toContain("Malinau");
  });

  test("estimate_building_at gives the building type id for simulate_solar", async () => {
    const { json } = await callTool("estimate_building_at", { lng: 117.15, lat: -0.5 }, {}, SCHOOL);
    expect(json.buildingType).toBe("sekolah");
  });

  test("estimate_building_at uses the POI type and a 150 m2 footprint that is flagged as an assumption", async () => {
    const { json, fake } = await callTool("estimate_building_at", { lng: 117.15, lat: -0.5 }, {}, SCHOOL);
    expect(fake.poiCalls).toEqual([[117.15, -0.5]]);
    expect(json).toMatchObject({ type: "sekolah", floors: 2, footprintM2: 150, floorAreaM2: 300, kwhYear: 30_000, region: "Samarinda" });
    expect(json.poi).toEqual({ name: "SMA 1", class: "education", type: "School", distanceM: 6 });
    expect(json.kwhYearText).toBe("30.000 kWh per tahun (perkiraan)");
    expect(json.co2YearText).toBe("34,2 ton CO2 per tahun (perkiraan)");
    expect(json.assumptions[0]).toContain("150 m2");
    expect(json.equivalents.length).toBeGreaterThan(0);
  });

  test("estimate_building_at with Tilequery down still estimates from the footprint", async () => {
    const { json, result } = await callTool("estimate_building_at", { lng: 117.15, lat: -0.5 }, {}, new Error("tilequery down"));
    expect(result?.is_error).toBeUndefined();
    expect(json.type).toBe("rumah");
    expect(json.poi).toBeNull();
    expect(json.assumptions.some((a: string) => /POI/.test(a))).toBe(true);
  });

  test("estimate_building_at just outside Kaltim (inside the margin) says so and still estimates", async () => {
    // Central Kalimantan, west of the Kaltim border: inside the margin, but no Kaltim region.
    const { json, result } = await callTool("estimate_building_at", { lng: 113.2, lat: 0.5 });
    expect(result?.is_error).toBeUndefined();
    expect(json.region).toBe("Di luar Kalimantan Timur");
    expect(json.kwhYear).toBeGreaterThan(0);
  });

  test.each([
    ["estimate_building_at", { lng: 106.8, lat: -6.2 }],
    ["simulate_solar", { lat: -6.2, lng: 106.8, roofAreaM2: 100, kwhYear: 5000, backupHours: 4 }],
    ["get_weather", { lat: -6.2, lng: 106.8 }],
    ["get_weather", { lat: 0.5, lng: 121 }],
  ])("%s for a point far outside Kaltim (%j) returns an error result without calling the upstream", async (name, input) => {
    const { result, fake } = await callTool(name, input, { meteo: forecastFromToday() });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("di luar Kalimantan Timur");
    expect(fake.poiCalls).toHaveLength(0);
    expect(fake.nasaCalls).toHaveLength(0);
    expect(fake.meteoCalls).toHaveLength(0);
  });

  test("one reply runs at most 6 server tools; the rest get an error result and map actions are not counted", async () => {
    const tools = [
      ...Array.from({ length: 4 }, () => ({ name: "list_regions", input: {} })),
      { name: "fly_to_region", input: { region: "Kukar" } },
      ...Array.from({ length: 4 }, () => ({ name: "get_grid_mix", input: {} })),
    ];
    const model = fakeModel([{ tools }, { text: "Selesai." }]);
    const { server } = start({ chat: model.model });
    const events = await chat(server, body("Semua data sekaligus"));

    expect(actions(events)).toEqual([{ name: "fly_to_region", input: { region: "kutai-kartanegara" } }]);
    const results = toolResults(model.calls[1]);
    expect(results).toHaveLength(9);
    expect(results.map((r) => r.tool_use_id)).toEqual(tools.map((_, i) => `toolu_1_${i}`));
    // Server calls 1-6 run (positions 0-3, 5, 6); the action at 4 is not counted; 7 and 8 are refused.
    expect(results.map((r) => r.is_error === true)).toEqual([false, false, false, false, false, false, false, true, true]);
    expect(String(results[7]?.content)).toContain("paling banyak 6");
  });

  test.each([["sekolah"], ["rumah"], [undefined]])(
    "simulate_solar gives the same numbers as POST /api/solar/simulate (building type %p)",
    async (buildingType) => {
      const input = { lat: -0.5, lng: 117.15, roofAreaM2: 400, kwhYear: 60000, backupHours: 4, ...(buildingType ? { buildingType } : {}) };
      const { json, result } = await callTool("simulate_solar", input);
      expect(result?.is_error, String(result?.content)).toBeUndefined();

      const { server } = start();
      const res = await fetch(new URL("/api/solar/simulate", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const direct = (await res.json()) as {
        kWp: number;
        costRp: number;
        savingRpYear: number;
        selfUseKwh: number;
        exportKwh: number;
        paybackPanelYears: number;
        assumptions: string[];
      };
      expect(json.kWp).toBe(direct.kWp);
      expect(json.costText).toBe(`${fmtRupiah(direct.costRp)} (perkiraan)`);
      expect(json.savingText).toBe(`${fmtRupiah(direct.savingRpYear)} per tahun (perkiraan)`);
      expect(json.selfUseText).toBe(`${fmtKwh(direct.selfUseKwh)} per tahun (perkiraan)`);
      expect(json.paybackPanelText).toBe(`${fmtNumber(direct.paybackPanelYears, 1)} tahun (perkiraan)`);
      expect(json.assumptions).toEqual(direct.assumptions);
      expect(json.coverageText).toContain("dipakai langsung");
    },
  );

  test("simulate_solar prices a school as a school: the type changes the saving", async () => {
    const base = { lat: -0.5, lng: 117.15, roofAreaM2: 400, kwhYear: 60000, backupHours: 0 };
    const school = (await callTool("simulate_solar", { ...base, buildingType: "Sekolah" })).json;
    const unknown = (await callTool("simulate_solar", base)).json;
    expect(school.input.buildingType).toBe("sekolah");
    expect(school.savingText).not.toBe(unknown.savingText);
  });

  test("simulate_solar with an unknown building type returns an error result", async () => {
    const { result } = await callTool("simulate_solar", { lat: -0.5, lng: 117.15, roofAreaM2: 100, kwhYear: 5000, backupHours: 4, buildingType: "kasino" });
    expect(result?.is_error).toBe(true);
  });

  test("simulate_solar with an invalid input returns an error result", async () => {
    const { result } = await callTool("simulate_solar", { lat: -0.5, lng: 117.15, roofAreaM2: 0, kwhYear: 5000, backupHours: 4 });
    expect(result?.is_error).toBe(true);
  });

  test("get_weather labels today and tomorrow and sizes the solar output to the given kWp", async () => {
    const { json, result } = await callTool("get_weather", { lat: -0.5, lng: 117.15, kWp: 2 }, { meteo: forecastFromToday() });
    expect(result?.is_error).toBeUndefined();
    expect(json.kWp).toBe(2);
    expect(json.kWpNote).toBeUndefined();
    expect(json.days).toHaveLength(2);
    expect(json.days[0].day).toStartWith("hari ini");
    expect(json.days[1].day).toStartWith("besok");
    // 12 sunny hours x 2 kWp x 0.6 kW/m2 x PR 0.78.
    expect(json.days[0].solarText).toBe("11,2 kWh (perkiraan)");
    // Tomorrow: 9 sunny hours plus 3 rainy ones at 150 W/m2 is 9,126 kWh.
    expect(json.days[1]).toMatchObject({ sky: "hujan", rain: true, heaviestRainText: "3,0 mm per jam di siang hari", solarText: "9,1 kWh (perkiraan)" });
    // Each day is measured against a clear sky at that place and date (the Cuaca tab's model), not the best day.
    const hours = forecastFromToday();
    const rows = summariseDays(pvFromForecast(hours, 2));
    for (const [i, day] of json.days.entries()) {
      const v = dayAgainstClearSky(rows[i]!, hours, { lat: -0.5, lng: 117.15, kWp: 2 });
      expect(day.comparedToClearSky).toBe(dropSentence(v));
      expect(day.clearSkyText).toBe(`${fmtNumber(v.clearKwh, 1)} kWh (model langit cerah)`);
    }
    expect(json.days[1].comparedToClearSky).toMatch(/^produksi turun \d+% karena (hujan|awan dan hujan)$/);
    expect(JSON.stringify(json)).not.toContain("hari terbaik");
  });

  test("get_weather judges rain by daylight hours, as the Cuaca tab does: a night-only shower is not a rainy day", async () => {
    // Tomorrow is dry and sunny apart from one 3 mm shower at 02:00 (hour 26 from today's 00:00).
    const hours = forecastFromToday((i) => i === 26);
    const { json } = await callTool("get_weather", { lat: -0.5, lng: 117.15, kWp: 2 }, { meteo: hours });
    expect(json.days[1]).toMatchObject({ sky: "cerah", rain: false, heaviestRainText: "0,0 mm per jam di siang hari" });
    // The tab's day rows give the same sky for every day.
    const tab = dayRows(summariseDays(pvFromForecast(hours, 2)), pvFromForecast(hours, 2), Date.now(), { lat: -0.5, lng: 117.15, kWp: 2 });
    expect(json.days.map((d: { sky: string }) => d.sky)).toEqual(tab.map((r) => r.sky));
  });

  test("get_weather without kWp uses 1 kWp and says so", async () => {
    const { json } = await callTool("get_weather", { lat: -0.5, lng: 117.15 }, { meteo: forecastFromToday() });
    expect(json.kWp).toBe(1);
    expect(json.kWpNote).toContain("1 kWp");
  });

  test("get_weather with Open-Meteo down and nothing cached returns an error result", async () => {
    const { result } = await callTool("get_weather", { lat: -0.5, lng: 117.15 }, { meteo: new Error("open-meteo down") });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("tidak tersedia");
  });

  // ---------- get_recommendations ----------

  test("get_recommendations without Claude gives the rule-based items and says so", async () => {
    const { json, result } = await callTool("get_recommendations", { region: "Kukar" });
    expect(result?.is_error).toBeUndefined();
    expect(json.region).toBe("Kutai Kartanegara");
    expect(json.source).toContain("berbasis aturan");
    expect(json.items.length).toBeGreaterThanOrEqual(3);
    for (const item of json.items) {
      expect(typeof item.title).toBe("string");
      expect(typeof item.body).toBe("string");
      expect(typeof item.impact).toBe("string");
      expect(item.priority).toMatch(/^prioritas [123]/);
      expect(["energi terbarukan", "efisiensi energi", "tata ruang", "akses listrik", "kebijakan"]).toContain(item.category);
    }
    expect(json.note).toContain("panel wilayah");
  });

  test("get_recommendations serves the cached Claude items with the model and the date", async () => {
    const model = fakeModel([{ tools: [{ name: "get_recommendations", input: { region: "samarinda" } }] }, { text: "Selesai." }]);
    const { server, fake } = start({ chat: model.model });
    const items = [1, 2, 3].map((n) => ({
      title: `Saran ${n}`,
      category: "efisiensi" as const,
      body: `Isi saran ${n}.`,
      impact: `Dampak ${n}.`,
      priority: n as 1 | 2 | 3,
    }));
    await fake.deps.db.recommendationsSet("samarinda", items, "claude-haiku-5-5");
    await chat(server, body("Apa saran untuk Samarinda?"));
    const json = resultJson(toolResults(model.calls[1])[0]);
    expect(json.source).toContain("claude-haiku-5-5");
    expect(json.source).toMatch(/dibuat \d+ \w+ \d{4}/);
    expect(json.items.map((i: { title: string }) => i.title)).toEqual(["Saran 1", "Saran 2", "Saran 3"]);
    expect(json.items[0]).toMatchObject({ category: "efisiensi energi", priority: "prioritas 1 (paling penting)" });
  });

  test("get_recommendations for a region outside Kaltim returns an error result", async () => {
    const { result } = await callTool("get_recommendations", { region: "Jakarta" });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("Jakarta");
  });

  // ---------- find_places ----------

  const hit = (name: string, lng: number, lat: number, distanceM: number | null = 100): PlaceHit => ({
    name,
    lng,
    lat,
    address: `${name}, Samarinda`,
    distanceM,
  });
  /** Fake Samarinda is lng 116.5 to 118 (fakes.ts); 116.2 lies outside it. */
  const SCHOOLS = [hit("SMA Negeri 1", 117.151, -0.501), hit("SD di Balikpapan", 116.2, -1.2), hit("SD Negeri 2", 117.16, -0.49, 1500)];

  test("find_places searches near the region, keeps the places inside it and marks them on the map", async () => {
    const model = fakeModel([
      { tools: [{ name: "find_places", input: { category: "school", region: "Kota Samarinda" } }] },
      { text: "Ini sekolahnya." },
    ]);
    const { server, fake } = start({ chat: model.model, places: SCHOOLS });
    const events = await chat(server, body("Tunjukkan gedung sekolah di Samarinda"));

    expect(fake.placeCalls).toHaveLength(1);
    expect(fake.placeCalls[0]).toMatchObject({ category: "school", near: [117.15, -0.5], limit: 25 });
    expect(fake.placeCalls[0]!.exclude).toContain("driving_school");
    const json = resultJson(toolResults(model.calls[1])[0]);
    expect(json.category).toBe("sekolah");
    expect(json.near).toBe("Samarinda");
    expect(json.places).toEqual([
      { n: 1, name: "SMA Negeri 1", address: "SMA Negeri 1, Samarinda", lng: 117.151, lat: -0.501, region: "Samarinda" },
      { n: 2, name: "SD Negeri 2", address: "SD Negeri 2, Samarinda", lng: 117.16, lat: -0.49, region: "Samarinda" },
    ]);
    expect(json.note).toContain("ditandai");
    expect(eventNames(events)[0]).toBe("action");
    expect(actions(events)).toEqual([
      {
        name: "mark_places",
        input: {
          label: "sekolah",
          places: [
            { name: "SMA Negeri 1", lng: 117.151, lat: -0.501, type: "sekolah" },
            { name: "SD Negeri 2", lng: 117.16, lat: -0.49, type: "sekolah" },
          ],
        },
      },
    ]);
  });

  test("find_places near a point keeps every place and says how far each one is", async () => {
    const { json, fake } = await callTool("find_places", { category: "hospital", lng: 117.15, lat: -0.5 }, { places: SCHOOLS });
    expect(fake.placeCalls[0]).toMatchObject({ category: "hospital", near: [117.15, -0.5] });
    expect(json.near).toBe("titik lng 117.15, lat -0.5");
    expect(json.places).toHaveLength(3);
    expect(json.places[0]).toMatchObject({ n: 1, distanceText: "100 m dari titik itu" });
    expect(json.places[1]).toMatchObject({ region: "Di luar Kalimantan Timur" });
    expect(json.places[2]).toMatchObject({ distanceText: "1,5 km dari titik itu" });
  });

  test.each([
    [{}, 5],
    [{ limit: 3 }, 3],
    [{ limit: 50 }, 10],
  ])("find_places returns at most limit places, 5 by default and 10 at most (%j)", async (extra, expected) => {
    const many = Array.from({ length: 14 }, (_, i) => hit(`Sekolah ${i + 1}`, 117 + i / 100, -0.5));
    const { json } = await callTool("find_places", { category: "school", region: "samarinda", ...extra }, { places: many });
    expect(json.places).toHaveLength(expected);
  });

  test.each([
    [{ category: "kasino", region: "samarinda" }, "category"],
    [{ category: "school" }, "region"],
    [{ category: "school", lng: 106.8, lat: -6.2 }, "luar Kalimantan Timur"],
    [{ category: "school", region: "Jakarta" }, "Jakarta"],
  ])("find_places with %j returns an error result without searching", async (input, words) => {
    const { result, fake } = await callTool("find_places", input, { places: SCHOOLS });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain(words);
    expect(fake.placeCalls).toHaveLength(0);
  });

  test("find_places with the search down returns an error result and marks nothing", async () => {
    const { result, events } = await callTool("find_places", { category: "school", region: "samarinda" }, { places: new Error("HTTP 503") });
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("tidak bisa");
    expect(actions(events)).toEqual([]);
  });

  test("find_places with nothing found in the region says so and marks nothing", async () => {
    const { result, events } = await callTool(
      "find_places",
      { category: "school", region: "samarinda" },
      { places: [hit("Jauh", 116.2, -1.2)] },
    );
    expect(result?.is_error).toBe(true);
    expect(String(result?.content)).toContain("Tidak ditemukan sekolah di Samarinda");
    expect(actions(events)).toEqual([]);
  });

  test("a server tool that throws gives Claude an error result instead of breaking the chat", async () => {
    const model = fakeModel([{ tools: [{ name: "get_grid_mix", input: {} }] }, { text: "Maaf, datanya belum ada." }]);
    const { server, fake } = start({ chat: model.model });
    fake.deps.db.getGridMix = async () => {
      throw new Error("db down");
    };
    const events = await chat(server, body("Campuran listriknya apa?"));
    expect(eventNames(events).at(-1)).toBe("done");
    const [result] = toolResults(model.calls[1]);
    expect(result?.is_error).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

describe("the event stream", () => {
  test("sends a keep-alive comment while the answer is quiet, then the events", async () => {
    const req = new Request("http://localhost/api/chat", { method: "POST" });
    const res = eventStream(
      req,
      async (send) => {
        await Bun.sleep(90);
        send({ event: "done", data: {} });
      },
      20,
    );
    const text = await res.text();
    expect(text.startsWith(": ping\n\n")).toBe(true);
    expect(text.endsWith("event: done\ndata: {}\n\n")).toBe(true);
    expect(parseSse(text)).toEqual([{ event: "done", data: {} }]);
  });

  test("no keep-alive comment once the stream has ended", async () => {
    const req = new Request("http://localhost/api/chat", { method: "POST" });
    const cleared = spyOn(globalThis, "clearInterval");
    try {
      const res = eventStream(req, async (send) => send({ event: "done", data: {} }), 10);
      expect(await res.text()).toBe("event: done\ndata: {}\n\n");
      expect(cleared).toHaveBeenCalled();
    } finally {
      cleared.mockRestore();
    }
  });

  test("a client that leaves stops the keep-alive and aborts the answer", async () => {
    const req = new Request("http://localhost/api/chat", { method: "POST" });
    const cleared = spyOn(globalThis, "clearInterval");
    let aborted = false;
    try {
      const res = eventStream(
        req,
        (_send, signal) =>
          new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            }),
          ),
        10,
      );
      const reader = res.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toBe(": ping\n\n");
      cleared.mockClear();
      await reader.cancel();
      expect(aborted).toBe(true);
      expect(cleared).toHaveBeenCalled();
    } finally {
      cleared.mockRestore();
    }
  });
});

describe("GET /api/chat/status", () => {
  test("says the chat is on when the server has a model", async () => {
    const { server } = start({ chat: fakeModel([]).model });
    const res = await fetch(new URL("/api/chat/status", server.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true });
  });

  test("says the chat is off without an API key", async () => {
    const { server } = start({ chat: createChatModel("") });
    expect(await (await fetch(new URL("/api/chat/status", server.url))).json()).toEqual({ enabled: false });
  });
});

describe("runChat", () => {
  test("a stalled stream ends with an Indonesian timeout error at the deadline", async () => {
    const model = hangingModel();
    const fake = fakeDeps(null, { chat: model.model });
    const logError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await runChat({
        deps: fake.deps,
        messages: [{ role: "user", content: "Halo" }],
        signal: new AbortController().signal,
        onText: () => {},
        onAction: () => {},
        deadlineMs: 50,
      });
      expect(outcome).toEqual({ status: "error", message: expect.stringMatching(/terlalu lama/) });
      expect(model.signals[0]?.aborted).toBe(true);
    } finally {
      logError.mockRestore();
    }
  });
});
