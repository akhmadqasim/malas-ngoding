import type { ExpressionSpecification } from "mapbox-gl";
import type { Metric } from "../store.ts";
import type { RegionSummary } from "../../shared/types.ts";

/*
 * The geometry of the region columns, shared by the columns themselves (regionsLayer.ts) and the labels
 * that sit on top of them (regionLabels.ts), so the two can never drift apart.
 */

/** Tallest and shortest column at the province view, in metres. Scaled down again as the user zooms in. */
const MAX_HEIGHT_M = 75_000;
const MIN_HEIGHT_M = 4_000;
/** Above this zoom the city and its buildings matter more than the columns, so they flatten out and hide. */
export const HIDE_ZOOM = 12;

export const metricValue = (r: RegionSummary, metric: Metric) => (metric === "co2" ? r.co2KgYear : r.kwhYear);

/** 0..1 per region. Square root so small regions (Mahakam Ulu) still read, and Samarinda does not dwarf all. */
export function intensities(regions: RegionSummary[], metric: Metric): Map<string, number> {
  const max = Math.max(...regions.map((r) => metricValue(r, metric)), 1);
  return new Map(regions.map((r) => [r.id, Math.sqrt(Math.max(metricValue(r, metric), 0) / max)]));
}

/** Resting height of a column at the province view, in metres, for an intensity `t` (0..1). */
export const columnHeight = (t: number) => MIN_HEIGHT_M + (MAX_HEIGHT_M - MIN_HEIGHT_M) * t;

/** Zoom stops of the flattening and the share of the height left at each. */
const FLATTEN: [number, number][] = [
  [6.6, 1],
  [8, 0.3],
  [9.5, 0.08],
  [HIDE_ZOOM, 0],
];

/** Flattens a height with zoom: full at the province view, gone at city zoom, so buildings take over. */
export function columnZoomScale(height: ExpressionSpecification): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 6.6, height, 8, ["*", height, 0.3], 9.5, ["*", height, 0.08], HIDE_ZOOM, 0];
}

/**
 * The flattening of a selected column: like the others, but flat from zoom 10.4, where a city fills the
 * view. Up close it is a tinted footprint with a crisp outline, not a block of walls over the city.
 */
export const FLATTEN_SELECTED: [number, number][] = [
  [6.6, 1],
  [8, 0.3],
  [9.5, 0.08],
  [10.4, 0],
];

/** Flattens a height with the selected column's curve (FLATTEN_SELECTED). */
export function selectedZoomScale(height: ExpressionSpecification): ExpressionSpecification {
  const stops = FLATTEN_SELECTED.flatMap(([z, k]) => [z, k === 1 ? height : k === 0 ? 0 : ["*", height, k]]);
  return ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
}

/** Metres per screen pixel at a zoom (512 px tiles, at the equator: Kaltim lies on it). */
export const metresPerPixel = (zoom: number) => 78_271.5 / 2 ** zoom;

/**
 * A flattened height shifted by `px` screen pixels (up, or down when negative), the shift worked out at
 * every stop of the flattening so it stays about `px` on screen at every zoom.
 */
export function columnZoomScaleShift(height: ExpressionSpecification, px: number, flatten = FLATTEN): ExpressionSpecification {
  const stops = flatten.flatMap(([z, k]) => [z, ["+", k === 1 ? height : ["*", height, k], px * metresPerPixel(z)]]);
  return ["interpolate", ["linear"], ["zoom"], ...stops] as ExpressionSpecification;
}
