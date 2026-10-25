// Vercel Function on the Bun runtime: serves every /api/... route (vercel.json rewrites them here).
// Vercel does not support HTML imports in Bun.serve, so `bun run build` writes the React app to public/.
import { apiRoutes, productionDeps } from "../src/server/app.ts";

Bun.serve({ routes: apiRoutes(productionDeps()) });
