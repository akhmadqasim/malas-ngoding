import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { env } from "./env.ts";
import { error, json } from "./http.ts";

/** Dependencies injected into the server. Grows as later tasks add services. */
export interface AppDeps {}

export function createServer(opts: { port: number; deps: AppDeps }): Server<undefined> {
  return Bun.serve({
    port: opts.port,
    routes: {
      "/api/health": () => json({ ok: true, name: "Malas Ngoding" }),
      "/api/*": () => error("Endpoint tidak ditemukan", 404),
      "/*": indexHtml,
    },
    development: { hmr: true, console: true },
  });
}

if (import.meta.main) {
  const server = createServer({ port: env.port, deps: {} });
  console.log(`Malas Ngoding running at ${server.url}`);
}
