import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { PotentialCollection } from "../../src/web/api.ts";
import { fakeDeps } from "./fakes.ts";

let server: Server<undefined>;

beforeAll(() => {
  server = createServer({ port: 0, deps: fakeDeps().deps });
});

afterAll(() => {
  server.stop(true);
});

describe("GET /api/potential", () => {
  test("returns the cells, their source once, and the PLTS and turbine assumptions", async () => {
    const res = await fetch(new URL("/api/potential", server.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PotentialCollection;
    expect(body.type).toBe("FeatureCollection");
    expect(body.features[0]!.properties.regionId).toBe("samarinda");
    expect(body.source).toBe("NASA POWER");
    expect(body.assumptions.wind.hubHeightM).toBe(100);
    expect(body.assumptions.pv.performanceRatio).toBeGreaterThan(0);
  });
});
