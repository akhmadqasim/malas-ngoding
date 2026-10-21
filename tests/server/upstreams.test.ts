import { describe, expect, test } from "bun:test";
import { climatologyKey, createNasaLookup } from "../../src/server/services/nasaPower.ts";
import { createMeteoLookup, weatherKey } from "../../src/server/services/openMeteo.ts";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const nasaBody = (patch: Record<string, number> = {}) => ({
  properties: {
    parameter: {
      ALLSKY_SFC_SW_DWN: { ...Object.fromEntries(MONTHS.map((m, i) => [m, 4 + i / 10])), ANN: 4.5, ...patch },
    },
  },
});
const respond = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;
const hangs = (async (_u: string, init?: RequestInit) =>
  new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;

describe("createNasaLookup", () => {
  test("asks the climatology endpoint for ALLSKY_SFC_SW_DWN at 0.1 degree and parses months and year", async () => {
    let seen = "";
    const fetcher = (async (url: string) => {
      seen = url;
      return Response.json(nasaBody());
    }) as unknown as typeof fetch;
    const out = await createNasaLookup({ fetch: fetcher })(-0.5123, 117.1789);
    const u = new URL(seen);
    expect(u.pathname).toBe("/api/temporal/climatology/point");
    expect(u.searchParams.get("parameters")).toBe("ALLSKY_SFC_SW_DWN");
    expect(u.searchParams.get("community")).toBe("RE");
    expect(u.searchParams.get("latitude")).toBe("-0.5");
    expect(u.searchParams.get("longitude")).toBe("117.2");
    expect(out.pshByMonth).toHaveLength(12);
    expect(out.pshByMonth[0]).toBe(4);
    expect(out.pshYear).toBe(4.5);
  });

  test("uses the mean of the months when the annual value is a fill value", async () => {
    const out = await createNasaLookup({ fetch: respond(nasaBody({ ANN: -999 })) })(0, 117);
    expect(out.pshYear).toBeCloseTo(4.55, 6);
  });

  test("throws on a fill value, a missing parameter, an HTTP error and a timeout", async () => {
    const lookup = (f: typeof fetch) => createNasaLookup({ fetch: f })(0, 117);
    await expect(lookup(respond(nasaBody({ JUN: -999 })))).rejects.toThrow(/incomplete/);
    await expect(lookup(respond({ properties: {} }))).rejects.toThrow(/no ALLSKY/);
    await expect(lookup(respond({}, 429))).rejects.toThrow(/HTTP 429/);
    await expect(createNasaLookup({ fetch: hangs, timeoutMs: 20 })(0, 117)).rejects.toThrow(/timed out/);
  });

  test("keys on coordinates rounded to 0.1", () => {
    expect(climatologyKey(-0.5123, 117.1789)).toBe("-0.5,117.2");
    expect(climatologyKey(-0.52, 117.17)).toBe("-0.5,117.2");
  });
});

describe("createMeteoLookup", () => {
  const body = {
    hourly: {
      time: ["2026-10-21T00:00", "2026-10-21T01:00"],
      shortwave_radiation: [0, 120.5],
      cloud_cover: [84, 100],
      precipitation: [0, 1.2],
      weather_code: [3, 61],
    },
  };

  test("requests the four hourly variables for 7 days in Asia/Makassar and maps the columns", async () => {
    let seen = "";
    const fetcher = (async (url: string) => {
      seen = url;
      return Response.json(body);
    }) as unknown as typeof fetch;
    const hours = await createMeteoLookup({ fetch: fetcher })(-0.5, 117.15);
    const u = new URL(seen);
    expect(u.searchParams.get("hourly")).toBe("shortwave_radiation,cloud_cover,precipitation,weather_code");
    expect(u.searchParams.get("forecast_days")).toBe("7");
    expect(u.searchParams.get("timezone")).toBe("Asia/Makassar");
    expect(hours).toEqual([
      { time: "2026-10-21T00:00", ghiWm2: 0, cloudPct: 84, precipMm: 0, weatherCode: 3 },
      { time: "2026-10-21T01:00", ghiWm2: 120.5, cloudPct: 100, precipMm: 1.2, weatherCode: 61 },
    ]);
  });

  test("leaves out an hour with a missing value instead of reading null as a clear, dry hour", async () => {
    const sparse = {
      hourly: {
        time: ["2026-10-21T00:00", "2026-10-21T01:00", "2026-10-21T02:00", "2026-10-21T03:00"],
        shortwave_radiation: [0, null, 300, 400],
        cloud_cover: [84, 50, null, 20],
        precipitation: [0, 0, 0, null],
        weather_code: [3, 3, 3, 1],
      },
    };
    const hours = await createMeteoLookup({ fetch: respond(sparse) })(-0.5, 117.15);
    expect(hours.map((h) => h.time)).toEqual(["2026-10-21T00:00"]);
    const allMissing = { hourly: { time: ["2026-10-21T00:00"], shortwave_radiation: [null] } };
    await expect(createMeteoLookup({ fetch: respond(allMissing) })(0, 117)).rejects.toThrow(/empty/);
  });

  test("throws on an empty forecast, an HTTP error and a timeout", async () => {
    const lookup = (f: typeof fetch) => createMeteoLookup({ fetch: f })(0, 117);
    await expect(lookup(respond({ hourly: { time: [] } }))).rejects.toThrow(/empty/);
    await expect(lookup(respond({}))).rejects.toThrow(/empty/);
    await expect(lookup(respond({}, 500))).rejects.toThrow(/HTTP 500/);
    await expect(createMeteoLookup({ fetch: hangs, timeoutMs: 20 })(0, 117)).rejects.toThrow(/timed out/);
  });

  test("keys on coordinates rounded to 0.05", () => {
    expect(weatherKey(-0.5123, 117.1789)).toBe("-0.50,117.20");
    expect(weatherKey(-0.53, 117.14)).toBe("-0.55,117.15");
  });
});
