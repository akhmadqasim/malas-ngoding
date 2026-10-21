import { describe, expect, test } from "bun:test";
import { createPlaceSearch } from "../../src/server/services/chatTools/placeSearch.ts";

const feature = (name: string, lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { name, full_address: `${name}, Samarinda, Indonesia`, place_formatted: "Samarinda, 75112, Indonesia", distance: 120, ...extra },
});

const respond = (features: unknown[], status = 200) =>
  (async () => Response.json({ type: "FeatureCollection", features }, { status })) as unknown as typeof fetch;

const QUERY = { category: "school", near: [117.15, -0.5] as [number, number], limit: 25 };

describe("createPlaceSearch", () => {
  test("asks the Search Box category API near the point, inside Kaltim, in Indonesian", async () => {
    let seen = "";
    const fetcher = (async (url: string) => {
      seen = url;
      return Response.json({ features: [feature("SMA Negeri 1", 117.151, -0.501)] });
    }) as unknown as typeof fetch;
    const hits = await createPlaceSearch("pk.test", { fetch: fetcher })({ ...QUERY, exclude: ["driving_school", "music_school"] });
    const u = new URL(seen);
    expect(u.origin + u.pathname).toBe("https://api.mapbox.com/search/searchbox/v1/category/school");
    expect(u.searchParams.get("proximity")).toBe("117.15,-0.5");
    expect(u.searchParams.get("bbox")).toBe("112.5,-3.5,120.5,3.8");
    expect(u.searchParams.get("country")).toBe("id");
    expect(u.searchParams.get("language")).toBe("id");
    expect(u.searchParams.get("limit")).toBe("25");
    expect(u.searchParams.get("poi_category_exclusions")).toBe("driving_school,music_school");
    expect(u.searchParams.get("access_token")).toBe("pk.test");
    expect(hits).toEqual([
      { name: "SMA Negeri 1", lng: 117.151, lat: -0.501, address: "SMA Negeri 1, Samarinda, Indonesia", distanceM: 120 },
    ]);
  });

  test("skips features without a name or a usable point, and caps the limit at 25", async () => {
    let seen = "";
    const fetcher = (async (url: string) => {
      seen = url;
      return Response.json({
        features: [
          feature("", 117.1, -0.5),
          { properties: { name: "No point" } },
          feature("Bad point", Number.NaN, -0.5),
          feature("Ok", 117.2, -0.4, { full_address: undefined, distance: undefined }),
        ],
      });
    }) as unknown as typeof fetch;
    const hits = await createPlaceSearch("pk.test", { fetch: fetcher })({ ...QUERY, limit: 80 });
    expect(new URL(seen).searchParams.get("limit")).toBe("25");
    expect(hits).toEqual([{ name: "Ok", lng: 117.2, lat: -0.4, address: "Samarinda, 75112, Indonesia", distanceM: null }]);
  });

  test("keeps answers for an hour, per category and rounded point", async () => {
    let calls = 0;
    let now = 1_000_000;
    const fetcher = (async () => {
      calls++;
      return Response.json({ features: [feature("SMA Negeri 1", 117.151, -0.501)] });
    }) as unknown as typeof fetch;
    const search = createPlaceSearch("pk.test", { fetch: fetcher, now: () => now });
    await search(QUERY);
    await search({ ...QUERY, near: [117.15004, -0.50004] });
    expect(calls).toBe(1);
    await search({ ...QUERY, category: "hospital" });
    expect(calls).toBe(2);
    now += 61 * 60_000;
    await search(QUERY);
    expect(calls).toBe(3);
  });

  test("an unreadable 200 answer is a failure, not an hour of 'nothing found'", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return calls === 1
        ? new Response("<html>proxy</html>", { status: 200 })
        : Response.json({ features: [feature("SMA", 117.1, -0.5)] });
    }) as unknown as typeof fetch;
    const search = createPlaceSearch("pk.test", { fetch: fetcher });
    await expect(search(QUERY)).rejects.toThrow(/unreadable/);
    expect(await search(QUERY)).toHaveLength(1);
  });

  test("a failed answer is not kept", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return calls === 1 ? Response.json({}, { status: 503 }) : Response.json({ features: [] });
    }) as unknown as typeof fetch;
    const search = createPlaceSearch("pk.test", { fetch: fetcher });
    await expect(search(QUERY)).rejects.toThrow();
    expect(await search(QUERY)).toEqual([]);
  });

  test("throws on an upstream error without leaking the token", async () => {
    const err = await createPlaceSearch("pk.secret-token", { fetch: respond([], 401) })(QUERY).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("secret-token");
    const down = (async () => {
      throw new TypeError("fetch failed for https://api.mapbox.com/?access_token=pk.secret-token");
    }) as unknown as typeof fetch;
    const err2 = await createPlaceSearch("pk.secret-token", { fetch: down })(QUERY).catch((e: Error) => e);
    expect((err2 as Error).message).not.toContain("secret-token");
  });

  test("a slow upstream is aborted by the timeout", async () => {
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(createPlaceSearch("pk.test", { fetch: slow, timeoutMs: 50 })(QUERY)).rejects.toThrow(/timed out/);
  });

  test("throws when the token is missing", async () => {
    await expect(createPlaceSearch("", { fetch: respond([]) })(QUERY)).rejects.toThrow(/MAPBOX_TOKEN/);
  });

  test("rejects a category id that is not a plain word, before any request", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json({ features: [] });
    }) as unknown as typeof fetch;
    await expect(createPlaceSearch("pk.test", { fetch: fetcher })({ ...QUERY, category: "../v1/x" })).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
