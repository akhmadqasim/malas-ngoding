import type { CurrentConditions } from "../server/routes/weather.ts";
import type { SolarSimulation } from "../server/routes/solar.ts";
import type { summariseDays } from "../shared/pvForecast.ts";
import type { BuildingEstimate, BuildingInput, FuelType, GridMix, PvHour, Recommendations, RegionSummary } from "../shared/types.ts";

// Typed fetch helpers for the server API. Later tasks add their own endpoints here.

export type { SolarSimulation };

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

export interface SolarRequest {
  lat: number;
  lng: number;
  roofAreaM2: number;
  kwhYear: number;
  backupHours: number;
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
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof body?.error === "string" ? body.error : `Permintaan gagal (${res.status}).`;
    throw new ApiError(message, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    // A 200 that is not JSON: an HTML error page from a proxy, or a cut-off response.
    throw new ApiError("Server mengirim jawaban yang tidak bisa dibaca. Coba lagi sebentar lagi.", res.status);
  }
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  config: () => request<{ mapboxToken: string }>("/api/config"),
  regions: () => request<RegionCollection>("/api/regions"),
  region: (id: string) => request<RegionDetail>(`/api/regions/${encodeURIComponent(id)}`),
  plants: () => request<PlantCollection>("/api/plants"),
  grid: () => request<GridMix>("/api/grid"),
  /** The first answer for a region can take 8 to 10 s (Claude writes it); later ones come from the cache. */
  recommendations: (regionId: string, signal?: AbortSignal) =>
    request<Recommendations>(`/api/recommendations/${encodeURIComponent(regionId)}`, { signal }),
  estimateBuilding: (input: BuildingInput) => post<BuildingEstimate>("/api/buildings/estimate", input),
  simulateSolar: (input: SolarRequest) => post<SolarSimulation>("/api/solar/simulate", input),
  weather: (lat: number, lng: number, kWp: number) =>
    request<WeatherResponse>(`/api/weather?${new URLSearchParams({ lat: String(lat), lng: String(lng), kWp: String(kWp) })}`),
};
