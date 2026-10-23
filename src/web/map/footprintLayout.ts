/** Geometry in metres shared by facade details, mosque roofs and registered PV. */
export type Point2 = [number, number];
export type FootprintGeometry = { type: string; coordinates?: unknown };
const METRES = 111195;

export function projectedFootprint(geometry: FootprintGeometry) {
  if (geometry.type !== "Polygon") return null;
  const rings = geometry.coordinates as number[][][];
  if (!Array.isArray(rings) || !rings[0] || rings[0].length < 4) return null;
  if (!rings.every(r => r.every(p => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])))) return null;
  const outer = rings[0];
  const origin: Point2 = [(Math.min(...outer.map(p => p[0]!)) + Math.max(...outer.map(p => p[0]!))) / 2,
    (Math.min(...outer.map(p => p[1]!)) + Math.max(...outer.map(p => p[1]!))) / 2];
  const sx = METRES * Math.cos(origin[1] * Math.PI / 180);
  if (sx < 1) return null;
  const local = rings.map(r => r.map(p => [(p[0]! - origin[0]) * sx, (p[1]! - origin[1]) * METRES] as Point2));
  const toLngLat = ([x, y]: Point2): Point2 => [origin[0] + x / sx, origin[1] + y / METRES];
  const bounds = { minX: Math.min(...local[0]!.map(p => p[0])), maxX: Math.max(...local[0]!.map(p => p[0])),
    minY: Math.min(...local[0]!.map(p => p[1])), maxY: Math.max(...local[0]!.map(p => p[1])) };
  let area = 0, longest = 0, angle = 0;
  for (const [ri, ring] of local.entries()) {
    let signed = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!, b = ring[i + 1]!;
      signed += a[0] * b[1] - b[0] * a[1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ri === 0 && length > longest) { longest = length; angle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    }
    area += (ri === 0 ? 1 : -1) * Math.abs(signed) / 2;
  }
  return { origin, rings: local, bounds, area, angle, toLngLat };
}

export function pointInRings(rings: Point2[][], [x, y]: Point2): boolean {
  const inRing = (ring: Point2[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  return Boolean(rings[0] && inRing(rings[0]) && !rings.slice(1).some(inRing));
}

function distanceToEdge(p: Point2, a: Point2, b: Point2) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** A conservative disk completely inside the polygon and outside every courtyard. */
export function roofPlacement(geometry: FootprintGeometry, maxWidth = 24) {
  const projected = projectedFootprint(geometry);
  if (!projected || projected.area < 12) return null;
  const { rings, bounds } = projected;
  let best: { center: Point2; radius: number } | null = null;
  for (let x = 1; x < 10; x++) for (let y = 1; y < 10; y++) {
    const center: Point2 = [bounds.minX + (bounds.maxX - bounds.minX) * x / 10, bounds.minY + (bounds.maxY - bounds.minY) * y / 10];
    if (!pointInRings(rings, center)) continue;
    let radius = Infinity;
    for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) radius = Math.min(radius, distanceToEdge(center, ring[i]!, ring[i + 1]!));
    if (!best || radius > best.radius) best = { center, radius };
  }
  if (!best || best.radius < 1.2) return null;
  // A square inside this disk cannot cross concave edges or courtyard boundaries.
  const width = Math.min(maxWidth, Math.max(0, (best.radius - 0.5) * Math.SQRT2));
  if (width < 1) return null;
  return { at: projected.toLngLat(best.center), width, angle: -projected.angle * 180 / Math.PI, projected };
}
