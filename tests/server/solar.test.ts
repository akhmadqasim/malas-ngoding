import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { SolarSimulation } from "../../src/server/routes/solar.ts";
import { type FakeDeps, type FakeUpstreams, fakeDeps } from "./fakes.ts";

const BODY = { lat: -0.5, lng: 117.15, roofAreaM2: 100, kwhYear: 5000, backupHours: 4 };
const NASA = { pshByMonth: [4.5, 5, 5, 4.9, 4.7, 4.3, 4.6, 5, 5.1, 4.9, 4.6, 4.5], pshYear: 4.77 };

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(upstreams: FakeUpstreams = {}): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps(null, upstreams);
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const post = (s: Server<undefined>, body: unknown) =>
  fetch(new URL("/api/solar/simulate", s.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/solar/simulate", () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("returns finite numbers and the peak sun hours from NASA", async () => {
    const { server, fake } = start({ nasa: NASA });
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    const out = (await res.json()) as SolarSimulation;
    expect(out.peakSunHours).toBe(4.77);
    expect(out.pshByMonth).toEqual(NASA.pshByMonth);
    for (const k of ["kWp", "panels", "kwhYear", "coveragePct", "batteryKwh", "costRp", "savingRpYear", "paybackYears", "co2AvoidedKgYear"] as const) {
      expect(Number.isFinite(out[k])).toBe(true);
    }
    expect(out.kWp).toBeGreaterThan(0);
    expect(out.co2AvoidedKgYear).toBeGreaterThan(0);
    expect(out.assumptions.some((a) => /NASA/.test(a))).toBe(false);
    expect(fake.nasaCalls).toEqual([[-0.5, 117.15]]);
    // Cached under coordinates rounded to 0.1 degree.
    expect(fake.stored.get("solar_climatology:-0.5,117.2")).toEqual(NASA);
  });

  test("uses the seed tariff, costs and grid factor", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, BODY)).json()) as SolarSimulation;
    // Grid factor 1.14 kg/kWh (fake grid), tariff Rp 1.444,7 and Rp 15 jt/kWp from the seed.
    const usedKwh = (out.coveragePct / 100) * BODY.kwhYear;
    expect(out.co2AvoidedKgYear).toBeCloseTo(usedKwh * 1.14, 6);
    expect(out.savingRpYear).toBeCloseTo(usedKwh * 1444.7, 3);
    expect(out.costRp).toBeCloseTo(out.kWp * 15_000_000 + out.batteryKwh * 2_500_000, 3);
  });

  test("a second call for a nearby point is served from the climatology cache", async () => {
    const { server, fake } = start({ nasa: NASA });
    await post(server, BODY);
    await post(server, { ...BODY, lat: -0.52, lng: 117.17 });
    expect(fake.nasaCalls).toHaveLength(1);
  });

  test("NASA down and nothing cached falls back to 4.2 peak sun hours with a note, and is not cached", async () => {
    const { server, fake } = start({ nasa: new Error("nasa down") });
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    const out = (await res.json()) as SolarSimulation;
    expect(out.peakSunHours).toBe(4.2);
    expect(out.pshByMonth).toEqual(Array(12).fill(4.2));
    expect(out.assumptions.some((a) => a.includes("NASA POWER") && a.includes("4,2"))).toBe(true);
    expect(Number.isFinite(out.kwhYear) && out.kWp > 0).toBe(true);
    expect(fake.stored.size).toBe(0);
  });

  test("a failing climatology cache still returns a result", async () => {
    const { server, fake } = start({ nasa: NASA });
    fake.deps.db.climatologyGet = async () => {
      throw new Error("db down");
    };
    fake.deps.db.climatologySet = async () => {
      throw new Error("db down");
    };
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as SolarSimulation).peakSunHours).toBe(4.77);
  });

  test("an extreme roof is clamped and the result stays finite", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, { ...BODY, roofAreaM2: 1e12, kwhYear: 1e15, backupHours: 1e9 })).json()) as SolarSimulation;
    for (const k of ["kWp", "kwhYear", "coveragePct", "batteryKwh", "costRp", "paybackYears"] as const) {
      expect(Number.isFinite(out[k])).toBe(true);
    }
    expect(out.kWp).toBeLessThanOrEqual((50_000 * 0.6) / 5.5);
  });

  test.each([
    ["lat out of range", { ...BODY, lat: 91 }],
    ["lng is a string", { ...BODY, lng: "x" }],
    ["roof is zero", { ...BODY, roofAreaM2: 0 }],
    ["roof is missing", { ...BODY, roofAreaM2: undefined }],
    ["kwhYear is negative", { ...BODY, kwhYear: -5 }],
    ["backupHours is null", { ...BODY, backupHours: null }],
    ["backupHours is negative", { ...BODY, backupHours: -1 }],
    ["body is an array", [1]],
    ["body is not json", "nope{"],
  ])("invalid body (%s) returns 400 with an error", async (_n, body) => {
    const { server, fake } = start({ nasa: NASA });
    const res = await post(server, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.nasaCalls).toHaveLength(0);
  });
});
