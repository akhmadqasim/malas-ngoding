import type { CurrentConditions } from "../server/routes/weather.ts";
import type { WindResponse } from "../shared/wind.ts";
import type { SolarSimulation } from "../server/routes/solar.ts";
import type { SiteAnswer } from "../server/routes/site.ts";
import type { GeocodeHit } from "../server/services/geocode.ts";
import type { summariseDays } from "../shared/pvForecast.ts";
import type { ScenarioBasis } from "../shared/scenario.ts";
import type { TwinBasis } from "../shared/twin.ts";
import type { AuthAnswer, DemoLoginInput, HomeAnswer, HomeInput, LoginInput, PemdaHomes, PemdaSummary, RegisterInput, Role } from "../shared/auth.ts";
import type { PotentialAssumptions } from "../shared/potential.ts";
import type { BuildingEstimate, BuildingInput, BuildingType, EquivalentFactor, FuelType, GridMix, PvHour, Recommendations, RegionSummary } from "../shared/types.ts";

// Typed fetch helpers for the server API. Later tasks add their own endpoints here.

export type { GeocodeHit, SiteAnswer, SolarSimulation };

export interface Feature<G, P> {
  type: "Feature";
  id?: string | number;
  geometry: G;
  properties: P;
}
export interface FeatureCollection<G, P> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
}
export type PolygonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };
export interface PointGeometry {
  type: "Point";
  coordinates: [number, number];
}

/** A region on the map: its figures plus where its name goes (inside the region, where it is widest). */
export type RegionProperties = RegionSummary & { labelPoint?: [number, number] };
export type RegionCollection = FeatureCollection<PolygonGeometry, RegionProperties>;
export type RegionDetail = RegionSummary & { centroid: [number, number] };

export interface PlantProperties {
  name: string;
  fuel: FuelType;
  capacityMw: number;
  status: "operating" | "planned" | "unknown" | string;
  approx: boolean;
  source: string;
}
export type PlantCollection = FeatureCollection<PointGeometry, PlantProperties>;

/** One NASA POWER grid cell over Kalimantan Timur, clipped to its land (db.potentialCells). */
export interface PotentialProperties {
  id: number;
  /** The grid point. */
  lng: number;
  lat: number;
  /** A point on the cell's land, for the camera and distances. */
  at: [number, number];
  /** kWh/m2/day (peak sun hours). */
  ghi: number;
  /** m/s at 50 m and 10 m. */
  ws50: number;
  ws10: number;
  regionId: string;
  regionName: string;
  plantName: string | null;
  plantKm: number | null;
  /** The cell's Kaltim land, hectares. */
  landHa: number;
  /** Terrain of that land (open DEM tiles), or null before the terrain seed is loaded. */
  terrain: { elevMean: number; elevMax: number; slopeMean: number; flat5Pct: number; flat10Pct: number } | null;
  /** The cell's position on the shown scale, set in the browser (potentialLayer.ts). */
  t?: number;
}
export type PotentialCollection = FeatureCollection<PolygonGeometry, PotentialProperties> & {
  source: string;
  /** Where the terrain comes from, or null without it. */
  terrainSource: string | null;
  /** PLTS and turbine assumptions (data/seed/re-assumptions.json). */
  assumptions: PotentialAssumptions;
  /** kg CO2 a new PLTS or PLTB avoids per kWh (Kepmen ESDM 163.K/2021). */
  avoidedKgPerKwh: number;
};

export interface SolarRequest {
  panelCount?: number;
  lat: number;
  lng: number;
  roofAreaM2: number;
  kwhYear: number;
  backupHours: number;
  /** Picks the PLN tariff and the daytime use on the server; optional for older callers. */
  buildingType?: BuildingType;
}

export interface WeatherResponse {
  hours: PvHour[];
  days: ReturnType<typeof summariseDays>;
  current: CurrentConditions;
  stale: boolean;
}

