import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { BuildingEstimate } from "../../src/shared/types.ts";
import { type FakeDeps, fakeDeps } from "./fakes.ts";

const SAMARINDA = { featureId: "b1", lng: 117.15, lat: -0.5, footprintM2: 400, heightM: 7 };
const SCHOOL = { class: "education", type: "School", name: "SMA 1", distanceM: 6 };

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(fake: FakeDeps): Server<undefined> {
  const s = createServer({ port: 0, deps: fake.deps });
  servers.push(s);
  return s;
}

const post = (s: Server<undefined>, body: unknown) =>
  fetch(new URL("/api/buildings/estimate", s.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("GET /api/buildings/estimate", () => {
  test("answers 405 with an Allow header, not 404", async () => {
    const s = start(fakeDeps());
    const res = await fetch(new URL("/api/buildings/estimate", s.url));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(((await res.json()) as { error: string }).error).toContain("POST");
  });
});

describe("POST /api/buildings/estimate", () => {
  let server: Server<undefined>;
  let warn: ReturnType<typeof spyOn>;
  beforeAll(() => {
    server = start(fakeDeps(SCHOOL));
  });
  // Swallowed errors log a warning; keep the test output clean and assert on it where it matters.
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("a school POI gives type sekolah from the poi", async () => {
    const res = await post(server, SAMARINDA);
    expect(res.status).toBe(200);
    const est = (await res.json()) as BuildingEstimate;
    expect(est.type).toBe("sekolah");
    expect(est.typeSource).toBe("poi");
    expect(est.region).toEqual({ id: "samarinda", name: "Samarinda" });
    expect(est.kwhYear).toBeGreaterThan(0);
  });

  test("an identical second call is served from cache without calling poi again", async () => {
    const local = fakeDeps(SCHOOL);
    const s = start(local);
    const first = await (await post(s, { ...SAMARINDA, featureId: "cache-1" })).json();
    const second = await (await post(s, { ...SAMARINDA, featureId: "cache-1" })).json();
    expect(second).toEqual(first);
    expect(local.poiCalls).toHaveLength(1);
  });

  test("overrides change the cache key", async () => {
    const local = fakeDeps(SCHOOL);
    const s = start(local);
    await post(s, { ...SAMARINDA, featureId: "cache-2" });
    const res = await post(s, { ...SAMARINDA, featureId: "cache-2", typeOverride: "hotel" });
    const est = (await res.json()) as BuildingEstimate;
    expect(est.type).toBe("hotel");
    expect(est.typeSource).toBe("user");
  });

  test("a type hint is used when Tilequery finds no POI, is validated, and changes the cache key", async () => {
    const local = fakeDeps(null);
    const s = start(local);
    const plain = (await (await post(s, { ...SAMARINDA, featureId: "hint-1" })).json()) as BuildingEstimate;
    expect(plain.typeSource).toBe("footprint");
    const hinted = (await (await post(s, { ...SAMARINDA, featureId: "hint-1", typeHint: "sekolah" })).json()) as BuildingEstimate;
    expect([hinted.type, hinted.typeSource]).toEqual(["sekolah", "poi"]);
    expect((await post(s, { ...SAMARINDA, typeHint: "kastil" })).status).toBe(400);
  });

  test("a POI at the building beats the type hint", async () => {
    const res = await post(server, { ...SAMARINDA, featureId: "hint-2", typeHint: "mal" });
    expect(((await res.json()) as BuildingEstimate).type).toBe("sekolah");
  });

  test("a throwing poi still gives 200 with the footprint fallback type, and is not cached", async () => {
    const local = fakeDeps(new Error("tilequery down"));
    const s = start(local);
    const res = await post(s, { ...SAMARINDA, featureId: "down-1" });
    expect(res.status).toBe(200);
    const est = (await res.json()) as BuildingEstimate;
    expect(est.typeSource).toBe("footprint");
    expect([...local.stored.keys()].some((k) => k.includes("down-1"))).toBe(false);
    await post(s, { ...SAMARINDA, featureId: "down-1" });
    expect(local.poiCalls).toHaveLength(2);
  });

  test("the same featureId with a different footprint recomputes", async () => {
    const local = fakeDeps(SCHOOL);
    const s = start(local);
    const small = (await (await post(s, { ...SAMARINDA, featureId: "fp-1", footprintM2: 400 })).json()) as BuildingEstimate;
    const big = (await (await post(s, { ...SAMARINDA, featureId: "fp-1", footprintM2: 800 })).json()) as BuildingEstimate;
    expect(big.floorAreaM2).toBe(small.floorAreaM2 * 2);
    expect(local.stored.has("building_estimates:v2|fp-1|||400||")).toBe(true);
    expect(local.stored.has("building_estimates:v2|fp-1|||800||")).toBe(true);
    // 400.4 rounds to the same m2 as 400, so it is a cache hit.
    const again = (await (await post(s, { ...SAMARINDA, featureId: "fp-1", footprintM2: 400.4 })).json()) as BuildingEstimate;
    expect(again).toEqual(small);
  });

  test("a failing estimate cache still returns the estimate", async () => {
    const local = fakeDeps(SCHOOL);
    local.deps.db.cacheGet = async (table, key) => {
      if (table === "building_estimates") throw new Error("db down");
      return null;
    };
    local.deps.db.cacheSet = async (table) => {
      if (table === "building_estimates") throw new Error("db down");
    };
    const res = await post(start(local), { ...SAMARINDA, featureId: "cachefail-1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BuildingEstimate).type).toBe("sekolah");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test("no poi nearby gives the footprint fallback and the miss is cached", async () => {
    const local = fakeDeps(null);
    const s = start(local);
    const est = (await (await post(s, { ...SAMARINDA, featureId: "none-1" })).json()) as BuildingEstimate;
    expect(est.typeSource).toBe("footprint");
    expect(local.stored.get("poi_cache:117.15000,-0.50000")).toEqual({ poi: null });
  });

  test("Jakarta coordinates give region null and an outside-Kaltim assumption", async () => {
    const res = await post(server, { ...SAMARINDA, featureId: "jkt", lng: 106.8, lat: -6.2 });
    expect(res.status).toBe(200);
    const est = (await res.json()) as BuildingEstimate;
    expect(est.region).toBeNull();
    expect(est.assumptions.some((a) => /di luar kalimantan timur/i.test(a))).toBe(true);
    expect(est.kwhYear).toBeGreaterThan(0);
  });

  test("extreme footprint and height stay finite and clamped", async () => {
    const res = await post(server, { ...SAMARINDA, featureId: "huge", footprintM2: 1e12, heightM: 1e6 });
    expect(res.status).toBe(200);
    const est = (await res.json()) as BuildingEstimate;
    expect(est.floors).toBe(40);
    expect(Number.isFinite(est.kwhYear)).toBe(true);
    expect(est.floorAreaM2).toBe(50_000 * 40);
  });

  test.each([
    ["lng is a string", { ...SAMARINDA, lng: "x" }],
    ["lng out of range", { ...SAMARINDA, lng: 200 }],
    ["lat out of range", { ...SAMARINDA, lat: -91 }],
    ["footprint missing", { ...SAMARINDA, footprintM2: undefined }],
    ["footprint null", { ...SAMARINDA, footprintM2: null }],
    ["featureId missing", { ...SAMARINDA, featureId: undefined }],
    ["unknown typeOverride", { ...SAMARINDA, typeOverride: "kastil" }],
    ["poiClass over 100 chars", { ...SAMARINDA, poiClass: "x".repeat(101) }],
    ["poiType over 100 chars", { ...SAMARINDA, poiType: "x".repeat(101) }],
    ["body is an array", [1, 2]],
    ["body is not json", "not json{"],
  ])("invalid body (%s) returns 400 with an error", async (_name, body) => {
    const res = await post(server, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });
});
