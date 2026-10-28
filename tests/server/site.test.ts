import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { candidates, findSite, RINGS_KM, type SiteAnswer } from "../../src/server/routes/site.ts";
import { checkFrom, isClear } from "../../src/server/services/siteCheck.ts";
import { fakeDeps } from "./fakes.ts";

const town = { buildings: 30, settlement: true, water: false, protectedLand: false };
const clear = { buildings: 0, settlement: false, water: false, protectedLand: false };

describe("checkFrom", () => {
  test("counts buildings and spots settled land and water", () => {
    const c = checkFrom([
      { properties: { tilequery: { layer: "building" } } },
      { properties: { tilequery: { layer: "building" } } },
      { properties: { class: "wood", tilequery: { layer: "landuse" } } },
      { properties: { class: "residential", tilequery: { layer: "landuse" } } },
      { properties: { class: "river", tilequery: { layer: "water" } } },
      { properties: { class: "wetland", tilequery: { layer: "landuse_overlay" } } },
    ]);
    expect(c).toEqual({ buildings: 2, settlement: true, water: true, protectedLand: true });
    expect(isClear(checkFrom([{ properties: { class: "agriculture", tilequery: { layer: "landuse" } } }]))).toBe(true);
  });
});

describe("findSite", () => {
  test("keeps a clear spot as it is", async () => {
    const { deps } = fakeDeps();
    const r = await findSite(deps, [117, -0.5], 400);
    expect(r).toEqual({ at: [117, -0.5], movedKm: 0, clear: true, asked: clear });
  });

  test("moves off a town to the nearest clear spot inside Kaltim", async () => {
    // A town of about 2 km around 117, -0.5 (inside the fake Samarinda).
    const { deps } = fakeDeps(null, { site: (lng, lat) => (Math.hypot(lng - 117, lat + 0.5) < 0.02 ? town : clear) });
    const r = await findSite(deps, [117, -0.5], 400);
    expect(r.clear).toBe(true);
    expect(r.movedKm).toBe(3);
    expect(r.asked).toEqual(town);
  });

  test("says so when nothing near is clear", async () => {
    const { deps } = fakeDeps(null, { site: () => town });
    const r = await findSite(deps, [117, -0.5], 400);
    expect(r).toEqual({ at: [117, -0.5], movedKm: 0, clear: false, asked: town });
  });

  test("candidates go round each ring, nearest first", () => {
    const c = candidates([117, -0.5]);
    expect(c[0]).toEqual({ at: [117, -0.5], km: 0 });
    expect(c).toHaveLength(1 + (RINGS_KM.length - 1) * 8);
    expect(c.map((x) => x.km)).toEqual([...c.map((x) => x.km)].sort((a, b) => a - b));
  });
});

describe("GET /api/site", () => {
  let server: Server<undefined>;
  beforeAll(() => {
    server = createServer({ port: 0, deps: fakeDeps(null, { site: () => clear }).deps });
  });
  afterAll(() => server.stop(true));
  const get = (q: string) => fetch(new URL(`/api/site?${q}`, server.url));

  test("answers with the spot", async () => {
    const res = await get("lng=117&lat=-0.5&radius=500");
    expect(res.status).toBe(200);
    expect(((await res.json()) as SiteAnswer).clear).toBe(true);
  });

  test("rejects bad input with a JSON error", async () => {
    for (const q of ["lng=117&lat=-0.5", "lng=x&lat=-0.5&radius=1", "lng=117&lat=99&radius=1"]) {
      const res = await get(q);
      expect(res.status).toBe(400);
      expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
    }
  });

  test("a failing Mapbox is a 503", async () => {
    const s = createServer({ port: 0, deps: fakeDeps(null, { site: new Error("down") }).deps });
    const res = await fetch(new URL("/api/site?lng=117&lat=-0.5&radius=500", s.url));
    expect(res.status).toBe(503);
    s.stop(true);
  });
});
