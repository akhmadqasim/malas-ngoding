import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { ScenarioBasis } from "../../src/shared/scenario.ts";
import { fakeDeps } from "./fakes.ts";

let server: Server<undefined>;

beforeAll(() => {
  server = createServer({ port: 0, deps: fakeDeps().deps });
});

afterAll(() => {
  server.stop(true);
});

describe("GET /api/scenario", () => {
  test("returns the costs, the factors and sun hours for every region", async () => {
    const res = await fetch(new URL("/api/scenario", server.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ScenarioBasis;
    expect(body.costRpPerKwp).toBe(15_000_000);
    expect(body.solarFactorKgPerKwh).toBe(1.13);
    expect(body.gridSolarShare).toBeGreaterThanOrEqual(0);
    expect(body.regions).toHaveLength(10);
    for (const r of body.regions) expect(r.peakSunHours).toBeGreaterThan(0);
  });
});
