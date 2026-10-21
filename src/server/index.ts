import type { Server } from "bun";
import indexHtml from "../web/index.html";
import * as db from "./db.ts";
import { env } from "./env.ts";
import { error, json } from "./http.ts";
import { buildingRoutes } from "./routes/buildings.ts";
import { chatRoutes } from "./routes/chat.ts";
import { configRoutes } from "./routes/config.ts";
import { gridRoutes } from "./routes/grid.ts";
import { plantRoutes } from "./routes/plants.ts";
import { recommendationRoutes } from "./routes/recommendations.ts";
import { regionRoutes } from "./routes/regions.ts";
import { solarRoutes } from "./routes/solar.ts";
import { weatherRoutes } from "./routes/weather.ts";
import { type ChatModel, createChatModel } from "./services/claude.ts";
import { createPlaceSearch, type PlaceSearch } from "./services/chatTools/placeSearch.ts";
import { createNasaLookup, type NasaLookup } from "./services/nasaPower.ts";
import { createMeteoLookup, type MeteoLookup } from "./services/openMeteo.ts";
import { createClaudeRecommender, type RecommendationWriter } from "./services/recommendations.ts";
import { createPoiLookup, type PoiLookup } from "./services/tilequery.ts";

/** Dependencies injected into the server. Grows as later tasks add services. */
export interface AppDeps {
  db: Pick<
    typeof db,
    | "regionAt"
    | "regionById"
    | "listRegions"
    | "regionGeoJSON"
    | "getGridMix"
    | "listPlants"
    | "getBuildingTypes"
    | "getEquivalentFactors"
    | "cacheGet"
    | "cacheSet"
    | "cacheGetAged"
    | "climatologyGet"
    | "climatologySet"
    | "ensureChatSession"
    | "chatHistory"
    | "addChatMessage"
    | "plantsInRegion"
    | "regionLabelPoint"
    | "recommendationsGet"
    | "recommendationsSet"
  >;
  /** Nearest POI within 25 m, or null. Throws when the upstream fails. */
  poi: PoiLookup;
  /** NASA POWER climatology (peak sun hours by month and year). Throws when the upstream fails. */
  nasa: NasaLookup;
  /** Open-Meteo seven-day hourly forecast. Throws when the upstream fails. */
  meteo: MeteoLookup;
  /** Mapbox place search by category (the chat's find_places). Throws when the upstream fails. */
  places: PlaceSearch;
  /** Opens one streaming Claude request for the chat. Throws ChatNotConfiguredError without an API key. */
  chatModel: ChatModel;
  /** Claude writing the government recommendations; null without ANTHROPIC_API_KEY. Throws when it fails. */
  recommender: RecommendationWriter | null;
}

/** Bun's hot reload and browser console echo are for `bun dev` only; a production run turns them off. */
export function bunDevelopment(nodeEnv: string | undefined): false | { hmr: true; console: true } {
  return nodeEnv === "production" ? false : { hmr: true, console: true };
}

export function createServer(opts: { port: number; deps: AppDeps }): Server<undefined> {
  const { deps } = opts;
  return Bun.serve({
    port: opts.port,
    routes: {
      "/api/health": () => json({ ok: true, name: "Malas Ngoding" }),
      ...configRoutes(),
      ...regionRoutes(deps),
      ...plantRoutes(deps),
      ...gridRoutes(deps),
      ...buildingRoutes(deps),
      ...solarRoutes(deps),
      ...weatherRoutes(deps),
      ...chatRoutes(deps),
      ...recommendationRoutes(deps),
      "/api/*": () => error("Endpoint tidak ditemukan", 404),
      "/*": indexHtml,
    },
    development: bunDevelopment(Bun.env.NODE_ENV),
  });
}

if (import.meta.main) {
  const server = createServer({
    port: env.port,
    deps: {
      db,
      poi: createPoiLookup(env.mapboxToken),
      nasa: createNasaLookup(),
      meteo: createMeteoLookup(),
      places: createPlaceSearch(env.mapboxToken),
      chatModel: createChatModel(env.anthropicApiKey),
      recommender: env.anthropicApiKey ? createClaudeRecommender(env.anthropicApiKey) : null,
    },
  });
  console.log(`Malas Ngoding running at ${server.url}`);
}
