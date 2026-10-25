import * as db from "./db.ts";
import { env } from "./env.ts";
import { error, json, type RouteTable } from "./http.ts";
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

/** Every `/api/...` route. Shared by `bun dev`/`bun start` and the Vercel function in `api/index.ts`. */
export function apiRoutes(deps: AppDeps): RouteTable {
  return {
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
  };
}

/** The real services, configured from `.env`. */
export function productionDeps(): AppDeps {
  return {
    db,
    poi: createPoiLookup(env.mapboxToken),
    nasa: createNasaLookup(),
    meteo: createMeteoLookup(),
    places: createPlaceSearch(env.mapboxToken),
    chatModel: createChatModel(env.anthropicApiKey),
    recommender: env.anthropicApiKey ? createClaudeRecommender(env.anthropicApiKey) : null,
  };
}
