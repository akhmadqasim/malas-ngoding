// Builds data/seed/regions.geojson: the 10 Kalimantan Timur regencies/cities cut out of the
// geoBoundaries gbOpen IDN ADM2 file (CC BY 3.0 IGO). Run: bun scripts/build-boundaries.ts
import { existsSync, mkdirSync } from "node:fs";

const SOURCE_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM2/geoBoundaries-IDN-ADM2_simplified.geojson";
const CACHE_FILE = "data/cache/idn-adm2-simplified.geojson";
const OUT_FILE = "data/seed/regions.geojson";
const MAX_BYTES = 2 * 1024 * 1024;
const DECIMALS = 5; // about 1 m, plenty for a regency outline

/** geoBoundaries `shapeName` -> region id used everywhere else in the app. */
export const NAME_TO_ID: Record<string, string> = {
  Paser: "paser",
  "Kutai Barat": "kutai-barat",
  "Kutai Kartanegara": "kutai-kartanegara",
  "Kutai Timur": "kutai-timur",
  Berau: "berau",
  "Penajam Paser Utara": "penajam-paser-utara",
  "Mahakam Hulu": "mahakam-ulu", // geoBoundaries spells it "Hulu"
  "Kota Balikpapan": "balikpapan",
  "Kota Samarinda": "samarinda",
  "Kota Bontang": "bontang",
};

type Geometry = { type: string; coordinates: unknown };
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry };

function roundCoords(c: unknown): unknown {
  const f = 10 ** DECIMALS;
  if (typeof c === "number") return Math.round(c * f) / f;
  return (c as unknown[]).map(roundCoords);
}

async function loadSource(): Promise<{ features: Feature[] }> {
  if (!existsSync(CACHE_FILE)) {
    console.log(`downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL, { redirect: "follow" });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    mkdirSync("data/cache", { recursive: true });
    await Bun.write(CACHE_FILE, res);
  }
  return Bun.file(CACHE_FILE).json();
}

async function main() {
  const src = await loadSource();
  const features: Feature[] = [];
  for (const f of src.features) {
    const id = NAME_TO_ID[String(f.properties.shapeName)];
    if (!id) continue;
    features.push({
      type: "Feature",
      properties: { id, name: f.properties.shapeName },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
    });
  }
  const missing = Object.values(NAME_TO_ID).filter(
    (id) => !features.some((f) => f.properties.id === id),
  );
  if (missing.length > 0) throw new Error(`regions not found in source: ${missing.join(", ")}`);

  features.sort((a, b) => String(a.properties.id).localeCompare(String(b.properties.id)));
  const text = JSON.stringify({ type: "FeatureCollection", features });
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BYTES) throw new Error(`output is ${bytes} bytes, limit is ${MAX_BYTES}`);
  await Bun.write(OUT_FILE, text + "\n");
  console.log(`wrote ${OUT_FILE}: ${features.length} regions, ${bytes} bytes`);
}

if (import.meta.main) await main();