/** Thrown for any failed request; `message` is the server's Indonesian error text when it sent one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown; code?: string } | null;
    const message = typeof body?.error === "string" ? body.error : `Permintaan gagal (${res.status}).`;
    throw new ApiError(message, res.status, typeof body?.code === "string" ? body.code : undefined);
  }
  // 204 No Content (logout, delete): nothing to read.
  if (res.status === 204) return undefined as T;
  try {
    return (await res.json()) as T;
  } catch {
    // A 200 that is not JSON: an HTML error page from a proxy, or a cut-off response.
    throw new ApiError("Server mengirim jawaban yang tidak bisa dibaca. Coba lagi sebentar lagi.", res.status);
  }
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  config: () => request<{ mapboxToken: string }>("/api/config"),
  regions: () => request<RegionCollection>("/api/regions"),
  region: (id: string) => request<RegionDetail>(`/api/regions/${encodeURIComponent(id)}`),
  plants: () => request<PlantCollection>("/api/plants"),
  grid: () => request<GridMix>("/api/grid"),
  /** The first answer for a region can take 8 to 10 s (Claude writes it); later ones come from the cache. */
  recommendations: (regionId: string, signal?: AbortSignal) =>
    request<Recommendations>(`/api/recommendations/${encodeURIComponent(regionId)}`, { signal }),
  /** Asks Claude to write the region's recommendations again; the server keeps the old copy if that fails. */
  refreshRecommendations: (regionId: string, signal?: AbortSignal) =>
    request<Recommendations>(`/api/recommendations/${encodeURIComponent(regionId)}/refresh`, { method: "POST", signal }),
  equivalents: () => request<EquivalentFactor[]>("/api/equivalents"),
  /** Costs, factors and sun hours per region for the rooftop solar scenario (computed in the browser). */
  scenario: () => request<ScenarioBasis>("/api/scenario"),
  /** The twin's day: the forecast per region from the current hour and the load curve (computed in the browser). */
  twin: () => request<TwinBasis>("/api/twin"),
  // Accounts (cookie session; fetch sends it on same-origin requests).
  me: () => request<AuthAnswer>("/api/auth/me"),
  login: (input: LoginInput) => post<AuthAnswer>("/api/auth/login", input),
  register: (input: RegisterInput) => post<AuthAnswer>("/api/auth/register", input),
  demoLogin: (role: Role) => post<AuthAnswer>("/api/auth/demo", { role } satisfies DemoLoginInput),
  logout: () => post<void>("/api/auth/logout", {}),
  /** The signed-in resident's home. */
  home: () => request<HomeAnswer>("/api/me/home"),
  saveHome: (input: HomeInput) => put<HomeAnswer>("/api/me/home", input),
  deleteHome: () => request<void>("/api/me/home", { method: "DELETE" }),
  /** Government only: registered homes per region, and the consenting ones as anonymous points. */
  pemdaSummary: () => request<PemdaSummary>("/api/pemda/summary"),
  pemdaHomes: () => request<PemdaHomes>("/api/pemda/homes"),
  /** Addresses and places in Kaltim for the search box (Mapbox Geocoding, not stored). */
  geocode: (q: string, signal?: AbortSignal) => request<{ hits: GeocodeHit[] }>(`/api/geocode?${new URLSearchParams({ q })}`, { signal }),
  /** The renewable potential grid over Kaltim (NASA POWER, clipped to its land by PostGIS). */
  potential: () => request<PotentialCollection>("/api/potential"),
  /** The nearest spot to `at` with no buildings, settled land or water within `radiusM` (Mapbox Streets). */
  site: (at: [number, number], radiusM: number) =>
    request<SiteAnswer>(`/api/site?${new URLSearchParams({ lng: String(at[0]), lat: String(at[1]), radius: String(Math.round(radiusM)) })}`),
  estimateBuilding: (input: BuildingInput) => post<BuildingEstimate>("/api/buildings/estimate", input),
  simulateSolar: (input: SolarRequest) => post<SolarSimulation>("/api/solar/simulate", input),
  weather: (lat: number, lng: number, kWp: number) =>
    request<WeatherResponse>(`/api/weather?${new URLSearchParams({ lat: String(lat), lng: String(lng), kWp: String(kWp) })}`),
  wind: (lat: number, lng: number) => request<WindResponse>(`/api/wind?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}`),
};
