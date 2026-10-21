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

/** Flattens a height with zoom: full at the province view, gone at city zoom, so buildings take over. */
export function columnZoomScale(height: ExpressionSpecification): ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 6.6, height, 8, ["*", height, 0.3], 9.5, ["*", height, 0.08], HIDE_ZOOM, 0];
}
