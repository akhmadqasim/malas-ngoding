import type { Server } from "bun";
import indexHtml from "../web/index.html";
import { type AppDeps, apiRoutes, productionDeps } from "./app.ts";
import { env } from "./env.ts";

export type { AppDeps } from "./app.ts";

/** Bun's hot reload and browser console echo are for `bun dev` only; a production run turns them off. */
export function bunDevelopment(nodeEnv: string | undefined): false | { hmr: true; console: true } {
  return nodeEnv === "production" ? false : { hmr: true, console: true };
}

export function createServer(opts: { port: number; deps: AppDeps }): Server<undefined> {
  return Bun.serve({
    port: opts.port,
    routes: { ...apiRoutes(opts.deps), "/*": indexHtml },
    development: bunDevelopment(Bun.env.NODE_ENV),
  });
}

if (import.meta.main) {
  const server = createServer({ port: env.port, deps: productionDeps() });
  console.log(`Malas Ngoding running at ${server.url}`);
}
