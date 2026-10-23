import { rooftopScenario, type ScenarioBasis } from "./scenario.ts";
import type { RegionSummary } from "./types.ts";
import { yieldPerKwpYear } from "./solar.ts";

/** Technical shortlist only: no claim about permits, grid headroom, budgets or construction speed. */
export function transitionPriorities(regions: RegionSummary[], basis: ScenarioBasis, sort: "efficiency" | "impact" = "efficiency") {
  const scenario = rooftopScenario(regions, basis, 0.1);
  return regions.map(region => {
    const climate = basis.regions.find(r => r.id === region.id);
    const sunlight = climate?.peakSunHours;
    const valid = !climate?.fallback && sunlight != null && Number.isFinite(sunlight) && sunlight > 0 && Number.isFinite(basis.costRpPerKwp) && basis.costRpPerKwp > 0 && Number.isFinite(basis.solarFactorKgPerKwh) && basis.solarFactorKgPerKwh > 0;
    const project = scenario.regions.find(r => r.id === region.id)!;
    const yieldKwh = valid ? yieldPerKwpYear(sunlight) : null;
    const tonnesPerBillion = yieldKwh == null ? null : yieldKwh * basis.solarFactorKgPerKwh / 1000 * (1e9 / basis.costRpPerKwp);
    return { id: region.id, name: region.name, sunlight: valid ? sunlight : null, yieldKwh, tonnesPerBillion, project,
      estimated: region.estimated, rankValue: !valid ? null : sort === "impact" ? project.co2AvoidedKgYear : tonnesPerBillion };
  }).sort((a, b) => (b.rankValue ?? -1) - (a.rankValue ?? -1) || a.name.localeCompare(b.name, "id"));
}
