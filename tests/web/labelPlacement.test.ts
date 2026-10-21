import { describe, expect, test } from "bun:test";
import { LABEL_PLACEMENT } from "../../src/web/map/regionLabels.ts";

/*
 * The hand-placed label points (regionLabels.ts) must lie inside their own region, or a name would
 * float over a neighbour's column. Checked against the committed boundaries in data/seed.
 */

type Ring = [number, number][];
type Polygon = Ring[];
interface RegionShape {
  properties: { id: string };
  geometry: { type: "Polygon"; coordinates: Polygon } | { type: "MultiPolygon"; coordinates: Polygon[] };
}

const fc = (await Bun.file("data/seed/regions.geojson").json()) as { features: RegionShape[] };
const polygons = (f: RegionShape): Polygon[] => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);

/** Even-odd rule over every ring, so holes count as outside. */
function inside([x, y]: [number, number], polygon: Polygon): boolean {
  let hit = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** Distance from a point to the nearest edge of a region, in km (equirectangular, fine near the equator). */
function distanceToEdgeKm([x, y]: [number, number], f: RegionShape): number {
  const km = 111.32;
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of polygons(f)) {
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[j]!;
        const [bx, by] = ring[i]!;
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
        best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) * km);
      }
    }
  }
  return best;
}

const placed = Object.entries(LABEL_PLACEMENT).flatMap(([id, p]) => (p?.at ? [{ id, at: p.at }] : []));

describe("hand-placed region labels", () => {
  test("there are hand-placed points to check", () => {
    expect(placed.length).toBeGreaterThan(0);
  });

  for (const { id, at } of placed) {
    test(`${id}: its label point lies inside ${id} and in no other region`, () => {
      const owners = fc.features.filter((f) => polygons(f).some((p) => inside(at, p))).map((f) => f.properties.id);
      expect(owners).toEqual([id]);
    });

    test(`${id}: its label point keeps clear of the border`, () => {
      const region = fc.features.find((f) => f.properties.id === id)!;
      expect(distanceToEdgeKm(at, region)).toBeGreaterThan(5);
    });
  }
});
