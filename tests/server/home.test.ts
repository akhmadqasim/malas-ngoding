import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import costs from "../../data/seed/solar-costs.json";
import { parseHomeInput, roofPotentialKwp } from "../../src/server/routes/home.ts";
import { createServer } from "../../src/server/index.ts";
import { CHAT_MODEL, type ChatModel } from "../../src/server/services/claude.ts";
import type { HomeAnswer, HomeInput } from "../../src/shared/auth.ts";
import { simulateSolar } from "../../src/shared/solar.ts";
import { type FakeDeps, fakeDeps } from "./fakes.ts";

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(upstreams: Parameters<typeof fakeDeps>[1] = {}): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps(null, upstreams);
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const HOME: HomeInput = {
  featureId: "b-1",
  lng: 117.1475,
  lat: -0.4955,
  footprintM2: 100,
  heightM: null,
  buildingType: "rumah",
  floors: 3,
  kwhMonth: null,
  billRpMonth: null,
  interestedPv: true,
  consentMap: false,
};

const send = (s: Server<undefined>, method: string, cookie: string | undefined, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(new URL("/api/me/home", s.url), {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const put = (s: Server<undefined>, cookie: string | undefined, body: unknown, headers?: Record<string, string>) => send(s, "PUT", cookie, body, headers);

describe("/api/me/home access", () => {
  test.each(["GET", "PUT", "DELETE"])("%s is a 401 when signed out", async (method) => {
    const { server } = start();
    const res = await send(server, method, undefined, method === "PUT" ? HOME : undefined);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });

  test.each(["GET", "PUT", "DELETE"])("%s is a 403 for a government account", async (method) => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("pemda");
    const res = await send(server, method, cookie, method === "PUT" ? HOME : undefined);
    expect(res.status).toBe(403);
    expect(fake.homes.size).toBe(0);
  });

  test("a resident with no home gets { home: null }", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    expect(await (await send(server, "GET", cookie)).json()).toEqual({ home: null });
  });

  test("PUT and DELETE from another origin are 403", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    expect((await put(server, cookie, HOME, { origin: "https://evil.example" })).status).toBe(403);
    expect((await send(server, "DELETE", cookie, undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect(fake.homes.size).toBe(0);
  });

  test("PUT needs a JSON content type", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const res = await send(server, "PUT", cookie, JSON.stringify(HOME), { "content-type": "text/plain" });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/me/home", () => {
  test.each([
    { installedPv: "yes" },
    { installedPv: false, installedKwp: 2.2 },
    { installedPv: true, installedKwp: -1 },
    { installedPv: true, installedKwp: 10001 },
  ])("rejects invalid installation data %j", async patch => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    expect((await put(server, cookie, { ...HOME, ...patch })).status).toBe(400);
    expect(fake.homes.size).toBe(0);
  });
  test("persists reported installation and allows removing it", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const res = await put(server, cookie, { ...HOME, installedPv: true, installedKwp: 3.3 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as HomeAnswer).home).toMatchObject({ installedPv: true, installedKwp: 3.3 });
    const removed = await put(server, cookie, { ...HOME, installedPv: false, installedKwp: null });
    expect(((await removed.json()) as HomeAnswer).home).toMatchObject({ installedPv: false, installedKwp: null });
  });
  test("saves the home with the model estimate when no bill is given", async () => {
    const { server, fake } = start();
    const { cookie, user } = await fake.signIn("warga");
    const res = await put(server, cookie, HOME);
    expect(res.status).toBe(200);
    const { home } = (await res.json()) as HomeAnswer;
    // Fake building type: 100 kWh/m2/year; 100 m2 x 3 floors.
    expect(home).toMatchObject({
      regionId: "samarinda",
      regionName: "Samarinda",
      kwhYear: 30_000,
      kwhSource: "perkiraan",
      roofAreaM2: 100,
      featureId: "b-1",
      interestedPv: true,
      consentMap: false,
      kwhMonth: null,
    });
    expect(Number.isNaN(Date.parse(home!.updatedAt))).toBe(false);
    expect(await (await send(server, "GET", cookie)).json()).toEqual({ home });
    expect(fake.homes.get(user.id)?.demo).toBe(false);
  });

  test("kwhYear is kwhMonth x 12 from the bill", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const { home } = (await (await put(server, cookie, { ...HOME, kwhMonth: 250 })).json()) as HomeAnswer;
    expect(home).toMatchObject({ kwhYear: 3000, kwhSource: "tagihan", kwhMonth: 250 });
  });

  test("kwhYear is the rupiah bill x 12 over the R-1/1.300 VA tariff", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const { home } = (await (await put(server, cookie, { ...HOME, billRpMonth: 360_000 })).json()) as HomeAnswer;
    expect(home!.kwhSource).toBe("tagihan");
    expect(home!.kwhYear).toBeCloseTo((360_000 * 12) / costs.tariffs.R1_1300, 6);
    expect(home!.billRpMonth).toBe(360_000);
  });

  test("kWh a month wins over the rupiah bill when both are given", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const { home } = (await (await put(server, cookie, { ...HOME, kwhMonth: 100, billRpMonth: 999_999 })).json()) as HomeAnswer;
    expect(home!.kwhYear).toBe(1200);
  });

  test("potentialKwp is the most PV the roof holds, from the same constants as the solar simulation", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    // 60% of 100 m2 at 5.5 m2 per kWp is 10.9 kWp: 19 whole panels of 0.55 kWp.
    const { home } = (await (await put(server, cookie, HOME)).json()) as HomeAnswer;
    expect(home!.potentialKwp).toBe(10.45);
    expect(roofPotentialKwp(100)).toBe(10.45);
    // A load that fills the roof makes the simulation use exactly that.
    const sim = simulateSolar({
      roofAreaM2: 100, kwhYear: 1e7, peakSunHours: 4.8, backupHours: 0, tariffRpPerKwh: 1000,
      costRpPerKwp: 1, batteryRpPerKwh: 1, gridFactorKgPerKwh: 1,
    });
    expect(sim.kWp).toBe(home!.potentialKwp);
    expect(roofPotentialKwp(5)).toBe(0);
  });

  test("a second PUT replaces the first (one home per resident)", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    await put(server, cookie, HOME);
    const { home } = (await (await put(server, cookie, { ...HOME, floors: 1, consentMap: true })).json()) as HomeAnswer;
    expect(home).toMatchObject({ floors: 1, consentMap: true });
    expect(fake.homes.size).toBe(1);
  });

  test("a resident only ever reaches their own home", async () => {
    const { server, fake } = start();
    const a = await fake.signIn("warga");
    const b = await fake.signIn("warga");
    await put(server, a.cookie, HOME);
    expect(await (await send(server, "GET", b.cookie)).json()).toEqual({ home: null });
    expect((await send(server, "DELETE", b.cookie)).status).toBe(204);
    expect(((await (await send(server, "GET", a.cookie)).json()) as HomeAnswer).home).not.toBeNull();
  });

  test("a place outside Kalimantan Timur is a 400", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const res = await put(server, cookie, { ...HOME, lng: 106.8, lat: -6.2 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Kalimantan Timur");
  });

  test.each<[string, Partial<Record<keyof HomeInput, unknown>>]>([
    ["a missing featureId", { featureId: "" }],
    ["lng out of range", { lng: 181 }],
    ["lat as text", { lat: "-0.4" }],
    ["a footprint under 10 m2", { footprintM2: 9 }],
    ["a footprint over 50.000 m2", { footprintM2: 50_001 }],
    ["a negative height", { heightM: -1 }],
    ["an unknown building type", { buildingType: "istana" }],
    ["fractional floors", { floors: 1.5 }],
    ["zero floors", { floors: 0 }],
    ["41 floors", { floors: 41 }],
    ["a negative kwhMonth", { kwhMonth: -5 }],
    ["a kwhMonth of 0", { kwhMonth: 0 }],
    ["a text bill", { billRpMonth: "banyak" }],
    ["a missing interestedPv", { interestedPv: undefined }],
    ["a text consentMap", { consentMap: "ya" }],
  ])("%s is a 400 and saves nothing", async (_what, patch) => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const res = await put(server, cookie, { ...HOME, ...patch });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.homes.size).toBe(0);
  });

  test("a body that is not an object is a 400", () => {
    expect("problem" in parseHomeInput([1])).toBe(true);
    expect("problem" in parseHomeInput(null)).toBe(true);
  });

  test("missing heightM, kwhMonth and billRpMonth count as null", () => {
    const { heightM: _h, kwhMonth: _k, billRpMonth: _b, ...rest } = HOME;
    const parsed = parseHomeInput(rest);
    expect("input" in parsed && parsed.input).toMatchObject({ heightM: null, kwhMonth: null, billRpMonth: null });
  });
});

