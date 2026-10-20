import { describe, expect, test } from "bun:test";
import { createPoiLookup } from "../../src/server/services/tilequery.ts";

const feature = (distance: number, props: Record<string, unknown> = {}) => ({
  properties: { class: "education", type: "School", name: "SMA 1", tilequery: { distance }, ...props },
});

const respond = (features: unknown[], status = 200) =>
  (async () => Response.json({ type: "FeatureCollection", features }, { status })) as unknown as typeof fetch;

describe("createPoiLookup", () => {
  test("asks Tilequery for poi_label within 25 m and returns the nearest hit", async () => {
    let seen = "";
    const fetcher = (async (url: string) => {
      seen = url;
      return Response.json({
        features: [feature(18, { name: "Far" }), feature(4, { name: "Near" }), feature(40, { name: "Out" })],
      });
    }) as unknown as typeof fetch;
    const hit = await createPoiLookup("pk.test", { fetch: fetcher })(117.15, -0.5);
    const u = new URL(seen);
    expect(u.pathname).toBe("/v4/mapbox.mapbox-streets-v8/tilequery/117.15,-0.5.json");
    expect(u.searchParams.get("radius")).toBe("25");
    expect(u.searchParams.get("layers")).toBe("poi_label");
    expect(u.searchParams.get("limit")).toBe("5");
    expect(hit).toEqual({ class: "education", type: "School", name: "Near", distanceM: 4 });
  });

  test("returns null when nothing is within 25 m", async () => {
    expect(await createPoiLookup("pk.test", { fetch: respond([feature(31)]) })(1, 1)).toBeNull();
    expect(await createPoiLookup("pk.test", { fetch: respond([]) })(1, 1)).toBeNull();
  });

  test("throws on an upstream error without leaking the token", async () => {
    const lookup = createPoiLookup("pk.secret-token", { fetch: respond([], 500) });
    const err = await lookup(1, 1).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("secret-token");
  });

  test("a slow upstream is aborted by the timeout", async () => {
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    await expect(createPoiLookup("pk.test", { fetch: slow, timeoutMs: 50 })(1, 1)).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("throws when the token is missing", async () => {
    await expect(createPoiLookup("", { fetch: respond([]) })(1, 1)).rejects.toThrow();
  });
});
