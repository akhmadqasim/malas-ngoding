import type { Metric } from "./store.ts";
import type { RegionSummary } from "../shared/types.ts";

/** How each metric reads in the interface. CO2 is stored in kg and shown in tonnes. */
export const METRIC_TEXT: Record<
  Metric,
  { label: string; total: string; unit: string; unitShort: string; scale: number; value: (r: RegionSummary) => number }
> = {
  co2: { label: "Emisi CO2", total: "Total emisi CO2", unit: "ton CO2 per tahun", unitShort: "ton CO2/tahun", scale: 1 / 1000, value: (r) => r.co2KgYear },
  kwh: { label: "Listrik terpakai", total: "Total listrik terpakai", unit: "kWh per tahun", unitShort: "kWh/tahun", scale: 1, value: (r) => r.kwhYear },
};
