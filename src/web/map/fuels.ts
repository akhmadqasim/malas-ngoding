import type { ExpressionSpecification } from "mapbox-gl";
import type { PlantCollection } from "../api.ts";
import type { FuelType } from "../../shared/types.ts";

/** Legend order. Colours are the `--color-fuel-*` tokens in styles.css. */
export const FUELS: readonly FuelType[] = ["batubara", "gas", "diesel", "surya", "air", "biomassa", "lainnya"];

export const FUEL_LABELS: Record<FuelType, string> = {
  batubara: "Batu bara",
  gas: "Gas",
  diesel: "Diesel",
  surya: "Surya",
  air: "Air",
  biomassa: "Biomassa",
  lainnya: "Lainnya",
};

/** A plant's fuel as one of the known keys; anything else counts as "lainnya". */
export function fuelKey(fuel: string): FuelType {
  return (FUELS as readonly string[]).includes(fuel) ? (fuel as FuelType) : "lainnya";
}

/** Fuels that appear in the data, once each, in legend order. */
export function fuelsPresent(fc: PlantCollection): FuelType[] {
  const present = new Set(fc.features.map((f) => fuelKey(f.properties.fuel)));
  return FUELS.filter((f) => present.has(f));
}

/** `icon-image` for the plant layer, naming only the marker images that were registered. */
export function plantIconExpression(present: readonly FuelType[]): ExpressionSpecification | string {
  const named = present.filter((f) => f !== "lainnya");
  if (named.length === 0) return "plant-lainnya";
  return ["concat", "plant-", ["match", ["get", "fuel"], named, ["get", "fuel"], "lainnya"]];
}
