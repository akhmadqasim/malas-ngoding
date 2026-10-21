import type { ExpressionSpecification, FilterSpecification, GeoJSONSourceSpecification, Map as MapboxMap } from "mapbox-gl";
import type { RegionCollection } from "../api.ts";
import type { Metric } from "../store.ts";
import { token } from "../theme.ts";
import { columnHeight, columnZoomScale, HIDE_ZOOM, intensities, metricValue } from "./columns.ts";

/*
 * The names of the ten regions, set on top of their columns. At the province view they replace the
 * basemap's place names, which Standard draws half-hidden behind the columns (ghosted and smeared).
 */

export const REGION_LABEL_LAYER = "region-labels";
const SOURCE = "region-labels";

/**
 * Below this zoom (the globe, and the first half of the intro flight) the basemap names the geography:
 * Malaysia, Brunei, Jakarta, Makassar, Laut Sulu. From here the region columns and their names are the map
 * (the intro crosses it at about 2.4 s, before the columns rise at 4.3 s).
 */
export const GLOBE_LABEL_ZOOM = 5.5;
/**
 * Basemap place names come back from this zoom, and the region labels hand over at the same zoom: the
 * columns are gone by then. Behind a column, even a short fading one, Standard draws them ghosted.
 */
export const PLACE_LABEL_ZOOM = HIDE_ZOOM;
/** Road names and shields only help from city zoom on. */
export const ROAD_LABEL_ZOOM = 11;
/**
 * Once the overview has landed, the handover moves out to here: a small zoom-out from the province view
 * (to about zoom 5) keeps the columns and our names, and the basemap names (Malaysia, Nusantara, Bontang)
 * only come back once the whole island is small, well past the columns.
 */
export const LANDED_LABEL_ZOOM = 4.5;

/** "intro": the globe and the flight in. "landed": the overview has landed, the columns stand. */
export type LabelPhase = "intro" | "landed";

/** Basemap label switches for a zoom (Standard config `showPlaceLabels` and `showRoadLabels`). */
export function basemapLabelConfig(zoom: number, phase: LabelPhase = "intro"): { showPlaceLabels: boolean; showRoadLabels: boolean } {
  const handover = phase === "landed" ? LANDED_LABEL_ZOOM : GLOBE_LABEL_ZOOM;
  return {
    showPlaceLabels: zoom < handover || zoom >= PLACE_LABEL_ZOOM,
    showRoadLabels: zoom >= ROAD_LABEL_ZOOM,
  };
}

type Anchor = "center" | "left" | "right" | "top" | "bottom";

/**
 * Hand-placed labels for the crowded coast. All ten hold, without touching each other, over the whole
 * idle sway at 1280 to 1920 px wide (`bun run smoke` sweeps it). Mapbox cannot move them on its own:
 * `text-variable-anchor` switches off the lift onto the columns in GL JS 3.33 (its render path drops
 * `symbol-z-offset`), so each label has one fixed anchor. Every `at` point lies inside its region
 * (tests/web/labelPlacement.test.ts).
 */
export const LABEL_PLACEMENT: Partial<Record<string, { at?: [number, number]; anchor?: Anchor; offset?: [number, number] }>> = {
  // Its widest part lies in the cluster by the coast; the inland part has room.
  "kutai-kartanegara": { at: [116.3, 0.25] },
  "kutai-timur": { at: [117.6, 1.1] },
  // Left of its column top, away from the big Sangatta plant marker behind it.
  samarinda: { anchor: "right", offset: [-0.6, 0] },
  // Over the sea, beside the AlamTri plant marker just south.
  bontang: { anchor: "left", offset: [1, 0] },
  "penajam-paser-utara": { at: [116.45, -1.4] },
};

/**
 * From this zoom on a region fills much of the view (a selected region, or the user zooming in), so every
 * label sits centred on its point; the hand placement above is for the crowded province view only.
 */
export const CLOSE_LABEL_ZOOM = 7.5;

/** `text-anchor` per region: hand-placed at the province view, centred closer in. */
export function labelAnchor(): ExpressionSpecification {
  const placed = Object.entries(LABEL_PLACEMENT).filter(([, p]) => p?.anchor);
  const province = ["match", ["get", "id"], ...placed.flatMap(([id, p]) => [id, p!.anchor!]), "center"];
  return ["step", ["zoom"], province, CLOSE_LABEL_ZOOM, "center"] as ExpressionSpecification;
}

/** `text-offset` (in ems) per region, to go with `labelAnchor`. */
export function labelOffset(): ExpressionSpecification {
  const placed = Object.entries(LABEL_PLACEMENT).filter(([, p]) => p?.offset);
  const province = ["match", ["get", "id"], ...placed.flatMap(([id, p]) => [id, ["literal", p!.offset!]]), ["literal", [0, 0]]];
  return ["step", ["zoom"], province, CLOSE_LABEL_ZOOM, ["literal", [0, 0]]] as ExpressionSpecification;
}

