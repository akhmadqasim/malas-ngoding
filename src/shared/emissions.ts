import type { FuelType, GridMix } from "./types.ts";

export function co2BySource(kwh: number, grid: GridMix): { fuel: FuelType; kwh: number; co2Kg: number }[] {
  const energy = Number.isFinite(kwh) && kwh > 0 ? kwh : 0;
  const fuels = Object.keys(grid.shares) as FuelType[];

  const raw = fuels
    .map((fuel) => {
      const share = grid.shares[fuel] ?? 0;
      const fuelKwh = energy * share;
      return { fuel, kwh: fuelKwh, co2Kg: fuelKwh * (grid.fuelFactors[fuel] ?? 0) };
    })
    .filter((r) => r.kwh > 0);

  // Scale so the total matches the published grid factor exactly.
  const rawTotal = raw.reduce((sum, r) => sum + r.co2Kg, 0);
  const target = energy * grid.factorKgPerKwh;
  if (rawTotal > 0) {
    const scale = target / rawTotal;
    return raw.map((r) => ({ ...r, co2Kg: r.co2Kg * scale })).sort((a, b) => b.co2Kg - a.co2Kg);
  }

  // Every present fuel has a zero factor, so there is no weighting to scale: split the total by energy share.
  const rawKwh = raw.reduce((sum, r) => sum + r.kwh, 0);
  return raw
    .map((r) => ({ ...r, co2Kg: rawKwh > 0 ? (target * r.kwh) / rawKwh : 0 }))
    .sort((a, b) => b.co2Kg - a.co2Kg || b.kwh - a.kwh);
}
