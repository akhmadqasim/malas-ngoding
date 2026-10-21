/**
 * Dev-only harness for the Surya and Cuaca tabs (lane solar-weather), until the building panel of lane
 * buildings mounts them. It serves scripts/tabs-harness/index.html and forwards /api/* to the running app
 * (BASE_URL), so the tabs talk to the real solar and weather endpoints. Run the app first (`bun dev`), then
 * `bun scripts/tabs-harness/server.ts`, or let `bun scripts/tabs-check.ts` start it.
 */
import page from "./index.html";

export function startHarness(port: number, baseUrl: string) {
  return Bun.serve({
    port,
    development: { hmr: false, console: false },
    routes: {
      "/": page,
      "/favicon.ico": new Response(null, { status: 204 }),
      "/api/*": async (req) => {
        const url = new URL(req.url);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
        return fetch(new URL(url.pathname + url.search, baseUrl), { method: req.method, headers: req.headers, body });
      },
    },
  });
}

if (import.meta.main) {
  const base = Bun.env.BASE_URL ?? `http://localhost:${Bun.env.PORT ?? 3000}`;
  const server = startHarness(Number(Bun.env.HARNESS_PORT ?? 3105), base);
  console.log(`tabs harness on ${server.url} (api: ${base})`);
}
