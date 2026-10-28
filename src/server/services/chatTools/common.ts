import type Anthropic from "@anthropic-ai/sdk";
import { fmtCompact, fmtNumber } from "../../../shared/format.ts";
import { resolveRegion } from "../../../shared/regionAlias.ts";
import type { BuildingType } from "../../../shared/types.ts";
import type { AppDeps } from "../../app.ts";
import type { ChatAction } from "./actions.ts";

// Shared by every chat tool: input checks, parameter schemas and the formatting of numbers Claude quotes.

/** What a tool gives back: a JSON-able result for Claude, or a problem Claude reads as an error result. */
export type ToolOutput = { result: unknown } | { problem: string };

/** A tool that runs on the server; its result goes back to Claude. `emit` hands a map action to the browser. */
export interface ServerTool {
  definition: Anthropic.Tool;
  run: (deps: AppDeps, input: Record<string, unknown>, emit: (action: ChatAction) => void) => Promise<ToolOutput>;
}

/**
 * Points the upstream tools (Tilequery, NASA POWER, Open-Meteo, Mapbox search) accept: Kalimantan Timur
 * (lng 113.8 to 119.0, lat -2.4 to 2.6) with about a degree of margin, so border areas still work.
 */
export const KALTIM_AREA = { minLng: 112.5, maxLng: 120.5, minLat: -3.5, maxLat: 3.8 } as const;

export const REGION_NAMES =
  "Balikpapan, Samarinda, Bontang, Berau, Paser, Kutai Kartanegara (Kukar), Kutai Barat (Kubar), " +
  "Kutai Timur (Kutim), Penajam Paser Utara (PPU), Mahakam Ulu (Mahulu)";
export const REGION_PARAM = {
  type: "string",
  description: `A kabupaten/kota of Kalimantan Timur by name, alias or id: ${REGION_NAMES}. "Kota ..." and "Kabupaten ..." are fine.`,
};
export const lngParam = (of: string) => ({
  type: "number",
  minimum: -180,
  maximum: 180,
  description: `Longitude of ${of} in degrees (Kalimantan Timur spans about 113.8 to 119.0).`,
});
export const latParam = (of: string) => ({
  type: "number",
  minimum: -90,
  maximum: 90,
  description: `Latitude of ${of} in degrees (Kalimantan Timur spans about -2.4 to 2.6).`,
});

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;

export function point(i: Record<string, unknown>): { lng: number; lat: number } | { problem: string } {
  if (!inRange(i.lng, -180, 180)) return { problem: "lng harus berupa angka dari -180 sampai 180." };
  if (!inRange(i.lat, -90, 90)) return { problem: "lat harus berupa angka dari -90 sampai 90." };
  return { lng: i.lng, lat: i.lat };
}

/** A point for a tool that calls an upstream API: it must lie in or near Kalimantan Timur. */
export function kaltimPoint(lng: number, lat: number): { problem: string } | null {
  const a = KALTIM_AREA;
  if (lng >= a.minLng && lng <= a.maxLng && lat >= a.minLat && lat <= a.maxLat) return null;
  return {
    problem:
      `Titik lng ${lng}, lat ${lat} berada jauh di luar Kalimantan Timur. Alat ini hanya untuk wilayah Kaltim ` +
      `(lng ${a.minLng} sampai ${a.maxLng}, lat ${a.minLat} sampai ${a.maxLat}).`,
  };
}

/** The value as one of `values`, ignoring case and spaces around it, or null. */
export function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase();
  return (values as readonly string[]).includes(key) ? (key as T) : null;
}

export function region(v: unknown): { id: string } | { problem: string } {
  const text = typeof v === "string" ? v : "";
  const id = resolveRegion(text);
  if (id) return { id };
  return { problem: `"${text.slice(0, 80)}" bukan kabupaten/kota di Kalimantan Timur. Pilihan: ${REGION_NAMES}.` };
}

// ---------- formatting shared by the server tools ----------

export const NO_DATA = "belum ada data";

export const estimated = (text: string, isEstimate = true) => (isEstimate ? `${text} (perkiraan)` : text);
export const kwhPerYear = (kwh: number) => `${fmtCompact(kwh)} kWh per tahun`;
export const co2PerYear = (kg: number) => `${fmtCompact(kg / 1000)} ton CO2 per tahun`;
export const percent = (n: number, digits = 1) => `${fmtNumber(n, digits)}%`;

/** A building type in words: "rumah_sakit" reads "rumah sakit". */
export function buildingTypeLabel(type: BuildingType): string {
  return type.replace("_", " ");
}
