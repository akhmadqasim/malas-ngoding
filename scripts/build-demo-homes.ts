// Builds data/seed/demo-homes.json: about 300 demo homes, each on a real building footprint from
// OpenStreetMap (ODbL 1.0), fetched through the Overpass API, one request per city. Not Mapbox data: its
// terms forbid storing it. Raw answers are cached in git-ignored data/cache/osm/.
// The footprints are real; every other attribute (type, floors, kWh, interest, consent) is a synthetic
// demo value drawn from a fixed-seed PRNG, so a rebuild gives the same homes.
// Run: bun scripts/build-demo-homes.ts [--refresh]   (--refresh downloads again instead of using the cache)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "malas-ngoding/0.1 (energy digital twin of Kalimantan Timur; demo data build; contact via the repository)";
const CACHE_DIR = "data/cache/osm";
const OUT_FILE = "data/seed/demo-homes.json";
const SEED = 20251022;
const PAUSE_MS = 6000; // between cities, on top of the one-request-per-city rule
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 6;
const MIN_M2 = 40;
const MAX_M2 = 250;
const GRID = 6; // the box is cut in GRID x GRID cells; the sample is spread over them
const RESIDENTIAL = new Set(["house", "residential", "detached", "semidetached_house", "terrace", "yes"]);

export interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}
export interface City {
  key: string;
  name: string;
  target: number;
  box: Box;
}

/** Boxes of about 4 to 5 km around each city centre (0.04 degrees is about 4.4 km). */
export const CITIES: City[] = [
  { key: "samarinda", name: "Samarinda", target: 110, box: { south: -0.52, west: 117.13, north: -0.48, east: 117.17 } },
  { key: "balikpapan", name: "Balikpapan", target: 80, box: { south: -1.27, west: 116.81, north: -1.23, east: 116.85 } },
  { key: "bontang", name: "Bontang", target: 40, box: { south: 0.11, west: 117.48, north: 0.15, east: 117.52 } },
  { key: "tenggarong", name: "Tenggarong", target: 40, box: { south: -0.43, west: 116.97, north: -0.39, east: 117.01 } },
  { key: "penajam", name: "Penajam", target: 30, box: { south: -1.305, west: 116.725, north: -1.265, east: 116.765 } },
];

export interface OsmWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export interface Footprint {
  osmId: string;
  lng: number;
  lat: number;
  areaM2: number;
}

/** The Overpass QL of one city: every building way in the box, with its geometry. */
export function buildQuery(box: Box): string {
  const { south, west, north, east } = box;
  return `[out:json][timeout:90];way["building"](${south},${west},${north},${east});out geom;`;
}

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Projects lng/lat to metres around a reference latitude (equirectangular, fine at building scale). */
function project(points: { lat: number; lon: number }[]): [number, number][] {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const k = Math.cos(lat0 * RAD);
  return points.map((p) => [(p.lon - lon0) * RAD * EARTH_RADIUS_M * k, (p.lat - lat0) * RAD * EARTH_RADIUS_M]);
}

/** Area in m2 of a polygon given as lat/lon points (closing point optional), by the shoelace formula. */
export function polygonAreaM2(points: { lat: number; lon: number }[]): number {
  if (points.length < 3) return 0;
  const xy = project(points);
  let twice = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % xy.length]!;
    twice += x1 * y2 - x2 * y1;
  }
  return Math.abs(twice) / 2;
}

/** Area centroid of a polygon as [lng, lat]; falls back to the vertex mean for a degenerate one. */
export function polygonCentroid(points: { lat: number; lon: number }[]): [number, number] {
  const n = points.length;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / n;
  const xy = project(points);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % n]!;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) return [lon0, lat0];
  const k = Math.cos(lat0 * RAD);
  // project() centres on the same mean, so the projected centroid maps straight back.
  const x = cx / (3 * a);
  const y = cy / (3 * a);
  return [lon0 + x / (RAD * EARTH_RADIUS_M * k), lat0 + y / (RAD * EARTH_RADIUS_M)];
}