describe("DELETE /api/me/home", () => {
  test("removes the home with a 204", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    await put(server, cookie, HOME);
    const res = await send(server, "DELETE", cookie);
    expect(res.status).toBe(204);
    expect(await (await send(server, "GET", cookie)).json()).toEqual({ home: null });
  });
});

// ---------- the chat knows the signed-in resident's home, and nobody else's ----------

/** A chat model that records its requests; with `callTool` it first asks for get_my_home. */
function recordingModel(callTool: boolean) {
  const calls: Anthropic.MessageStreamParams[] = [];
  const model: ChatModel = (params) => {
    calls.push(structuredClone(params));
    const first = calls.length === 1 && callTool;
    const content = first
      ? [{ type: "tool_use", id: "toolu_1", name: "get_my_home", input: {}, caller: { type: "direct" } }]
      : [{ type: "text", text: "Siap.", citations: null }];
    const message = {
      id: "msg",
      type: "message",
      role: "assistant",
      model: CHAT_MODEL,
      content,
      stop_reason: first ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Message;
    return {
      async *[Symbol.asyncIterator]() {},
      finalMessage: async () => message,
    };
  };
  return { model, calls };
}

const CHAT = {
  sessionId: "6f1c2b9e-3d4a-4e5f-8a7b-9c0d1e2f3a4b",
  message: "Berapa panel surya untuk rumah saya?",
  context: { selectedRegionId: null, selectedBuilding: null, view: { center: [117.15, -0.5], zoom: 9 } },
};
const chat = (s: Server<undefined>, cookie?: string) =>
  fetch(new URL("/api/chat", s.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(CHAT),
  });

const toolNames = (p: Anthropic.MessageStreamParams) => (p.tools ?? []).map((t) => ("name" in t ? t.name : ""));
const promptText = (p: Anthropic.MessageStreamParams) => JSON.stringify(p.messages);

describe("chat with a signed-in resident", () => {
  test("adds the home to the prompt and offers get_my_home, which returns the home and a solar simulation", async () => {
    const m = recordingModel(true);
    const { server, fake } = start({ chat: m.model });
    const { cookie } = await fake.signIn("warga");
    await put(server, cookie, { ...HOME, kwhMonth: 250 });
    const res = await chat(server, cookie);
    expect(res.status).toBe(200);
    await res.text();

    const first = m.calls[0]!;
    expect(promptText(first)).toContain("Rumah pengguna yang sedang masuk");
    expect(promptText(first)).toContain("Samarinda");
    expect(promptText(first)).toContain("3.000 kWh");
    expect(toolNames(first).at(-1)).toBe("get_my_home");

    // The second request carries the tool result.
    const result = JSON.stringify(m.calls[1]!.messages.at(-1));
    expect(result).toContain("tool_result");
    expect(result).toContain("kwhSource");
    expect(result).toContain("systemText");
    expect(result).toContain("10,5 kWp");
  });

  test("guests and government accounts keep the old prompt and tools, and cannot call get_my_home", async () => {
    const baseline = recordingModel(false);
    const a = start({ chat: baseline.model });
    await (await chat(a.server)).text();

    const guest = recordingModel(true);
    const b = start({ chat: guest.model });
    await (await chat(b.server)).text();
    expect(toolNames(guest.calls[0]!)).not.toContain("get_my_home");
    expect(toolNames(guest.calls[0]!)).toEqual(toolNames(baseline.calls[0]!));
    expect(promptText(guest.calls[0]!)).not.toContain("Rumah pengguna");
    // A tool call for it anyway gets an error result, not data.
    expect(JSON.stringify(guest.calls[1]!.messages.at(-1))).toContain("is_error");

    const pemda = recordingModel(false);
    const c = start({ chat: pemda.model });
    const { cookie } = await c.fake.signIn("pemda");
    await (await chat(c.server, cookie)).text();
    expect(toolNames(pemda.calls[0]!)).not.toContain("get_my_home");
    expect(promptText(pemda.calls[0]!)).not.toContain("Rumah pengguna");
  });

  test("a resident without a home, or another resident's home, never shows up", async () => {
    const m = recordingModel(false);
    const { server, fake } = start({ chat: m.model });
    const owner = await fake.signIn("warga", { name: "Pemilik Rumah" });
    await put(server, owner.cookie, { ...HOME, kwhMonth: 777 });
    const other = await fake.signIn("warga");
    await (await chat(server, other.cookie)).text();
    expect(promptText(m.calls[0]!)).not.toContain("Rumah pengguna");
    expect(promptText(m.calls[0]!)).not.toContain("9.324");
    expect(toolNames(m.calls[0]!)).not.toContain("get_my_home");
  });

  test("a home sent in the request body is ignored", async () => {
    const m = recordingModel(false);
    const { server } = start({ chat: m.model });
    const res = await fetch(new URL("/api/chat", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...CHAT, context: { ...CHAT.context, myHome: { regionName: "Palsu" } } }),
    });
    await res.text();
    expect(promptText(m.calls[0]!)).not.toContain("Palsu");
  });
});
