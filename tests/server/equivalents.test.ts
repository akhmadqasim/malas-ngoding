import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { EquivalentFactor } from "../../src/shared/types.ts";
import { fakeDeps } from "./fakes.ts";

let server: Server<undefined>;
beforeAll(() => {
  server = createServer({ port: 0, deps: fakeDeps().deps });
});
afterAll(() => {
  server.stop(true);
});

describe("GET /api/equivalents", () => {
  test("returns the equivalence factors the building estimate uses", async () => {
    const res = await fetch(new URL("/api/equivalents", server.url));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EquivalentFactor[];
    expect(body.length).toBeGreaterThan(0);
    for (const f of body) {
      expect(typeof f.key).toBe("string");
      expect(f.kgCo2PerUnit).toBeGreaterThan(0);
    }
  });
});