/**
 * The footprint of a residential-looking building way: closed, at least 4 points (3 corners and the
 * closing point), a building tag in the allowed set, and an area between MIN_M2 and MAX_M2. Otherwise null.
 */
export function footprintOf(way: OsmWay): Footprint | null {
  const g = way.geometry;
  if (!g || g.length < 4) return null;
  const first = g[0]!;
  const last = g[g.length - 1]!;
  if (first.lat !== last.lat || first.lon !== last.lon) return null;
  const kind = way.tags?.building;
  if (!kind || !RESIDENTIAL.has(kind)) return null;
  const ring = g.slice(0, -1);
  const areaM2 = polygonAreaM2(ring);
  if (areaM2 < MIN_M2 || areaM2 > MAX_M2) return null;
  const [lng, lat] = polygonCentroid(ring);
  return { osmId: `way/${way.id}`, lng, lat, areaM2 };
}

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, to seed a PRNG per home. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Picks up to `target` footprints spread over the box: they are cut in a grid, each cell is shuffled with the
 * seeded PRNG, and the sample takes one from each cell in turn, so no street or block dominates. Same input
 * and seed give the same picks.
 */
export function sampleSpread(items: Footprint[], target: number, box: Box, seed: number, grid = GRID): Footprint[] {
  const rand = mulberry32(seed);
  const sorted = [...items].sort((a, b) => a.osmId.localeCompare(b.osmId, "en", { numeric: true }));
  const cells = new Map<number, Footprint[]>();
  for (const f of sorted) {
    const cx = Math.min(grid - 1, Math.max(0, Math.floor(((f.lng - box.west) / (box.east - box.west)) * grid)));
    const cy = Math.min(grid - 1, Math.max(0, Math.floor(((f.lat - box.south) / (box.north - box.south)) * grid)));
    const key = cy * grid + cx;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(f);
  }
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const queues = shuffle([...cells.keys()].sort((a, b) => a - b)).map((k) => shuffle([...cells.get(k)!]));
  const picked: Footprint[] = [];
  while (picked.length < target && queues.some((q) => q.length)) {
    for (const q of queues) {
      const f = q.pop();
      if (f) picked.push(f);
      if (picked.length >= target) break;
    }
  }
  return picked;
}

export interface DemoHomeRecord {
  lng: number;
  lat: number;
  footprintM2: number;
  osmId: string;
  city: string;
  buildingType: "rumah" | "ruko";
  floors: number;
  kwhMonth: number | null;
  interestedPv: boolean;
  consentMap: boolean;
}

/** The synthetic attributes of a home, drawn from a PRNG seeded by the OSM id so they never depend on order. */
export function homeRecord(f: Footprint, city: string, seed = SEED): DemoHomeRecord {
  const rand = mulberry32(hashString(`${seed}:${f.osmId}`));
  const footprintM2 = Math.round(f.areaM2 * 10) / 10;
  const ruko = rand() < 0.15;
  const floors = ruko ? (rand() < 0.6 ? 2 : 3) : rand() < 0.8 ? 1 : 2;
  const rate = ruko ? 2 + rand() * 1.5 : 0.9 + rand() * 0.7; // kWh per m2 of footprint per month
  const hasBill = rand() < 0.6;
  const kwhMonth = hasBill ? Math.max(40, Math.round(footprintM2 * rate)) : null;
  const interestedPv = rand() < 0.32 + 0.16 * Math.min(1, Math.max(0, (footprintM2 - MIN_M2) / (MAX_M2 - MIN_M2)));
  const consentMap = rand() < 0.85;
  return {
    lng: Math.round(f.lng * 1e7) / 1e7,
    lat: Math.round(f.lat * 1e7) / 1e7,
    footprintM2,
    osmId: f.osmId,
    city,
    buildingType: ruko ? "ruko" : "rumah",
    floors,
    kwhMonth,
    interestedPv,
    consentMap,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POSTs the query to Overpass with a timeout and backoff on 429, 502, 503 and 504. */
async function fetchOverpass(query: string): Promise<{ elements: OsmWay[] }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as { elements: OsmWay[] };
      if (![429, 502, 503, 504].includes(res.status) || attempt >= MAX_ATTEMPTS) throw new Error(`Overpass answered ${res.status}`);
      console.log(`  Overpass answered ${res.status}, retrying`);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      console.log(`  ${err instanceof Error ? err.message : "request failed"}, retrying`);
    }
    await sleep(15_000 * 2 ** (attempt - 1));
  }
}

