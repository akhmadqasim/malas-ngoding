import * as db from "./db.ts";
import { env } from "./env.ts";
import { error, json, type RouteTable } from "./http.ts";
import { applicationRoutes } from "./routes/applications.ts";
import { authRoutes } from "./routes/auth.ts";
import { buildingRoutes } from "./routes/buildings.ts";
import { chatRoutes } from "./routes/chat.ts";
import { configRoutes } from "./routes/config.ts";
import { createClaudeRecommender, type RecommendationWriter } from "./services/recommendations.ts";
import { createCurrentWindLookup, type WindLookup } from "./services/currentWind.ts";
import { createGeocodeLookup, type GeocodeLookup } from "./services/geocode.ts";
import { createMeteoLookup, type MeteoLookup } from "./services/openMeteo.ts";
import { createNasaLookup, type NasaLookup } from "./services/nasaPower.ts";
import { createPlaceSearch, type PlaceSearch } from "./services/chatTools/placeSearch.ts";
import { createPoiLookup, type PoiLookup } from "./services/tilequery.ts";
import { createSiteLookup, type SiteLookup } from "./services/siteCheck.ts";
import { geocodeRoutes } from "./routes/geocode.ts";
import { gridRoutes } from "./routes/grid.ts";
import { homeRoutes } from "./routes/home.ts";
import { pemdaRoutes } from "./routes/pemda.ts";
import { plantRoutes } from "./routes/plants.ts";
import { potentialRoutes } from "./routes/potential.ts";
import { recommendationRoutes } from "./routes/recommendations.ts";
import { regionRoutes } from "./routes/regions.ts";
import { scenarioRoutes } from "./routes/scenario.ts";
import { siteRoutes } from "./routes/site.ts";
import { solarRoutes } from "./routes/solar.ts";
import { twinRoutes } from "./routes/twin.ts";
import { type ChatModel, createChatModel } from "./services/claude.ts";
import { weatherRoutes } from "./routes/weather.ts";
import { windRoutes } from "./routes/wind.ts";

/** Dependencies injected into the server. Grows as later tasks add services. */
export interface AppDeps {
  wind?: WindLookup;
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
    | "potentialCells"
    | "recommendationsGet"
    | "recommendationsSet"
    | "createUser"
    | "userByEmail"
    | "sessionCreate"
    | "sessionUser"
    | "sessionDelete"
    | "homeGet"
    | "homeUpsert"
    | "homeDelete"
    | "pemdaSummary"
    | "pemdaHomes"
    | "applicationCreate"
    | "applicationGet"
    | "applicationUpdate"
    | "applicationList"
    | "applicationActiveFor"
    | "applicationFileCreate"
    | "applicationFilesMeta"
    | "applicationFileGet"
  >;
  /** Nearest POI within 25 m, or null. Throws when the upstream fails. */
  poi: PoiLookup;
  /** NASA POWER climatology (peak sun hours by month and year). Throws when the upstream fails. */
  nasa: NasaLookup;
  /** Open-Meteo seven-day hourly forecast. Throws when the upstream fails. */
  meteo: MeteoLookup;
  /** Mapbox place search by category (the chat's find_places). Throws when the upstream fails. */
  places: PlaceSearch;
  /** What Mapbox Streets shows around a farm site (buildings, settled land, water). Throws when the upstream fails. */
  site: SiteLookup;
  /** Address search inside Kaltim (Mapbox Geocoding v6). Throws when the upstream fails. */
  geocode: GeocodeLookup;
  /** Opens one streaming Claude request for the chat. Throws ChatNotConfiguredError without an API key. */
  chatModel: ChatModel;
  /** Claude writing the government recommendations; null without ANTHROPIC_API_KEY. Throws when it fails. */
  recommender: RecommendationWriter | null;
}

/** Every `/api/...` route. Shared by `bun dev`/`bun start` and the Vercel function in `api/index.ts`. */
export function apiRoutes(deps: AppDeps, opts: { demoLogin?: boolean } = {}): RouteTable {
  return {
    "/api/health": () => json({ ok: true, name: "Malas Ngoding" }),
    ...configRoutes(),
    ...regionRoutes(deps),
    ...plantRoutes(deps),
    ...gridRoutes(deps),
    ...buildingRoutes(deps),
    ...solarRoutes(deps),
    ...weatherRoutes(deps),
    ...windRoutes(deps),
    ...chatRoutes(deps),
    ...recommendationRoutes(deps),
    ...scenarioRoutes(deps),
    ...twinRoutes(deps),
    ...potentialRoutes(deps),
    ...siteRoutes(deps),
    ...geocodeRoutes(deps),
    ...authRoutes(deps, { demoLogin: opts.demoLogin ?? env.demoLogin }),
    ...homeRoutes(deps),
    ...pemdaRoutes(deps),
    ...applicationRoutes(deps),
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
    wind: createCurrentWindLookup(),
    places: createPlaceSearch(env.mapboxToken),
    site: createSiteLookup(env.mapboxToken),
    geocode: createGeocodeLookup(env.mapboxToken),
    chatModel: createChatModel(env.anthropicApiKey),
    recommender: env.anthropicApiKey ? createClaudeRecommender(env.anthropicApiKey) : null,
  };
}
