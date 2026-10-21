import type { ExpressionSpecification } from "mapbox-gl";

/*
 * Plants that would overlap on screen are drawn as one group marker with their count. Unlike Mapbox's own
 * clustering, which regroups at whole zoom levels (the count pops into dots), the groups here are worked out
 * once, as a tree, with the exact zoom where each group parts. Every marker carries the zoom it appears at
 * and the zoom it parts at, and its opacity cross-fades over a short zoom band around both: zooming in, a
 * group fades out while its parts fade in at their own places; zooming out, the reverse. Nothing moves,
 * nothing jumps, and at a fixed zoom (the idle sway) nothing changes at all.
 */

/** Markers whose centres are closer than this on screen (px) are one group. */
export const GROUP_RADIUS_PX = 18;
/** Width of the cross-fade, in zoom levels, centred on the zoom where a group parts. */
export const FADE_ZOOMS = 0.6;
/** A group that would show for less than this many zoom levels is skipped: its parts show straight away. */
const MIN_LIFE_ZOOMS = FADE_ZOOMS;
/** Zoom range the opacity expressions cover, in quarter-zoom stops; beyond it the ends hold. */
const OPACITY_ZOOMS = [3, 15] as const;
const NEVER = 99;

export interface GroupInput<P> {
  lng: number;
  lat: number;
  capacityMw: number;
  props: P;
}

export interface GroupNode<P> {
  /** Stable id, also the feature id. */
  id: number;
  kind: "plant" | "group";
  lng: number;
  lat: number;
  /** Summed capacity (one plant: its own). */
  capacityMw: number;
  /** Zoom from which this marker shows (fully from `appear + FADE_ZOOMS / 2`). */
  appear: number;
  /** Zoom at which it parts into smaller markers (never, for one plant). */
  split: number;
  /** The plants inside, for the tooltip. */
  members: P[];
}

/** Web Mercator position in world units at zoom 0 (0..1). */
function mercator(lng: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** The zoom below which two points closer than `radiusPx` overlap (512 px tiles). */
export const partZoom = (worldDistance: number, radiusPx = GROUP_RADIUS_PX) =>
  worldDistance > 0 ? Math.log2(radiusPx / (512 * worldDistance)) : NEVER;

/**
 * The marker tree for a set of plants: single-linkage grouping in screen space, every group with the zoom
 * at which it parts. Returns every marker that ever shows, plants and groups.
 */
export function plantGroups<P>(plants: GroupInput<P>[], radiusPx = GROUP_RADIUS_PX): GroupNode<P>[] {
  type Tree = { id: number; lng: number; lat: number; capacityMw: number; split: number; members: P[]; kids: Tree[]; xy: [number, number] };
  let next = 0;
  const leaves: Tree[] = plants.map((p) => ({
    id: next++,
    lng: p.lng,
    lat: p.lat,
    capacityMw: p.capacityMw,
    split: NEVER,
    members: [p.props],
    kids: [],
    xy: mercator(p.lng, p.lat),
  }));
  // Every pair, closest first; joining them in that order builds the single-linkage tree.
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const [a, b] = [leaves[i]!.xy, leaves[j]!.xy];
      pairs.push([Math.hypot(a[0] - b[0], a[1] - b[1]), i, j]);
    }
  pairs.sort((x, y) => x[0] - y[0]);
  const root = leaves.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
  const top = new Map<number, Tree>(leaves.map((l, i) => [i, l]));
  for (const [d, i, j] of pairs) {
    const [ri, rj] = [find(i), find(j)];
    if (ri === rj) continue;
    const [a, b] = [top.get(ri)!, top.get(rj)!];
    const n = a.members.length + b.members.length;
    const lng = (a.lng * a.members.length + b.lng * b.members.length) / n;
    const lat = (a.lat * a.members.length + b.lat * b.members.length) / n;
    const group: Tree = {
      id: next++,
      lng,
      lat,
      capacityMw: a.capacityMw + b.capacityMw,
      split: partZoom(d, radiusPx),
      members: [...a.members, ...b.members],
      kids: [a, b],
      xy: mercator(lng, lat),
    };
    root[rj] = ri;
    top.set(ri, group);
    top.delete(rj);
  }

  const out: GroupNode<P>[] = [];
  const walk = (t: Tree, appear: number) => {
    // A group that would only flicker past (it parts again almost as soon as it forms) is skipped.
    if (t.kids.length && t.split - appear < MIN_LIFE_ZOOMS) {
      for (const k of t.kids) walk(k, appear);
      return;
    }
    out.push({ id: t.id, kind: t.kids.length ? "group" : "plant", lng: t.lng, lat: t.lat, capacityMw: t.capacityMw, appear, split: t.split, members: t.members });
    for (const k of t.kids) walk(k, t.split);
  };
  for (const t of top.values()) walk(t, -NEVER);
  return out.sort((a, b) => a.id - b.id);
}

/** How visible a marker is at `zoom`, 0..1: the same ramps the map draws (`markerOpacity`). */
export function visibility(node: { appear: number; split: number }, zoom: number): number {
  const ramp = (v: number) => Math.min(1, Math.max(0, v));
  return ramp(0.5 + (zoom - node.appear) / FADE_ZOOMS) * ramp(0.5 + (node.split - zoom) / FADE_ZOOMS);
}

/**
 * Opacity of a marker by zoom: fades in around `appear`, out around `split` (feature properties), times
 * `base` (planned plants are fainter). Mapbox allows `zoom` only as the input of a top-level interpolate,
 * so the ramps are written out at quarter-zoom stops; between stops Mapbox interpolates linearly.
 */
export function markerOpacity(base: ExpressionSpecification | number = 1): ExpressionSpecification {
  const ramp = (v: ExpressionSpecification): ExpressionSpecification => ["min", 1, ["max", 0, v]];
  const stops: (number | ExpressionSpecification)[] = [];
  for (let z = OPACITY_ZOOMS[0]; z <= OPACITY_ZOOMS[1]; z += 0.25) {
    stops.push(z, [
      "*",
      base,
      ramp(["+", 0.5, ["/", ["-", z, ["get", "appear"]], FADE_ZOOMS]]),
      ramp(["+", 0.5, ["/", ["-", ["get", "split"], z], FADE_ZOOMS]]),
    ]);
  }
  return ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
}