async function loadCity(c: City, refresh: boolean): Promise<{ ways: OsmWay[]; date: string } | null> {
  const file = `${CACHE_DIR}/${c.key}.json`;
  if (!refresh && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as { elements: OsmWay[] };
    return { ways: cached.elements, date: statSync(file).mtime.toISOString().slice(0, 10) };
  }
  try {
    const answer = await fetchOverpass(buildQuery(c.box));
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(answer));
    await sleep(PAUSE_MS);
    return { ways: answer.elements, date: new Date().toISOString().slice(0, 10) };
  } catch (err) {
    console.log(`  ${c.name}: Overpass failed (${err instanceof Error ? err.message : "unknown"}); no homes for this city`);
    return null;
  }
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

async function main() {
  const refresh = process.argv.includes("--refresh");
  const homes: DemoHomeRecord[] = [];
  const dates: string[] = [];
  for (const [i, c] of CITIES.entries()) {
    console.log(`${c.name}: ${buildQuery(c.box)}`);
    const got = await loadCity(c, refresh);
    if (!got) continue;
    dates.push(got.date);
    const feet = got.ways.filter((w) => w.type === "way").map(footprintOf).filter((f): f is Footprint => f !== null);
    const picked = sampleSpread(feet, c.target, c.box, SEED + i);
    console.log(`  ${got.ways.length} building ways, ${feet.length} residential-sized, ${picked.length} picked (target ${c.target})`);
    if (picked.length < c.target) console.log(`  fewer than the target: taking what there is, no footprints invented`);
    homes.push(...picked.map((f) => homeRecord(f, c.name)));
  }
  homes.sort((a, b) => a.city.localeCompare(b.city) || a.osmId.localeCompare(b.osmId, "en", { numeric: true }));
  const date = dates.sort().at(-1) ?? "unknown";
  const boxes = CITIES.map((c) => `${c.name} ${c.box.south},${c.box.west},${c.box.north},${c.box.east}`).join("; ");
  const source =
    `Building footprints from OpenStreetMap contributors (ODbL 1.0, openstreetmap.org/copyright) via the Overpass API, query ` +
    `way["building"](south,west,north,east); out geom; in the boxes (south,west,north,east) ${boxes}, downloaded ${date}, ` +
    `filtered to ${MIN_M2}-${MAX_M2} m2 closed ways tagged building=${[...RESIDENTIAL].join("|")}; ` +
    `every other attribute is a synthetic demo value (asumsi).`;
  mkdirSync("data/seed", { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify({ source, homes }, null, 1) + "\n");
  console.log(`\nwrote ${homes.length} homes to ${OUT_FILE}`);
  for (const c of CITIES) console.log(`  ${c.name}: ${homes.filter((h) => h.city === c.name).length}`);
  console.log(
    `with kwhMonth ${pct(homes.filter((h) => h.kwhMonth !== null).length, homes.length)}, ` +
      `interestedPv ${pct(homes.filter((h) => h.interestedPv).length, homes.length)}, ` +
      `consentMap ${pct(homes.filter((h) => h.consentMap).length, homes.length)}, ` +
      `ruko ${pct(homes.filter((h) => h.buildingType === "ruko").length, homes.length)}`,
  );
}

if (import.meta.main) await main();
