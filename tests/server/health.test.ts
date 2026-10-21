import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { bunDevelopment, createServer } from "../../src/server/index.ts";
import { fakeDeps } from "./fakes.ts";

let server: Server<undefined>;

beforeAll(() => {
  server = createServer({ port: 0, deps: fakeDeps().deps });
});

afterAll(() => {
  server.stop(true);
});

describe("server shell", () => {
  test("GET /api/health returns ok and the app name", async () => {
    const res = await fetch(new URL("/api/health", server.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: "Malas Ngoding" });
  });

  test("GET / returns the React shell html", async () => {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="root">');
  });

  test("unknown /api route returns a 404 json error", async () => {
    const res = await fetch(new URL("/api/x", server.url));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("development flags", () => {
  test("hmr and console are on outside production", () => {
    expect(bunDevelopment(undefined)).toEqual({ hmr: true, console: true });
    expect(bunDevelopment("development")).toEqual({ hmr: true, console: true });
  });

  test("hmr and console are off when NODE_ENV is production", () => {
    expect(bunDevelopment("production")).toBe(false);
  });
});
