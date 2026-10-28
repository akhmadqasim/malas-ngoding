// Builds data/seed/re-potential.json: annual solar and wind climatology on the NASA POWER grid
// over Kalimantan Timur (community RE, ANN values). Run: bun scripts/build-re-potential.ts [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://power.larc.nasa.gov/api/temporal/climatology/regional";
const BOX = { lngMin: 113.5, lngMax: 119.5, latMin: -3, latMax: 3 };
const PARAMS = { ghi: "ALLSKY_SFC_SW_DWN", ws50: "WS50M", ws10: "WS10M" } as const;
const CACHE_DIR = "data/cache";
const OUT_FILE = "data/seed/re-potential.json";
const REFRESH = process.argv.includes("--refresh");

type Key = keyof typeof PARAMS;

type PowerResponse = {
  features?: {
    geometry: { coordinates: number[] };
    properties: { parameter: Record<string, Record<string, number | null>> };
  }[];
  header?: { start: string; end: string; fill_value: number; sources: string[] };
  messages?: string[];
};

type Cached = { fetched: string; url: string; response: PowerResponse };

type Point = { lng: number; lat: number; value: number | null };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function requestUrl(param: string): string {
  const query = new URLSearchParams({
    parameters: param,
    community: "RE",
    "longitude-min": String(BOX.lngMin),
    "longitude-max": String(BOX.lngMax),
    "latitude-min": String(BOX.latMin),
    "latitude-max": String(BOX.latMax),
    format: "JSON",
  });
  return `${API}?${query}`;
}

async function loadParam(param: string): Promise<Cached> {
  const file = `${CACHE_DIR}/power-${param}.json`;
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Cached;

  const url = requestUrl(param);
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`${param}: HTTP ${res.status} ${body.slice(0, 300)}`);
  const response = JSON.parse(body) as PowerResponse;
  if (!response.features) {
    throw new Error(`${param}: no features, messages: ${response.messages?.join("; ")}`);
  }

  const cached: Cached = { fetched: today(), url, response };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(cached));
  return cached;
}

function pointsOf(cached: Cached, param: string): Point[] {
  const fill = cached.response.header?.fill_value ?? -999;
  return (cached.response.features ?? []).map((f) => {
    const raw = f.properties.parameter[param]?.ANN;
    const valid = typeof raw === "number" && Number.isFinite(raw) && raw > fill;
    return {
      lng: f.geometry.coordinates[0] ?? Number.NaN,
      lat: f.geometry.coordinates[1] ?? Number.NaN,
      value: valid ? raw : null,
    };
  });
}

function nearest(points: Point[], lng: number, lat: number): Point {
  if (!points[0]) throw new Error("no wind grid points");
  let best = points[0];
  let bestD = Infinity;
  for (const p of points) {
    const d = (p.lng - lng) ** 2 + (p.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function stats(xs: number[]): string {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return `min ${min.toFixed(2)}  mean ${mean.toFixed(2)}  max ${max.toFixed(2)}`;
}

const cached = {} as Record<Key, Cached>;
for (const key of Object.keys(PARAMS) as Key[]) {
  cached[key] = await loadParam(PARAMS[key]);
}

const header = cached.ghi.response.header;
for (const key of Object.keys(PARAMS) as Key[]) {
  const h = cached[key].response.header;
  if (h?.start !== header?.start || h?.end !== header?.end) {
    throw new Error(`${PARAMS[key]}: period differs from ${PARAMS.ghi}`);
  }
}

const solar = pointsOf(cached.ghi, PARAMS.ghi);
const wind50 = pointsOf(cached.ws50, PARAMS.ws50);
const wind10 = pointsOf(cached.ws10, PARAMS.ws10);

const rows = solar
  .filter((p) => p.value !== null)
  .map((p) => {
    const w50 = nearest(wind50, p.lng, p.lat);
    const w10 = nearest(wind10, p.lng, p.lat);
    return { p, w50, w10 };
  })
  .filter((r) => r.w50.value !== null && r.w10.value !== null);

const points = rows
  .map((r) => ({
    lng: Math.round(r.p.lng * 1e4) / 1e4,
    lat: Math.round(r.p.lat * 1e4) / 1e4,
    ghi: Math.round(r.p.value! * 100) / 100,
    ws50: Math.round(r.w50.value! * 100) / 100,
    ws10: Math.round(r.w10.value! * 100) / 100,
  }))
  .sort((a, b) => a.lat - b.lat || a.lng - b.lng);

const period = `${header!.start.slice(0, 4)}-${header!.end.slice(0, 4)}`;
const downloaded = Object.values(cached).map((c) => c.fetched).sort().at(-1);
const sourceList = (Object.keys(PARAMS) as Key[])
  .map((k) => `${PARAMS[k]} from ${cached[k].response.header!.sources.join("/")}`)
  .join(", ");
const source =
  `NASA POWER climatology API (regional), parameters ${Object.values(PARAMS).join(", ")}, ` +
  `community RE, annual (ANN) values for ${period} (${sourceList}), ` +
  `requested as ${API}?parameters={PARAMETER}&community=RE` +
  `&longitude-min=${BOX.lngMin}&longitude-max=${BOX.lngMax}&latitude-min=${BOX.latMin}` +
  `&latitude-max=${BOX.latMax}&format=JSON with one request per parameter, downloaded ${downloaded}; ` +
  `wind is sampled at the nearest wind grid point of each solar grid point.`;

const out = {
  source,
  units: { ghi: "kWh/m2/day", ws50: "m/s", ws10: "m/s" },
  points,
};

mkdirSync("data/seed", { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");

console.log(`wrote ${OUT_FILE}`);
console.log(`points: ${points.length} (dropped ${solar.length - points.length} of ${solar.length})`);
console.log(`ghi  (kWh/m2/day): ${stats(points.map((p) => p.ghi))}`);
console.log(`ws50 (m/s):        ${stats(points.map((p) => p.ws50))}`);
console.log(`ws10 (m/s):        ${stats(points.map((p) => p.ws10))}`);
