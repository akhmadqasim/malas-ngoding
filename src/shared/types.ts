export type BuildingType = "rumah" | "ruko" | "kantor" | "pemerintahan" | "sekolah" | "kampus" | "rumah_sakit" | "hotel" | "mal" | "ibadah" | "gudang" | "industri";
export type FuelType = "batubara" | "gas" | "diesel" | "surya" | "air" | "biomassa" | "lainnya";
export interface GridMix { year: number; factorKgPerKwh: number; shares: Record<FuelType, number>; fuelFactors: Record<FuelType, number>; source: string }
export interface BuildingInput { featureId: string; lng: number; lat: number; footprintM2: number; heightM: number | null; poiClass?: string | null; poiType?: string | null; typeOverride?: BuildingType; floorsOverride?: number; typeHint?: BuildingType }
export interface BuildingEstimate { featureId: string; type: BuildingType; typeSource: "poi" | "footprint" | "user"; floors: number; floorAreaM2: number; kwhYear: number; kwhMonth: number; co2KgYear: number; bySource: { fuel: FuelType; kwh: number; co2Kg: number }[]; equivalents: Equivalent[]; region: { id: string; name: string } | null; assumptions: string[] }
export interface Equivalent { key: "mobil_km" | "motor_km" | "pohon" | "charge_hp" | "penerbangan"; label: string; value: number; unit: string }
export interface EquivalentFactor { key: Equivalent["key"]; label: string; kgCo2PerUnit: number; unit: string }
/**
 * `daytimeShare` (0..1): the part of an open day's load used while the sun shines; only that can be saved (no
 * export credit). Missing means all of it. `openDaysPerYear` (1..365, missing = 365): days the building is in
 * use; on the other days it draws `closedDayLoadShare` (0..1) of an open day's load as base load.
 */
export interface SolarInput { roofAreaM2: number; kwhYear: number; peakSunHours: number; backupHours: number; tariffRpPerKwh: number; costRpPerKwp: number; batteryRpPerKwh: number; gridFactorKgPerKwh: number; daytimeShare?: number; openDaysPerYear?: number; closedDayLoadShare?: number }
/** `kwhYear` is what the panels make; `selfUseKwh` of it is used on site (it saves money and CO2), `exportKwh` goes to the grid for nothing. `paybackPanelYears` leaves the backup battery out. */
export interface SolarResult { kWp: number; panels: number; kwhYear: number; selfUseKwh: number; exportKwh: number; coveragePct: number; batteryKwh: number; costRp: number; savingRpYear: number; paybackYears: number; paybackPanelYears: number; co2AvoidedKgYear: number }
export interface PvHour { time: string; ghiWm2: number; cloudPct: number; precipMm: number; weatherCode: number; pvKwh: number }
export interface RegionSummary { id: string; name: string; kind: "kabupaten" | "kota"; kwhYear: number; co2KgYear: number; population: number | null; customers: number | null; electrificationPct: number | null; villagesNoPln: number | null; estimated: boolean }
export type RecommendationCategory = "energi_terbarukan" | "efisiensi" | "tata_ruang" | "akses_listrik" | "kebijakan";
export interface RecommendationItem { title: string; category: RecommendationCategory; body: string; impact: string; priority: 1 | 2 | 3 }
/** `model` is the Claude model that wrote the items, or null for the rule-based fallback. */
export interface Recommendations { regionId: string; items: RecommendationItem[]; model: string | null; generatedAt: string }
