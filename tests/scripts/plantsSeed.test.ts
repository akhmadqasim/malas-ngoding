import { describe, expect, test } from "bun:test";

type Ring = number[][];
type Geometry =
  | { type: "Polygon"; coordinates: Ring[] }
  | { type: "MultiPolygon"; coordinates: Ring[][] };
interface Region {
  id: string;
  name: string;
  geometry: Geometry;
}
interface Plant {
  name: string;
  lat: number;
  lng: number;
  source: string;
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  const [outer, ...holes] = rings;
  return !!outer && inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h));
}

function contains(region: Region, lng: number, lat: number): boolean {
  const g = region.geometry;
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygons.some((p) => inPolygon(lng, lat, p));
}

async function load(): Promise<{ regions: Region[]; plants: Plant[] }> {
  const geo = (await Bun.file("data/seed/regions.geojson").json()) as {
    features: { properties: { id: string; name: string }; geometry: Geometry }[];
  };
  const regions = geo.features.map((f) => ({ ...f.properties, geometry: f.geometry }));
  const plants = (await Bun.file("data/seed/plants.json").json()) as Plant[];
  return { regions, plants };
}

const shortName = (r: Region) => r.name.replace(/^(Kota|Kabupaten) /, "");

describe("plants seed", () => {
  test("a plant whose source names a region lies inside that region", async () => {
    const { regions, plants } = await load();
    const named: string[] = [];
    for (const p of plants) {
      const clause = p.source.split("Coordinates:")[1] ?? "";
      // Longest name first, so "Penajam Paser Utara" wins over "Paser".
      const hit = [...regions]
        .sort((a, b) => shortName(b).length - shortName(a).length)
        .find((r) => clause.includes(shortName(r)));
      if (!hit) continue;
      named.push(p.name);
      expect(contains(hit, p.lng, p.lat), `${p.name} should lie in ${hit.name}`).toBe(true);
    }
    expect(named.length).toBeGreaterThan(5);
  });

  test("PLTU Kaltim 4 is in Kutai Kartanegara, not Samarinda", async () => {
    const { regions, plants } = await load();
    const plant = plants.find((p) => p.name.startsWith("PLTU Kaltim 4"));
    expect(plant).toBeDefined();
    const kukar = regions.find((r) => r.id === "kutai-kartanegara");
    const samarinda = regions.find((r) => r.id === "samarinda");
    expect(contains(kukar as Region, plant!.lng, plant!.lat)).toBe(true);
    expect(contains(samarinda as Region, plant!.lng, plant!.lat)).toBe(false);
  });
});
