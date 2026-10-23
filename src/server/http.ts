import type { BunRequest, Server } from "bun";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** An error with a machine-readable `code` next to the message, for clients that branch on the cause. */
export function failure(f: { status: number; code: string; message: string }): Response {
  return Response.json({ error: f.message, code: f.code }, { status: f.status });
}

/** 405 with the `Allow` header, for a known path called with the wrong method. */
export function methodNotAllowed(allow: string): Response {
  return Response.json({ error: `Metode tidak diizinkan. Gunakan ${allow}.` }, { status: 405, headers: { Allow: allow } });
}

/** `server` lets a slow handler raise its idle timeout with `server.timeout(req, seconds)`. */
export type Handler = (req: BunRequest, server: Server<undefined>) => Response | Promise<Response>;
/** A route table entry: one handler for every method, or one handler per method. */
export type RouteTable = Record<string, Handler | Partial<Record<"GET" | "POST", Handler>>>;

/** Turns an unexpected throw into a friendly 500 so no request ends in an unhandled rejection. */
export function safe(handler: Handler): Handler {
  return async (req, server) => {
    try {
      return await handler(req, server);
    } catch (err) {
      console.error(`${req.method} ${new URL(req.url).pathname} failed:`, err instanceof Error ? err.message : "unknown error");
      return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
    }
  };
}
