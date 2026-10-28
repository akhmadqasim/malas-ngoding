import type { PotentialAssumptions } from "./potential.ts";
import { capacityFactor, hubSpeed, pvYieldMwhPerMwp } from "./potential.ts";

/*
 * "Bangun di sini": a ground-mounted solar farm (PLTS) or a row of wind turbines (PLTB) placed at a point of
 * the potential map. What it makes, saves and costs, and where each mounting table or turbine stands, so the
 * map can draw it in 3D. Pure, so the sheet, the map and the tests agree.
 */

/** One mounting table of the 3D model (public/models/solar-table.glb): 2 x 10 panels of 0,55 kWp. */
export const TABLE_KWP = 20 * 0.55;
/** Row pitch of the tables, m: the table depth plus room so a row does not shade the next at a 10° tilt. */
export const ROW_PITCH_M = 7;
/** Width of one table along its row, m (10 panels of 1,13 m with gaps), plus a small gap. */
export const TABLE_WIDTH_M = 11.6;
/** Rotor diameter of the 4,5 MW turbine model, m, and turbines kept this many diameters apart. */
export const ROTOR_DIAMETER_M = 150;
export const TURBINE_SPACING_D = 5;
/** Largest farms the map draws (thousands of tables are still light for a model layer). */
export const MAX_SOLAR_MWP = 30;
export const MAX_TURBINES = 10;

const M_PER_DEG_LAT = 111_320;
const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** [lng, lat] moved `east` and `north` metres from `at`. */
export function offset([lng, lat]: [number, number], east: number, north: number): [number, number] {
  return [lng + east / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)), lat + north / M_PER_DEG_LAT];
}

export interface SolarFarm {
  mwp: number;
  areaHa: number;
  mwhYear: number;
  co2AvoidedTonYear: number;
  costRp: number;
  /** Where each table stands, row by row inside a square footprint centred on the site. */
  tables: [number, number][];
}

/**
 * A PLTS of `mwp` at `at` with the site's `ghi`: land from the hectares per MWp, output from the sun, CO2
 * avoided at `avoidedKgPerKwh` (the Kepmen factor for PLTS/PLTB). The tables fill a square of that land in
 * east-west rows facing north.
 */
export function solarFarm(at: [number, number], mwp: number, ghi: number, a: PotentialAssumptions, avoidedKgPerKwh: number): SolarFarm {
  const size = Math.min(pos(mwp), MAX_SOLAR_MWP);
  const areaHa = size * pos(a.pv.haPerMwp);
  const mwhYear = size * pvYieldMwhPerMwp(ghi, a.pv.performanceRatio);
  const count = Math.round((size * 1000) / TABLE_KWP);
  const side = Math.sqrt(areaHa * 10_000);
  // Rows as tight as the pitch allows; the land left over is roads and spacing, inside the same square.
  const rows = Math.max(1, Math.min(Math.floor(side / ROW_PITCH_M), Math.ceil(count / Math.max(1, Math.floor(side / TABLE_WIDTH_M)))));
  const perRow = Math.ceil(count / rows);
  const tables: [number, number][] = [];
  for (let r = 0; r < rows && tables.length < count; r++) {
    const north = (r - (rows - 1) / 2) * ROW_PITCH_M;
    for (let i = 0; i < perRow && tables.length < count; i++) {
      tables.push(offset(at, (i - (perRow - 1) / 2) * TABLE_WIDTH_M, north));
    }
  }
  return {
    mwp: size,
    areaHa,
    mwhYear,
    co2AvoidedTonYear: (mwhYear * 1000 * pos(avoidedKgPerKwh)) / 1000,
    costRp: size * pos(a.pv.costRpPerMwp),
    tables,
  };
}

/** `n` turbine spots `gap` metres apart in rows of up to four, the block centred on `at`. */
export function windSites(at: [number, number], n: number, gap: number): [number, number][] {
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    return offset(at, ((i % cols) - (inRow - 1) / 2) * gap, (r - (rows - 1) / 2) * gap);
  });
}

/** Radius a site check must keep clear for a farm, m: the PLTS's land square, or the turbine block plus a setback. */
export function farmRadiusM(kind: "sun" | "wind", size: number, a: { pv: { haPerMwp: number } }): number {
  if (kind === "sun") return (Math.sqrt(Math.min(pos(size), MAX_SOLAR_MWP) * a.pv.haPerMwp * 10_000) / 2) * Math.SQRT2;
  const n = Math.min(Math.max(Math.round(pos(size)), 1), MAX_TURBINES);
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  const gap = ROTOR_DIAMETER_M * TURBINE_SPACING_D;
  // Half the block's diagonal, plus 500 m kept between a turbine and the nearest house.
  return Math.hypot(((cols - 1) * gap) / 2, ((rows - 1) * gap) / 2) + 500;
}

export interface WindFarm {
  turbines: number;
  mw: number;
  hubMs: number;
  capacityFactor: number;
  mwhYear: number;
  co2AvoidedTonYear: number;
  viable: boolean;
  /** Where each turbine stands: a compact block, five rotor diameters apart, centred on the site. */
  sites: [number, number][];
}

export function windFarm(at: [number, number], turbines: number, ws50: number, a: PotentialAssumptions, avoidedKgPerKwh: number): WindFarm {
  const n = Math.min(Math.max(Math.round(pos(turbines)), 1), MAX_TURBINES);
  const hubMs = hubSpeed(ws50, a.wind.hubHeightM, a.wind.shearExponent);
  const cf = capacityFactor(hubMs, a.wind.curve) * pos(a.wind.lossFactor);
  const mw = n * pos(a.wind.ratedMw);
  const mwhYear = mw * 8760 * cf;
  const gap = ROTOR_DIAMETER_M * TURBINE_SPACING_D;
  return {
    turbines: n,
    mw,
    hubMs,
    capacityFactor: cf,
    mwhYear,
    co2AvoidedTonYear: (mwhYear * 1000 * pos(avoidedKgPerKwh)) / 1000,
    viable: hubMs >= a.wind.viableMeanMs,
    sites: windSites(at, n, gap),
  };
}
