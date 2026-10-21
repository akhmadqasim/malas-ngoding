import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { env } from "../../src/server/env.ts";
import { publicMapboxToken } from "../../src/server/routes/config.ts";
import type { RegionSummary } from "../../src/shared/types.ts";
import { fakeDeps } from "./fakes.ts";

let server: Server<undefined>;

beforeAll(() => {
  server = createServer({ port: 0, deps: fakeDeps().deps });
});

afterAll(() => {
  server.stop(true);
});

const get = (path: string) => fetch(new URL(path, server.url));

describe("data routes", () => {
  test("GET /api/regions returns 10 features with kwhYear > 0", async () => {
    const res = await get("/api/regions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; features: { properties: RegionSummary }[] };
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(10);
    for (const f of body.features) expect(f.properties.kwhYear).toBeGreaterThan(0);
  });

  test("GET /api/regions/:id returns the summary with a [lng, lat] centroid", async () => {
    const res = await get("/api/regions/samarinda");
    expect(res.status).toBe(200);
    const body = (await res.json()) as RegionSummary & { centroid: [number, number] };
    expect(body.id).toBe("samarinda");
    expect(body.kwhYear).toBeGreaterThan(0);
    expect(body.centroid).toEqual([117.15, -0.5]);
  });

  test("GET /api/regions/nope returns a 404 json error", async () => {
    const res = await get("/api/regions/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("GET /api/plants returns a FeatureCollection", async () => {
    const res = await get("/api/plants");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { type: string }).type).toBe("FeatureCollection");
  });

  test("GET /api/grid returns the grid mix", async () => {
    const res = await get("/api/grid");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { factorKgPerKwh: number; year: number };
    expect(body.factorKgPerKwh).toBe(1.14);
    expect(body.year).toBe(2023);
  });

  test("GET /api/config returns the configured public mapbox token", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mapboxToken: publicMapboxToken(env.mapboxToken) });
  });

  test("only a public (pk.) mapbox token is ever sent to the browser", () => {
    expect(publicMapboxToken("pk.abc.def")).toBe("pk.abc.def");
    expect(publicMapboxToken("sk.abc.def")).toBe("");
    expect(publicMapboxToken("")).toBe("");
  });
});
