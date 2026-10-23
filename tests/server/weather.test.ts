import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { currentConditions } from "../../src/server/routes/weather.ts";
import { cachedForecast } from "../../src/server/services/cache.ts";
import type { ForecastHour } from "../../src/shared/pvForecast.ts";
import type { PvHour } from "../../src/shared/types.ts";
import { type FakeDeps, type FakeUpstreams, fakeDeps } from "./fakes.ts";

interface WeatherBody {
  hours: PvHour[];
  days: { date: string; pvKwh: number; rainy: boolean; maxPrecipMm: number }[];
  current: { raining: boolean; cloudPct: number; precipMm: number; isDay: boolean };
  stale: boolean;
}

const WITA_MS = 8 * 3600_000;
/** Local WITA time string ("YYYY-MM-DDTHH:00") for a UTC ms timestamp. */
const wita = (ms: number) => new Date(ms + WITA_MS).toISOString().slice(0, 13) + ":00";
const CACHE_KEY = "weather_cache:-0.50,117.15";

/** 72 hours starting 24 h ago; the middle 24 hours are rainy. */
function forecast(): ForecastHour[] {
  const start = Math.floor(Date.now() / 3600_000) * 3600_000 - 24 * 3600_000;
  return Array.from({ length: 72 }, (_, i) => {
    const rainy = i >= 24 && i < 48;
    return {
      time: wita(start + i * 3600_000),
      ghiWm2: 500,
      cloudPct: rainy ? 90 : 20,
      precipMm: rainy ? 2 : 0,
      weatherCode: rainy ? 63 : 1,
    };
  });
}

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

const get = (s: Server<undefined>, qs = "lat=-0.5&lng=117.15&kWp=3") => fetch(new URL(`/api/weather?${qs}`, s.url));

describe("GET /api/weather", () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("computes pv per hour, marks the rainy day and reports current conditions", async () => {
    const { server, fake } = start({ meteo: forecast() });
    const res = await get(server);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeatherBody;
    expect(body.stale).toBe(false);
    expect(body.hours).toHaveLength(72);
    // 3 kWp x 500 W/m2 / 1000 x PR 0.78
    expect(body.hours[0]?.pvKwh).toBeCloseTo(3 * 0.5 * 0.78, 6);
    expect(body.days.some((d) => d.rainy && d.maxPrecipMm === 2)).toBe(true);
    expect(body.days.some((d) => !d.rainy)).toBe(true);
    expect(typeof body.current.raining).toBe("boolean");
    expect(body.current.isDay).toBe(true);
    expect(Number.isFinite(body.current.cloudPct)).toBe(true);
    expect(fake.stored.get(CACHE_KEY)?.hours).toHaveLength(72);
  });

  test("a fresh cached forecast is served without calling Open-Meteo, for a nearby point and another kWp", async () => {
    const { server, fake } = start({ meteo: forecast() });
    await get(server);
    const body = (await (await get(server, "lat=-0.51&lng=117.14&kWp=1")).json()) as WeatherBody;
    expect(fake.meteoCalls).toHaveLength(1);
    expect(body.hours[0]?.pvKwh).toBeCloseTo(0.5 * 0.78, 6);
  });

  test("a cache row older than one hour is refreshed", async () => {
    const { server, fake } = start({ meteo: forecast() });
    await get(server);
    fake.ages.set(CACHE_KEY, new Date(Date.now() - 61 * 60_000));
    const body = (await (await get(server)).json()) as WeatherBody;
    expect(fake.meteoCalls).toHaveLength(2);
    expect(body.stale).toBe(false);
  });

  test("upstream down with a cached forecast of any age returns it with stale true", async () => {
    const { server, fake } = start({ meteo: new Error("open-meteo down") });
    fake.stored.set(CACHE_KEY, { hours: forecast() });
    fake.ages.set(CACHE_KEY, new Date(Date.now() - 3 * 24 * 3600_000));
    const res = await get(server);
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeatherBody;
    expect(body.stale).toBe(true);
    expect(body.hours).toHaveLength(72);
    expect(fake.meteoCalls).toHaveLength(1);
  });

  test("upstream down and nothing cached returns 503 with a friendly message", async () => {
    const { server } = start({ meteo: new Error("open-meteo down") });
    const res = await get(server);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Prakiraan cuaca sedang tidak tersedia" });
  });

  test("an empty forecast counts as a failure", async () => {
    const { server } = start({ meteo: [] });
    expect((await get(server)).status).toBe(503);
  });

  test("a failing weather cache still returns the live forecast", async () => {
    const { server, fake } = start({ meteo: forecast() });
    fake.deps.db.cacheGetAged = async () => {
      throw new Error("db down");
    };
    fake.deps.db.cacheSet = async () => {
      throw new Error("db down");
    };
    const res = await get(server);
    expect(res.status).toBe(200);
    expect(((await res.json()) as WeatherBody).stale).toBe(false);
  });

  test.each([
    ["lat missing", "lng=117&kWp=1"],
    ["lat empty", "lat=&lng=117&kWp=1"],
    ["lat out of range", "lat=95&lng=117&kWp=1"],
    ["lng not a number", "lat=-0.5&lng=abc&kWp=1"],
    ["kWp missing", "lat=-0.5&lng=117"],
    ["kWp negative", "lat=-0.5&lng=117&kWp=-2"],
  ])("invalid query (%s) returns 400", async (_n, qs) => {
    const { server, fake } = start({ meteo: forecast() });
    const res = await get(server, qs);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.meteoCalls).toHaveLength(0);
  });
});

