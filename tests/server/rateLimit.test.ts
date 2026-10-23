import { describe, expect, test } from "bun:test";
import { RATE_LIMITED, clientKey, createRateLimiter, rateLimited } from "../../src/server/services/rateLimit.ts";

describe("createRateLimiter", () => {
  test("allows `limit` hits per window, then says how long to wait", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i++) {
      expect(limiter.hit("a")).toEqual({ ok: true });
      now += 1000;
    }
    // The oldest hit was 3 s ago, so it leaves the window in 57 s.
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterS: 57 });
  });

  test("hits leave the window one by one (sliding)", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });
    limiter.hit("a");
    now = 6000;
    limiter.hit("a");
    expect(limiter.hit("a").ok).toBe(false);
    now = 10_001;
    expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("a").ok).toBe(false);
  });

  test("keys are counted apart, and refused hits are not counted", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    expect(limiter.hit("a").ok).toBe(true);
    expect(limiter.hit("b").ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(limiter.hit("a").ok).toBe(false);
    now = 1001;
    expect(limiter.hit("a").ok).toBe(true);
  });

  test("Retry-After is at least one second", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
    limiter.hit("a");
    now = 999;
    expect(limiter.hit("a")).toEqual({ ok: false, retryAfterS: 1 });
  });
});

describe("rateLimited", () => {
  const server = { requestIP: () => ({ address: "10.0.0.7", family: "IPv4" as const, port: 1234 }) };
  const req = new Request("http://x/api/auth/login", { method: "POST", headers: { "x-forwarded-for": "6.6.6.6" } });

  test("keys on the socket address and ignores proxy headers", () => {
    expect(clientKey(req, server)).toBe("10.0.0.7");
    expect(clientKey(req, { requestIP: () => null })).toBe("unknown");
  });

  test("returns null while under the limit, then a 429 JSON response with Retry-After", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rateLimited(limiter, req, server)).toBeNull();
    const res = rateLimited(limiter, req, server)!;
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: RATE_LIMITED });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
