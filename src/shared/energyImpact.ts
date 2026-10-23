import type { SensorFrame } from "./telemetry.ts";
import type { WeatherCase } from "./telemetry.ts";

/** Compare the same packet's load with/without PV; exporting never receives an on-site credit. */
export function energyImpact(frame: SensorFrame, gridFactor: number | null) {
  const coveragePct = frame.loadKw > 0 ? Math.min(100, frame.selfUseKw / frame.loadKw * 100) : 0;
  const baselineKgHour = gridFactor == null ? null : frame.loadKw * gridFactor;
  return { coveragePct, baselineKgHour, remainingKgHour: gridFactor == null ? null : frame.co2KgHour,
    avoidedKgHour: gridFactor == null ? null : frame.avoidedKgHour,
    gridSharePct: frame.loadKw > 0 ? frame.importKw / frame.loadKw * 100 : 0,
    status: coveragePct >= 99.9 ? "covered" as const : coveragePct > 0 ? "partial" as const : "grid" as const };
}

/** Model history, explicitly not an archive of measured or received IoT packets. */
export function telemetryCsv(frames: SensorFrame[], meta: { id: string; scenario: WeatherCase; kWp: number; gridFactor: number | null }): string {
  const cell = (value: string | number | null) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows: (string | number | null)[][] = [["dataset", "device_id", "scenario", "capacity_kWp", "timestamp_utc", "sequence", "solar_kW", "load_kW", "self_use_kW", "import_kW", "export_kW", "co2_kg_per_hour", "avoided_kg_per_hour", "grid_factor_kg_per_kWh", "weather_source"]];
  const n = (value: number) => Math.round(value * 1e6) / 1e6;
  for (const f of frames) rows.push(["riwayat_model_sintetis_bukan_pengukuran", meta.id, meta.scenario, meta.kWp, new Date(f.timestamp).toISOString(), f.sequence,
    n(f.solarKw), n(f.loadKw), n(f.selfUseKw), n(f.importKw), n(f.exportKw), meta.gridFactor == null ? null : n(f.co2KgHour),
    meta.gridFactor == null ? null : n(f.avoidedKgHour), meta.gridFactor, f.weatherSource]);
  return "\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
