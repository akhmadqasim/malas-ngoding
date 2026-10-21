import type { RegionCollection } from "../api.ts";

/*
 * A calmer copy of the region shapes for the columns. The Mahakam delta and the Balikpapan bay draw dozens
 * of tiny islands and inlets; extruded, each becomes a sliver of wall, a comb at the busiest spot of the
 * map. The copy drops islands that are tiny next to the region's main land and simplifies every ring a
 * little (Douglas-Peucker). Borders stay within about half a kilometre, less than a pixel at the province
 * view.
 */

type Ring = number[][];

/** Simplification tolerance in degrees (about 450 m at the equator). */
export const SIMPLIFY_DEG = 0.004;
/** A part smaller than this share of the region's largest part is dropped. */
export const MIN_PART_SHARE = 0.02;

/** Ring area in square degrees (shoelace). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i]![0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * ring[i]![1]!;
  return Math.abs(a) / 2;
}

function pointToSegment(p: number[], a: number[], b: number[]): number {
  const [x, y] = [p[0]!, p[1]!];
  const [x1, y1, x2, y2] = [a[0]!, a[1]!, b[0]!, b[1]!];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Douglas-Peucker on a closed ring; keeps at least four points so the ring stays a polygon. */
export function simplifyRing(ring: Ring, tolerance = SIMPLIFY_DEG): Ring {
  if (ring.length <= 5) return ring;
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointToSegment(ring[i]!, ring[s]!, ring[e]!);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > tolerance) {
      keep[at] = true;
      stack.push([s, at], [at, e]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

/** The calmer copy of every region shape (properties and ids unchanged). */
export function calmShapes(fc: RegionCollection): RegionCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const largest = Math.max(...polys.map((p) => ringArea(p[0] ?? [])));
      const kept = polys
        .filter((p) => ringArea(p[0] ?? []) >= largest * MIN_PART_SHARE)
        .map((p) => p.map((ring) => simplifyRing(ring)).filter((ring, i) => i === 0 || ringArea(ring) >= largest * MIN_PART_SHARE));
      const geometry = kept.length === 1 ? { type: "Polygon" as const, coordinates: kept[0]! } : { type: "MultiPolygon" as const, coordinates: kept };
      return { ...f, geometry } as typeof f;
    }),
  };
}

/** Whether a point lies inside a polygon's rings (even-odd, so holes count). */
function insideRings(lng: number, lat: number, rings: Ring[]): boolean {
  let hit = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = [ring[i]![0]!, ring[i]![1]!];
      const [xj, yj] = [ring[j]![0]!, ring[j]![1]!];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  return hit;
}

/** The id of the region whose shape holds the point, or null (at sea, or outside the province). */
export function regionAt(fc: RegionCollection, lng: number, lat: number): string | null {
  for (const f of fc.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (polys.some((p) => insideRings(lng, lat, p))) return f.properties.id;
  }
  return null;
}
