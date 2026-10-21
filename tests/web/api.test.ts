import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, api } from "../../src/web/api.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Makes every fetch answer with this response. */
function respond(make: () => Response | Promise<Response>) {
  globalThis.fetch = (async () => make()) as unknown as typeof fetch;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("api request errors are Indonesian ApiErrors", () => {
  test("a 200 that is not JSON (an HTML page, a proxy error) becomes a readable ApiError", async () => {
    respond(() => new Response("<!doctype html><title>Bad gateway</title>", { status: 200, headers: { "Content-Type": "text/html" } }));
    const err = await failure(api.regions());
    expect(err.status).toBe(200);
    expect(err.message).toBe("Server mengirim jawaban yang tidak bisa dibaca. Coba lagi sebentar lagi.");
  });

  test("the server's own error text is shown as is", async () => {
    respond(() => Response.json({ error: "Wilayah tidak ditemukan" }, { status: 404 }));
    const err = await failure(api.region("nowhere"));
    expect(err.status).toBe(404);
    expect(err.message).toBe("Wilayah tidak ditemukan");
  });

  test("an error status without a JSON body falls back to the status code", async () => {
    respond(() => new Response("upstream timeout", { status: 502 }));
    const err = await failure(api.plants());
    expect(err.message).toBe("Permintaan gagal (502).");
  });

  test("no connection at all", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const err = await failure(api.config());
    expect(err.status).toBe(0);
    expect(err.message).toBe("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.");
  });

  test("valid JSON still comes through", async () => {
    respond(() => Response.json({ mapboxToken: "pk.test" }));
    expect(await api.config()).toEqual({ mapboxToken: "pk.test" });
  });
});
