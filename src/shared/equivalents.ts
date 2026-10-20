import type { Equivalent, EquivalentFactor } from "./types.ts";

export function toEquivalents(co2Kg: number, factors: EquivalentFactor[]): Equivalent[] {
  const co2 = Number.isFinite(co2Kg) && co2Kg > 0 ? co2Kg : 0;
  return factors
    .filter((f) => Number.isFinite(f.kgCo2PerUnit) && f.kgCo2PerUnit > 0)
    .map((f) => ({ key: f.key, label: f.label, value: co2 / f.kgCo2PerUnit, unit: f.unit }));
}
