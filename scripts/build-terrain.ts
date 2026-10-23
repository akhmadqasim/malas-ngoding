// Builds data/seed/re-terrain.json: per solar-grid-cell terrain statistics (elevation, slope, share of
// flat land) over Kalimantan Timur, from AWS Open Data Terrain Tiles (Mapzen terrarium PNG, zoom 10).
// Tiles are cached in git-ignored data/cache/terrain/. Run: bun scripts/build-terrain.ts [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decode } from "fast-png";

const TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const Z = 10;
const TILE = 256;
const WORLD = TILE * 2 ** Z; // world width in pixels at zoom Z
const KALTIM = { lngMin: 113.836, lngMax: 118.989, latMin: -2.405, latMax: 2.626 };
const CACHE_DIR = "data/cache/terrain";
const POTENTIAL_FILE = "data/seed/re-potential.json";
const REGIONS_FILE = "data/seed/regions.geojson";
const OUT_FILE = "data/seed/re-terrain.json";
const CONCURRENCY = 6;
const STEP = 2; // sample every 2nd pixel in x and y (about 300 m spacing) to keep the run fast
const REFRESH = process.argv.includes("--refresh");

export type Ring = number[][];
export type Geometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };

/** Terrarium PNG pixel to metres above sea level. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Ground size of one pixel (metres) at a latitude in degrees, Web Mercator, 256 px tiles. */
export function metersPerPixel(latDeg: number, z: number = Z): number {
  return (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** z;
}

/**
 * Slope in degrees from a 3x3 neighbourhood given row by row (north row first), using Horn's method.
 * dx and dy are the ground distances between neighbouring samples in metres.
 */
export function slopeDegrees(n: ArrayLike<number>, dx: number, dy: number): number {
  const [a, b, c, d, , f, g, h, i] = [n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!, n[6]!, n[7]!, n[8]!];
  const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * dx);
  const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * dy);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > lat !== yj! > lat && lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!) {
      inside = !inside;
    }
  }
  return inside;
}

/** Even-odd point in polygon; the first ring is the outline, later rings are holes. */
export function pointInPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !inRing(lng, lat, outer)) return false;
  return !holes.some((h) => inRing(lng, lat, h));
}

function polygonsOf(g: Geometry): Ring[][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

// Web Mercator pixel (world coordinates) <-> lng/lat
const lngToPx = (lng: number) => ((lng + 180) / 360) * WORLD;
const latToPx = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
const pxToLng = (x: number) => (x / WORLD) * 360 - 180;
const pxToLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / WORLD))) * 180) / Math.PI;

async function loadTile(x: number, y: number): Promise<Uint8Array> {
  const file = `${CACHE_DIR}/${Z}-${x}-${y}.png`;
  if (!REFRESH && existsSync(file)) return new Uint8Array(readFileSync(file));
  const url = TILE_URL.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y));
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (err) {
      if (attempt >= 1) throw new Error(`tile ${Z}/${x}/${y}: ${(err as Error).message}`);
    }
  }
}

