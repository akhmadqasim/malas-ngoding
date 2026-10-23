import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { createGeocodeLookup, type GeocodeHit, hitsFrom } from "../../src/server/services/geocode.ts";
import { fakeDeps } from "./fakes.ts";

const juanda: GeocodeHit = { name: "Jalan Juanda", place: "Samarinda, Kalimantan Timur", lng: 117.14, lat: -0.48, type: "street" };

describe("hitsFrom", () => {
  test("reads name, place and point, and drops features without them", () => {
    const hits = hitsFrom([
      { geometry: { coordinates: [117.14, -0.48] }, properties: { name: "Jalan Juanda", place_formatted: "Samarinda", feature_type: "street" } },
      { geometry: { coordinates: [117, -0.5] }, properties: {} },
      { properties: { name: "Tanpa titik" } },
    ]);
    expect(hits).toEqual([{ name: "Jalan Juanda", place: "Samarinda", lng: 117.14, lat: -0.48, type: "street" }]);
  });
});

describe("createGeocodeLookup", () => {
  test("asks the Search Box and Geocoding APIs inside Kaltim in Indonesian, places first, no duplicates", async () => {
    const urls: string[] = [];
    const feature = (name: string, place: string) => ({ geometry: { coordinates: [117.1, -0.5] }, properties: { name, place_formatted: place } });
    const lookup = createGeocodeLookup("pk.test", {
      fetch: (async (u: string) => {
        urls.push(String(u));
        const features = String(u).includes("searchbox")
          ? [feature("Perumahan Bumi Sempaja", "Samarinda")]
          : [feature("Sempaja Selatan", "Samarinda"), feature("Perumahan Bumi Sempaja", "Samarinda")];
        return new Response(JSON.stringify({ features }));
      }) as unknown as typeof fetch,
    });
    expect((await lookup("sempaja")).map((h) => h.name)).toEqual(["Perumahan Bumi Sempaja", "Sempaja Selatan"]);
    expect(urls.some((u) => u.includes("/search/searchbox/v1/forward?"))).toBe(true);
    expect(urls.some((u) => u.includes("/search/geocode/v6/forward?"))).toBe(true);
    for (const u of urls) {
      expect(u).toContain("language=id");
      expect(u).toContain("bbox=");
    }
    const failing = createGeocodeLookup("pk.secret", { fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch });
    const err = await failing("juanda").catch((e: Error) => e);
    expect(String(err)).not.toContain("pk.secret");
  });
});

describe("GET /api/geocode", () => {
  let server: Server<undefined>;
  beforeAll(() => {
    server = createServer({ port: 0, deps: fakeDeps(null, { geocode: [juanda] }).deps });
  });
  afterAll(() => server.stop(true));
  const get = (q: string) => fetch(new URL(`/api/geocode?${new URLSearchParams({ q })}`, server.url));

  test("answers with hits", async () => {
    const res = await get("juanda");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hits: GeocodeHit[] }).hits).toEqual([juanda]);
  });

  test("asks for at least 3 letters", async () => {
    const res = await get("ju");
    expect(res.status).toBe(400);
    expect(typeof ((await res.json()) as { error: string }).error).toBe("string");
  });

  test("a failing Mapbox is a 503", async () => {
    const s = createServer({ port: 0, deps: fakeDeps(null, { geocode: new Error("down") }).deps });
    const res = await fetch(new URL("/api/geocode?q=juanda", s.url));
    expect(res.status).toBe(503);
    s.stop(true);
  });
});