export interface LabelProperties {
  id: string;
  name: string;
  /** Resting height of the region's column at the province view, in metres. */
  lift: number;
  /**
   * Placement order by the metric shown, largest first (0). Should two names ever collide, the smaller
   * region's name yields, with Mapbox's fade; Samarinda, Kutai Kartanegara, Balikpapan and Kutai Timur never do.
   */
  rank: number;
}
interface LabelCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; id: string; geometry: { type: "Point"; coordinates: [number, number] }; properties: LabelProperties }[];
}

/** One label point per region with a label point in the data. */
export function labelFeatures(fc: RegionCollection, metric: Metric): LabelCollection {
  const regions = fc.features.map((f) => f.properties);
  const t = intensities(regions, metric);
  const ranked = [...regions].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
  const rank = new Map(ranked.map((r, i) => [r.id, i]));
  return {
    type: "FeatureCollection",
    features: fc.features.flatMap((f) => {
      const point = f.properties.labelPoint && (LABEL_PLACEMENT[f.properties.id]?.at ?? f.properties.labelPoint);
      if (!point) return [];
      const { id, name } = f.properties;
      return [
        {
          type: "Feature" as const,
          id,
          geometry: { type: "Point" as const, coordinates: point },
          properties: { id, name, lift: columnHeight(t.get(id) ?? 0), rank: rank.get(id) ?? 0 },
        },
      ];
    }),
  };
}

/** How high a label floats: its column's resting height, flattened with zoom exactly like the column. */
export function labelLift(): ExpressionSpecification {
  // `coalesce`: Mapbox also evaluates this without a feature during placement, where `get` is null.
  return columnZoomScale(["coalesce", ["get", "lift"], 0]);
}

/**
 * Full or nothing by zoom, never in between: the camera of a selected region rests anywhere from zoom 7.5
 * to 10.5, and a fade band there left a ghosted name. Shown only while the columns are the map: below
 * LANDED_LABEL_ZOOM the basemap names the geography, from PLACE_LABEL_ZOOM the place names are back. The
 * labels are only revealed once the columns stand, after the intro, so the landed handover is the one
 * that applies.
 */
export function labelOpacity(): ExpressionSpecification {
  return ["step", ["zoom"], 0, LANDED_LABEL_ZOOM, 1, PLACE_LABEL_ZOOM, 0];
}

/** Adds the labels, hidden. `setRegionLabelsShown` reveals them once the columns stand still. */
export function addRegionLabels(map: MapboxMap, fc: RegionCollection, metric: Metric): void {
  removeRegionLabels(map);
  map.addSource(SOURCE, { type: "geojson", data: labelFeatures(fc, metric) as unknown as GeoJSONSourceSpecification["data"] });
  map.addLayer({
    id: REGION_LABEL_LAYER,
    type: "symbol",
    source: SOURCE,
    slot: "top",
    layout: {
      "text-field": ["get", "name"],
      // The basemap's own label face, served by Mapbox (the Plex faces of the panels are not).
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
      "text-size": 13,
      "text-letter-spacing": 0.01,
      "text-max-width": 9,
      "text-anchor": labelAnchor(),
      "text-offset": labelOffset(),
      "text-justify": "auto",
      "symbol-sort-key": ["get", "rank"],
      // Lifted to the top of the column (symbol-z-offset below), so the name sits on its own column.
      "symbol-z-elevate": true,
    },
    paint: {
      "symbol-z-offset": labelLift(),
      "text-color": token("--color-paper"),
      "text-halo-color": token("--color-ink"),
      "text-halo-width": 1.5,
      "text-halo-blur": 0.2,
      "text-emissive-strength": 1,
      // Never ghosted behind a column in front: that is what made the basemap names look smeared.
      "text-occlusion-opacity": 1,
      "text-opacity": 0,
      "text-opacity-transition": { duration: 240, delay: 0 },
    },
  });
}

/** Moves the labels to the column heights of another metric. */
export function setRegionLabelData(map: MapboxMap, fc: RegionCollection, metric: Metric): void {
  const source = map.getSource(SOURCE) as { setData?: (data: unknown) => void } | undefined;
  source?.setData?.(labelFeatures(fc, metric));
}

/** Fades the labels in (they still hand over to the place names by zoom) or out. */
export function setRegionLabelsShown(map: MapboxMap, shown: boolean): void {
  if (map.getLayer(REGION_LABEL_LAYER)) map.setPaintProperty(REGION_LABEL_LAYER, "text-opacity", shown ? labelOpacity() : 0);
}

/** Shows only the label of the selected region, or all labels with `null`. */
export function setRegionLabelFocus(map: MapboxMap, id: string | null): void {
  if (!map.getLayer(REGION_LABEL_LAYER)) return;
  const filter: FilterSpecification | null = id ? ["==", ["get", "id"], id] : null;
  map.setFilter(REGION_LABEL_LAYER, filter);
}

export function setRegionLabelsVisible(map: MapboxMap, visible: boolean): void {
  if (map.getLayer(REGION_LABEL_LAYER)) map.setLayoutProperty(REGION_LABEL_LAYER, "visibility", visible ? "visible" : "none");
}

export function removeRegionLabels(map: MapboxMap): void {
  if (map.getLayer(REGION_LABEL_LAYER)) map.removeLayer(REGION_LABEL_LAYER);
  if (map.getSource(SOURCE)) map.removeSource(SOURCE);
}