async function main() {
  const potential = JSON.parse(readFileSync(POTENTIAL_FILE, "utf8")) as {
    points: { lng: number; lat: number }[];
  };
  const regions = JSON.parse(readFileSync(REGIONS_FILE, "utf8")) as {
    features: { geometry: Geometry }[];
  };
  const polygons = regions.features.flatMap((f) => polygonsOf(f.geometry));

  // Tile range covering the Kaltim bounding box, plus one pixel of margin for the slope kernel.
  const x0 = Math.floor((lngToPx(KALTIM.lngMin) - 2) / TILE);
  const x1 = Math.floor((lngToPx(KALTIM.lngMax) + 2) / TILE);
  const y0 = Math.floor((latToPx(KALTIM.latMax) - 2) / TILE);
  const y1 = Math.floor((latToPx(KALTIM.latMin) + 2) / TILE);
  const cols = x1 - x0 + 1;
  const rowsN = y1 - y0 + 1;
  const tiles: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });

  mkdirSync(CACHE_DIR, { recursive: true });
  const W = cols * TILE;
  const H = rowsN * TILE;
  const elev = new Float32Array(W * H);
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < tiles.length) {
      const t = tiles[next++]!;
      const png = decode(await loadTile(t.x, t.y));
      if (png.width !== TILE || png.height !== TILE || png.channels < 3 || png.depth !== 8) {
        throw new Error(`tile ${Z}/${t.x}/${t.y}: unexpected PNG layout`);
      }
      const data = png.data as Uint8Array;
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const s = (py * TILE + px) * png.channels;
          elev[((t.y - y0) * TILE + py) * W + (t.x - x0) * TILE + px] = decodeTerrarium(
            data[s]!,
            data[s + 1]!,
            data[s + 2]!,
          );
        }
      }
      done++;
      if (done % 20 === 0 || done === tiles.length) process.stdout.write(`tiles ${done}/${tiles.length}\r`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`tiles ${done}/${tiles.length} (x ${x0}..${x1}, y ${y0}..${y1})`);

  // Cell lookup: cell = point +-0.5 degrees, lower edge inclusive.
  const cells = new Map<string, { lng: number; lat: number; n: number; sumE: number; maxE: number; sumS: number; f5: number; f10: number }>();
  for (const p of potential.points) {
    const key = `${Math.floor(p.lng - 0.5 + 1e-9)}_${Math.floor(p.lat - 0.5 + 1e-9)}`;
    cells.set(key, { lng: p.lng, lat: p.lat, n: 0, sumE: 0, maxE: -Infinity, sumS: 0, f5: 0, f10: 0 });
  }

  // Sampled pixel rows: build a land mask per row by even-odd scanline fill per polygon.
  const px0 = x0 * TILE;
  const py0 = y0 * TILE;
  const mask = new Uint8Array(W);
  const nb = new Float64Array(9);
  for (let ry = 1; ry < H - 1; ry += STEP) {
    const lat = pxToLat(py0 + ry + 0.5);
    if (lat > KALTIM.latMax || lat < KALTIM.latMin) continue;
    mask.fill(0);
    for (const rings of polygons) {
      const xs: number[] = [];
      for (let k = 0; k < rings.length; k++) {
        const ring = rings[k]!;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i]!;
          const [xj, yj] = ring[j]!;
          if (yi! > lat !== yj! > lat) xs.push(((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!);
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(1, Math.ceil(lngToPx(xs[i]!) - 0.5 - px0));
        const to = Math.min(W - 2, Math.floor(lngToPx(xs[i + 1]!) - 0.5 - px0));
        for (let x = from; x <= to; x++) mask[x] = 1;
      }
    }
    const dy = metersPerPixel(lat);
    const dx = dy; // Web Mercator pixels are square in projected space; both scale by cos(lat)
    for (let rx = 1; rx < W - 1; rx += STEP) {
      if (!mask[rx]) continue;
      const lng = pxToLng(px0 + rx + 0.5);
      const cell = cells.get(`${Math.floor(lng)}_${Math.floor(lat)}`);
      if (!cell) continue;
      for (let dyi = -1; dyi <= 1; dyi++) {
        for (let dxi = -1; dxi <= 1; dxi++) {
          nb[(dyi + 1) * 3 + dxi + 1] = elev[(ry + dyi) * W + rx + dxi]!;
        }
      }
      const e = nb[4]!;
      const slope = slopeDegrees(nb, dx, dy);
      cell.n++;
      cell.sumE += e;
      if (e > cell.maxE) cell.maxE = e;
      cell.sumS += slope;
      if (slope <= 5) cell.f5++;
      if (slope <= 10) cell.f10++;
    }
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const out = [...cells.values()]
    .filter((c) => c.n > 0)
    .map((c) => ({
      lng: c.lng,
      lat: c.lat,
      elevMean: Math.round(c.sumE / c.n),
      elevMax: Math.round(c.maxE),
      slopeMean: r1(c.sumS / c.n),
      flat5Pct: r1((100 * c.f5) / c.n),
      flat10Pct: r1((100 * c.f10) / c.n),
      landPixels: c.n,
    }))
    .sort((a, b) => a.lat - b.lat || a.lng - b.lng);

  const downloaded = new Date().toISOString().slice(0, 10);
  const source =
    `AWS Open Data Terrain Tiles (Mapzen terrarium PNG, ${TILE_URL}) at zoom ${Z} (256 px tiles, about 150 m per pixel at the equator), ` +
    `elevation = R*256 + G + B/256 - 32768 m; slope by Horn's 3x3 method in degrees using the Web Mercator ground pixel size ` +
    `(156543.03392*cos(lat)/2^${Z} m); every ${STEP}nd pixel in each direction is sampled, and only pixel centres inside the ` +
    `Kaltim region polygons count; terrain over Borneo derives from SRTM (USGS/NASA, public domain), ` +
    `"SRTM data courtesy of the U.S. Geological Survey", tiles by Mapzen (attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md); ` +
    `downloaded ${downloaded}.`;

  writeFileSync(OUT_FILE, JSON.stringify({ source, cells: out }, null, 2) + "\n");
  console.log(`wrote ${OUT_FILE}`);
  console.log(`tiles used: ${tiles.length}, cells written: ${out.length} (of ${potential.points.length})`);
  for (const c of out) {
    console.log(`${c.lng}\t${c.lat}\televMean ${c.elevMean}\tslopeMean ${c.slopeMean}\tflat5 ${c.flat5Pct}`);
  }
}

if (import.meta.main) await main();
