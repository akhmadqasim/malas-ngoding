import type { BuildingType } from "./types.ts";

/*
 * The contract between the server's accounts, homes and government dashboard (src/server/routes/auth.ts,
 * home.ts, pemda.ts) and the web app. Residents (warga) sign up themselves and mark their home; local
 * government accounts (pemda) are made by an admin (or the demo login) and see every region, the summary of
 * registered homes and the points of homes whose owners agreed to share them, never names or emails.
 */

export type Role = "warga" | "pemda";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/** POST /api/auth/register (residents only). */
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}
/** POST /api/auth/login. */
export interface LoginInput {
  email: string;
  password: string;
}
/** POST /api/auth/demo: signs in as the seeded demo resident or demo government account (no password). */
export interface DemoLoginInput {
  role: Role;
}
/** The answer of register, login, demo and GET /api/auth/me (user null when signed out). */
export interface AuthAnswer {
  user: User | null;
}

/** PUT /api/me/home: the building the resident clicked on the map, and what they tell about it. */
export interface HomeInput {
  featureId: string;
  lng: number;
  lat: number;
  footprintM2: number;
  heightM: number | null;
  /** The type and floors the panel showed (the resident may have changed them). */
  buildingType: BuildingType;
  floors: number;
  /** What the PLN bill says, when the resident knows it: kWh a month, or the bill in rupiah a month. */
  kwhMonth: number | null;
  billRpMonth: number | null;
  /** Wants rooftop solar. */
  interestedPv: boolean;
  /** Installation reported by the resident, not inferred from interest or a simulation. */
  installedPv?: boolean;
  /** Reported nameplate capacity, kWp; null when unknown. */
  installedKwp?: number | null;
  /** Lets the local government see this home as an anonymous point on its map. */
  consentMap: boolean;
}

export interface Home extends HomeInput {
  regionId: string | null;
  regionName: string | null;
  /**
   * The home's yearly electricity: from the bill when given (kWh a month x 12, or the bill divided by the
   * household tariff), otherwise the model estimate. `source` says which.
   */
  kwhYear: number;
  kwhSource: "tagihan" | "perkiraan";
  /** Roof area used for solar (the footprint), m2, and the rooftop PV it could hold, kWp. */
  roofAreaM2: number;
  potentialKwp: number;
  updatedAt: string;
  /**
   * Capacity the local government verified from an installation report (kWp) and when; null until then.
   * Separate from `installedKwp`, which the resident reports. The server always sends both fields.
   */
  verifiedKwp?: number | null;
  verifiedAt?: string | null;
}

/** GET /api/me/home and PUT /api/me/home. */
export interface HomeAnswer {
  home: Home | null;
}

/** GET /api/pemda/summary (government only): registered homes per region. */
export interface PemdaRegionSummary {
  regionId: string;
  regionName: string;
  homes: number;
  interested: number;
  installed: number;
  installedKwp: number;
  /** Homes with a government-verified installation, and their verified capacity (kWp). Always sent. */
  verified?: number;
  verifiedKwp?: number;
  /** Rooftop PV the registered homes could hold, kWp. */
  potentialKwp: number;
  /** Their yearly electricity, kWh. */
  kwhYear: number;
}
export interface PemdaSummary {
  regions: PemdaRegionSummary[];
  totals: Omit<PemdaRegionSummary, "regionId" | "regionName">;
  /** How many of the homes are seeded demo homes (shown as "data demo"). */
  demoHomes: number;
}

/** GET /api/pemda/homes (government only): consenting homes as anonymous points. */
export interface PemdaHomeProperties {
  buildingType: BuildingType;
  potentialKwp: number;
  interested: boolean;
  installed: boolean;
  installedKwp: number | null;
  footprintM2: number;
  heightM: number | null;
  regionId: string | null;
  demo: boolean;
}
export interface PemdaHomes {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: PemdaHomeProperties }[];
}
