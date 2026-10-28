import type { BunRequest, Server } from "bun";

/** A sliding-window limiter kept in memory: `limit` hits per `windowMs` for each key. One process only. */
export interface RateLimiter {
  /** Counts a hit for `key`. `retryAfterS` is how long until the oldest hit leaves the window (whole seconds, at least 1). */
  hit(key: string): { ok: true } | { ok: false; retryAfterS: number };
}

const MAX_KEYS = 5000;

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    hit(key) {
      const t = now();
      const since = t - opts.windowMs;
      // Keys that went quiet must not pile up forever.
      if (hits.size > MAX_KEYS) {
        for (const [k, times] of hits) if ((times.at(-1) ?? 0) <= since) hits.delete(k);
      }
      const recent = (hits.get(key) ?? []).filter((x) => x > since);
      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((recent[0]! + opts.windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}

export const RATE_LIMITED = "Terlalu banyak percobaan. Coba lagi sebentar lagi.";

/**
 * The client's address from the socket. Proxy headers are not trusted: anyone can send them, and a limiter
 * keyed on them could be skipped with a new value per request.
 */
export function clientKey(req: Request, server: Pick<Server<undefined>, "requestIP">): string {
  return server.requestIP(req)?.address ?? "unknown";
}

/** null when the request may go on, otherwise the 429 response (JSON error plus Retry-After). */
export function rateLimited(
  limiter: RateLimiter,
  req: Request | BunRequest,
  server: Pick<Server<undefined>, "requestIP">,
): Response | null {
  const out = limiter.hit(clientKey(req, server));
  if (out.ok) return null;
  return Response.json({ error: RATE_LIMITED }, { status: 429, headers: { "Retry-After": String(out.retryAfterS) } });
}
