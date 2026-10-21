import { co2BySource } from "./emissions.ts";
import { toEquivalents } from "./equivalents.ts";
import type { BuildingEstimate, BuildingInput, BuildingType, EquivalentFactor, GridMix } from "./types.ts";

const MIN_FOOTPRINT_M2 = 10;
const MAX_FOOTPRINT_M2 = 50_000;
const MIN_FLOORS = 1;
const MAX_FLOORS = 40;

export function inferType(
  poiClass: string | null | undefined,
  poiType: string | null | undefined,
  footprintM2: number,
): { type: BuildingType; source: "poi" | "footprint" } {
  const cls = (poiClass ?? "").trim().toLowerCase();
  const kind = (poiType ?? "").trim().toLowerCase();
  const poi = (type: BuildingType) => ({ type, source: "poi" as const });

  switch (cls) {
    case "education":
      if (kind === "school") return poi("sekolah");
      if (kind === "college" || kind === "university") return poi("kampus");
      break;
    case "medical":
      if (kind === "hospital" || kind === "clinic") return poi("rumah_sakit");
      break;
    case "lodging":
      return poi("hotel");
    case "store_like":
      if (kind === "mall" || kind === "department store") return poi("mal");
      return poi("ruko");
    case "food_and_drink":
      return poi("ruko");
    case "commercial_services":
      if (kind === "office") return poi("kantor");
      return poi("ruko");
    case "general":
      if (kind === "government") return poi("pemerintahan");
      if (kind === "office") return poi("kantor");
      break;
    case "religion":
      return poi("ibadah");
    case "industrial":
      return poi("industri");
  }

  if (footprintM2 < 250) return { type: "rumah", source: "footprint" };
  if (footprintM2 < 2000) return { type: "ruko", source: "footprint" };
  return { type: "gudang", source: "footprint" };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function estimateFloors(_type: BuildingType, heightM: number | null, typicalFloors: number, floorHeightM = 3.5): number {
  const raw = heightM === null || !Number.isFinite(heightM) || heightM <= 3 ? typicalFloors : Math.round(heightM / floorHeightM);
  return clamp(Number.isFinite(raw) ? Math.round(raw) : MIN_FLOORS, MIN_FLOORS, MAX_FLOORS);
}

export function estimateBuilding(
  input: BuildingInput,
  ctx: {
    types: Record<BuildingType, { intensityKwhM2Year: number; typicalFloors: number }>;
    grid: GridMix;
    equivalents: EquivalentFactor[];
    region: { id: string; name: string } | null;
  },
): BuildingEstimate {
  const assumptions: string[] = [];

  // Only NaN means "unknown". +-Infinity is a number that is out of range, so it clamps like any other.
  const footprintKnown = !Number.isNaN(input.footprintM2);
  const footprint = clamp(footprintKnown ? input.footprintM2 : MIN_FOOTPRINT_M2, MIN_FOOTPRINT_M2, MAX_FOOTPRINT_M2);
  if (!footprintKnown) {
    assumptions.push(`Luas lantai dasar tidak diketahui, dipakai ${MIN_FOOTPRINT_M2} m2.`);
  } else if (footprint !== input.footprintM2) {
    assumptions.push(`Luas lantai dasar dibatasi ke ${footprint.toLocaleString("id-ID")} m2 agar perkiraan tetap masuk akal.`);
  }

  let type: BuildingType;
  let typeSource: BuildingEstimate["typeSource"];
  if (input.typeOverride) {
    type = input.typeOverride;
    typeSource = "user";
  } else {
    const inferred = inferType(input.poiClass, input.poiType, footprint);
    type = inferred.type;
    typeSource = inferred.source;
    if (typeSource === "footprint") {
      assumptions.push(`Jenis bangunan tidak ada di data peta, ditebak dari luas lantai dasar: ${type.replace("_", " ")}.`);
    }
  }

  const params = ctx.types[type];
  let floors: number;
  if (input.floorsOverride !== undefined && Number.isFinite(input.floorsOverride)) {
    floors = clamp(Math.round(input.floorsOverride), MIN_FLOORS, MAX_FLOORS);
  } else {
    floors = estimateFloors(type, input.heightM, params.typicalFloors);
    // A height of 0 or less is how a missing height often arrives, so it counts as missing.
    if (input.heightM === null || !Number.isFinite(input.heightM) || input.heightM <= 0) {
      assumptions.push(`Tinggi bangunan tidak ada di data peta, dipakai jumlah lantai umum: ${floors} lantai.`);
    } else if (input.heightM <= 3) {
      const height = input.heightM.toLocaleString("id-ID", { maximumFractionDigits: 1 });
      assumptions.push(`Tinggi bangunan di data peta hanya ${height} m, terlalu rendah untuk menghitung lantai, dipakai jumlah lantai umum: ${floors} lantai.`);
    }
  }

  if (ctx.region === null) {
    assumptions.push("Lokasi di luar Kalimantan Timur, dipakai faktor emisi jaringan listrik Kalimantan Timur.");
  }

  const floorAreaM2 = footprint * floors;
  const kwhYear = floorAreaM2 * params.intensityKwhM2Year;
  const co2KgYear = kwhYear * ctx.grid.factorKgPerKwh;

  return {
    featureId: input.featureId,
    type,
    typeSource,
    floors,
    floorAreaM2,
    kwhYear,
    kwhMonth: kwhYear / 12,
    co2KgYear,
    bySource: co2BySource(kwhYear, ctx.grid),
    equivalents: toEquivalents(co2KgYear, ctx.equivalents),
    region: ctx.region,
    assumptions,
  };
}

/** Mean Earth radius in metres (IUGG), the sphere the footprint area is measured on. */
const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Signed spherical area of one ring of [lng, lat] points (Chamberlain and Duquette, 2007). */
function ringAreaM2(ring: number[][]): number {
  const pts = ring.filter((p) => p.length >= 2);
  if (pts.length !== ring.length) return Number.NaN;
  const n = pts.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [lng1 = 0, lat1 = 0] = pts[i]!;
    const [lng2 = 0, lat2 = 0] = pts[(i + 1) % n]!;
    sum += (lng2 - lng1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
  }
  return (sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/**
 * Area in m2 of a GeoJSON polygon's rings ([lng, lat] degrees): the outer ring minus its holes, on a
 * sphere, whatever the winding order. An unclosed ring counts as closed. Bad input gives 0, never NaN.
 */
export function polygonAreaM2(coords: number[][][]): number {
  const [outer, ...holes] = coords;
  if (!outer) return 0;
  const area = Math.abs(ringAreaM2(outer)) - holes.reduce((sum, h) => sum + Math.abs(ringAreaM2(h)), 0);
  return Number.isFinite(area) && area > 0 ? area : 0;
}
