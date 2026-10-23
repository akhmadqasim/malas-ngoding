import { describe, expect, spyOn, test } from "bun:test";
import { createCurrentWindLookup } from "../../src/server/services/currentWind.ts";
import { windRoutes } from "../../src/server/routes/wind.ts";
import { fakeDeps } from "./fakes.ts";

const now = Date.parse("2026-10-22T04:07:00Z");
const body = (speed: unknown = 5, direction: unknown = 360, time: unknown = "2026-10-22T12:00") =>
  ({ current: { wind_speed_10m: speed, wind_direction_10m: direction, time } });
const fetcher = (data: unknown) => (async () => Response.json(data)) as unknown as typeof fetch;

describe("current wind source", () => {
  test("requests the current model, m/s, local time and normalises north", async () => {
    let seen: URL | undefined;
    const fetch = (async (url: URL) => { seen = url; return Response.json(body()); }) as unknown as unknown as typeof globalThis.fetch;
    const reading = await createCurrentWindLookup({ fetch, now: () => now })(-0.512, 117.153);
    expect(seen!.searchParams.get("current")).toBe("wind_speed_10m,wind_direction_10m");
    expect(seen!.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(seen!.searchParams.get("latitude")).toBe("-0.5");
    expect(reading).toEqual({ speedMs: 5, fromDeg: 0, heightM: 10, time: "2026-10-22T12:00" });
  });
  test("rejects missing, invalid, ancient and future model readings", async () => {
    for (const data of [body(null), body(-1), body(5, 361), body(5, null), body(5, 0, "bad"), body(5, 0, "2026-10-21T12:00"), body(5, 0, "2026-10-23T12:00")]) {
      await expect(createCurrentWindLookup({ fetch: fetcher(data), now: () => now })(0, 117)).rejects.toThrow();
    }
  });
  test("rejects upstream failure", async () => {
    const fetch = (async () => Response.json({}, { status: 429 })) as unknown as typeof globalThis.fetch;
    await expect(createCurrentWindLookup({ fetch, now: () => now })(0, 117)).rejects.toThrow("429");
  });
});

describe("wind route", () => {
  const req = (params = "lat=-0.5&lng=117.15") => new Request(`http://localhost/api/wind?${params}`);
  test("validates coordinates before calling upstream", async () => {
    const deps = fakeDeps().deps;
    let calls = 0; deps.wind = async () => { calls++; throw new Error(); };
    const get = (windRoutes(deps)["/api/wind"] as { GET: (r: Request) => Promise<Response> }).GET;
    for (const params of ["", "lat=&lng=0", "lat=91&lng=0", "lat=0&lng=181", "lat=x&lng=0"]) expect((await get(req(params))).status).toBe(400);
    expect(calls).toBe(0);
  });
  test("coalesces concurrent requests and caches the source timestamp", async () => {
    const deps = fakeDeps().deps;
    let calls = 0;
    deps.wind = async () => { calls++; await Promise.resolve(); return { speedMs: 2, fromDeg: 45, heightM: 10, time: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16) }; };
    const get = (windRoutes(deps)["/api/wind"] as { GET: (r: Request) => Promise<Response> }).GET;
    const responses = await Promise.all([get(req()), get(req()), get(req())]);
    expect(calls).toBe(1);
    const result = await responses[0]!.json();
    expect(result.stale).toBe(false); expect(result.current.wind.speedMs).toBe(2);
    expect(result.source).toBe("Open-Meteo");
    expect(await (await get(req())).json()).toEqual(result);
    expect(calls).toBe(1);
  });
  test("returns unavailable when no source or cached reading exists", async () => {
    const deps = fakeDeps().deps;
    const get = (windRoutes(deps)["/api/wind"] as { GET: (r: Request) => Promise<Response> }).GET;
    expect((await get(req())).status).toBe(503);
    deps.wind = async () => { throw new Error("offline"); };
    expect((await get(req())).status).toBe(503);
  });
  test("expires the minute cache and marks fallback stale, then refuses ancient wind", async () => {
    const deps = fakeDeps().deps;
    const started = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(started);
    let calls = 0;
    deps.wind = async () => {
      calls++;
      if (calls > 1) throw new Error("offline");
      return { speedMs: 2, fromDeg: 90, heightM: 10, time: new Date(started + 8 * 3600_000).toISOString().slice(0, 16) };
    };
    try {
      const get = (windRoutes(deps)["/api/wind"] as { GET: (r: Request) => Promise<Response> }).GET;
      const first = await (await get(req())).json();
      clock.mockReturnValue(started + 61_000);
      const fallback = await (await get(req())).json();
      expect(fallback.stale).toBe(true);
      expect(fallback.fetchedAt).toBe(first.fetchedAt);
      expect(calls).toBe(2);
      clock.mockReturnValue(started + 46 * 60_000);
      expect((await get(req())).status).toBe(503);
    } finally { clock.mockRestore(); }
  });
});
