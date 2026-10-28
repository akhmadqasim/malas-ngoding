/*
 * Renewable potential of a NASA POWER grid cell: what 1 MWp of ground-mounted solar (PLTS) or one wind
 * turbine (PLTB) would make there in a year. Pure, so the sheet and the tests compute the same numbers.
 * The assumptions (data/seed/re-assumptions.json) come from docs/research/renewable-potential.md.
 */

export interface PotentialAssumptions {
  pv: { performanceRatio: number; haPerMwp: number; costRpPerMwp: number };
  wind: {
    hubHeightM: number;
    /** Power-law wind shear exponent, to lift the 50 m speed to the hub. */
    shearExponent: number;
    ratedMw: number;
    /** Wake, availability and electrical losses: the share of the curve's energy delivered. */
    lossFactor: number;
    /** Power curve: [wind speed m/s, share of rated power 0..1], ascending; zero outside it. */
    curve: [number, number][];
    /** Below this mean speed at hub height utility wind is usually not considered viable, m/s. */
    viableMeanMs: number;
  };
  source: string;
}

const HOURS_PER_YEAR = 8760;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** MWh a year from 1 MWp of PLTS at `ghi` kWh/m2/day (which equals peak sun hours). */
export function pvYieldMwhPerMwp(ghi: number, performanceRatio: number): number {
  return pos(ghi) * 365 * pos(performanceRatio);
}

/** The mean wind speed at hub height, from the 50 m speed by the power law. */
export function hubSpeed(ws50: number, hubHeightM: number, shearExponent: number): number {
  return pos(ws50) * (pos(hubHeightM) / 50) ** pos(shearExponent);
}

/** Share of rated power at `v` m/s, linear between the curve points, zero below the first and above the last. */
export function powerShare(v: number, curve: [number, number][]): number {
  const first = curve[0];
  const last = curve.at(-1);
  if (!first || !last || v < first[0] || v > last[0]) return 0;
  for (let i = 1; i < curve.length; i++) {
    const [v1, p1] = curve[i]!;
    const [v0, p0] = curve[i - 1]!;
    if (v <= v1) return v1 === v0 ? p1 : p0 + ((p1 - p0) * (v - v0)) / (v1 - v0);
  }
  return 0;
}

/**
 * Capacity factor of a turbine at a site with mean speed `mean`, the speeds spread as a Rayleigh distribution
 * (Weibull k = 2, the usual assumption when only the mean is known).
 */
export function capacityFactor(mean: number, curve: [number, number][]): number {
  const m = pos(mean);
  if (m === 0) return 0;
  const step = 0.05;
  let cf = 0;
  for (let v = step / 2; v < 40; v += step) {
    const pdf = ((Math.PI * v) / (2 * m * m)) * Math.exp((-Math.PI * v * v) / (4 * m * m));
    cf += powerShare(v, curve) * pdf * step;
  }
  return cf;
}

export interface CellPotential {
  /** PLTS: MWh a year per MWp, land per MWp and cost per MWp. */
  pvMwhPerMwp: number;
  /** Wind at hub height, the turbine's capacity factor and its MWh a year. */
  hubMs: number;
  windCf: number;
  windMwhPerTurbine: number;
  windViable: boolean;
}

export function cellPotential(cell: { ghi: number; ws50: number }, a: PotentialAssumptions): CellPotential {
  const hubMs = hubSpeed(cell.ws50, a.wind.hubHeightM, a.wind.shearExponent);
  const windCf = capacityFactor(hubMs, a.wind.curve) * pos(a.wind.lossFactor);
  return {
    pvMwhPerMwp: pvYieldMwhPerMwp(cell.ghi, a.pv.performanceRatio),
    hubMs,
    windCf,
    windMwhPerTurbine: pos(a.wind.ratedMw) * HOURS_PER_YEAR * windCf,
    windViable: hubMs >= a.wind.viableMeanMs,
  };
}

/**
 * Where each value sits on the legend's scale, 0..1: between `lo` and `hi`. The sun's scale spans the cells'
 * own range (Kaltim's sun varies little, so a fixed scale would show one colour); the wind's runs from 0 to
 * the viable speed, so weak wind looks weak.
 */
export function scaleBetween<T>(items: T[], value: (item: T) => number, lo: number, hi: number): Map<T, number> {
  const span = hi - lo;
  return new Map(items.map((it) => [it, span > 0 ? Math.min(Math.max((value(it) - lo) / span, 0), 1) : 0.5]));
}