describe("currentConditions", () => {
  test("includes current wind only when present and recent", () => {
    const now = Date.now();
    const hour = { time: wita(now), ghiWm2: 0, cloudPct: 40, precipMm: 0, weatherCode: 2, windSpeedMs: 5, windFromDeg: 90 };
    expect(currentConditions([hour], now).wind).toMatchObject({ speedMs: 5, fromDeg: 90, heightM: 10 });
    expect(currentConditions([hour], now + 4 * 3600000).wind).toBeUndefined();
  });
  const base = { cloudPct: 40, precipMm: 0, weatherCode: 2 };
  // 2026-10-21 12:00 WITA is 04:00 UTC.
  const noon = Date.UTC(2026, 9, 21, 4, 0);
  const hours: ForecastHour[] = [
    { ...base, time: "2026-10-21T11:00", ghiWm2: 0, precipMm: 3, weatherCode: 63 },
    { ...base, time: "2026-10-21T12:00", ghiWm2: 600 },
    { ...base, time: "2026-10-21T13:00", ghiWm2: 0, precipMm: 3, weatherCode: 63 },
  ];

  test("reads the hour nearest to now in WITA time", () => {
    expect(currentConditions(hours, noon)).toEqual({ raining: false, cloudPct: 40, precipMm: 0, isDay: true });
    expect(currentConditions(hours, noon + 40 * 60_000)).toMatchObject({ raining: true, precipMm: 3, isDay: false });
    expect(currentConditions(hours, noon - 40 * 60_000)).toMatchObject({ raining: true, isDay: false });
  });

  test("a rain weather code counts as raining even with no measured precipitation", () => {
    const drizzle = [{ ...base, time: "2026-10-21T12:00", ghiWm2: 100, weatherCode: 61 }];
    expect(currentConditions(drizzle, noon).raining).toBe(true);
  });

  test("an empty forecast gives dry night conditions", () => {
    expect(currentConditions([], noon)).toEqual({ raining: false, cloudPct: 0, precipMm: 0, isDay: false });
  });
});

describe("cachedForecast", () => {
  test("a wind request upgrades a fresh old cache whose forecast has no wind fields", async () => {
    const hours = forecast().map(h => ({ ...h, windSpeedMs: 4, windFromDeg: 120 }));
    const fake = fakeDeps(null, { meteo: hours });
    fake.stored.set(CACHE_KEY, { hours: forecast() });
    fake.ages.set(CACHE_KEY, new Date());
    const out = await cachedForecast(fake.deps, -0.5, 117.15, Date.now(), true);
    expect(fake.meteoCalls).toHaveLength(1);
    expect(out?.hours[0]?.windFromDeg).toBe(120);
    await cachedForecast(fake.deps, -0.5, 117.15, Date.now(), true);
    expect(fake.meteoCalls).toHaveLength(1);
  });
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("callers that arrive while a live call is running share it", async () => {
    const fake = fakeDeps(null, { meteo: forecast() });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const deps = {
      db: fake.deps.db,
      meteo: async () => {
        calls++;
        await gate;
        return forecast();
      },
    };
    const first = cachedForecast(deps, -0.5, 117.15);
    const second = cachedForecast(deps, -0.51, 117.14); // same 0.05 degree cache key
    await Bun.sleep(10);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a?.hours).toHaveLength(72);
    expect(b?.hours).toHaveLength(72);
    // Once it has finished, the next miss calls the upstream again.
    fake.ages.set(CACHE_KEY, new Date(Date.now() - 2 * 3600_000));
    await cachedForecast(deps, -0.5, 117.15);
    expect(calls).toBe(2);
  });

  test("a cached payload with a malformed hour is ignored, not trusted", async () => {
    const fake = fakeDeps(null, { meteo: forecast() });
    fake.stored.set(CACHE_KEY, { hours: [{ time: "2026-10-21T00:00", ghiWm2: "500" }] });
    fake.ages.set(CACHE_KEY, new Date());
    const out = await cachedForecast(fake.deps, -0.5, 117.15);
    expect(fake.meteoCalls).toHaveLength(1);
    expect(out?.hours).toHaveLength(72);
    expect(out?.stale).toBe(false);
  });
});
