import { describe, expect, test } from "bun:test";
import type { RegionCollection } from "../../src/web/api.ts";
import {
  basemapLabelConfig,
  CLOSE_LABEL_ZOOM,
  GLOBE_LABEL_ZOOM,
  LABEL_PLACEMENT,
  labelAnchor,
  labelFeatures,
  labelLift,
  labelOffset,
  labelOpacity,
  PLACE_LABEL_ZOOM,
} from "../../src/web/map/regionLabels.ts";
import { columnHeight, columnZoomScale } from "../../src/web/map/regionsLayer.ts";
import type { RegionSummary } from "../../src/shared/types.ts";

const region = (id: string, name: string, kind: "kota" | "kabupaten", kwhYear: number): RegionSummary => ({
  id,
  name,
  kind,
  kwhYear,
  co2KgYear: kwhYear * 1.14,
  population: null,
  customers: null,
  electrificationPct: null,
  villagesNoPln: null,
  estimated: true,
});

const fc: RegionCollection = {
  type: "FeatureCollection",
  features: [
    region("kutai-kartanegara", "Kutai Kartanegara", "kabupaten", 1.2e9),
    region("samarinda", "Samarinda", "kota", 1.4e9),
    region("mahakam-ulu", "Mahakam Ulu", "kabupaten", 1e7),
    region("bontang", "Bontang", "kota", 2.6e8),
  ].map((properties, i) => ({
    type: "Feature",
    id: properties.id,
    geometry: { type: "Polygon", coordinates: [[[116 + i, 0], [116.5 + i, 0], [116.5 + i, -0.5], [116 + i, 0]]] },
    properties: { ...properties, labelPoint: [116.25 + i, -0.2] as [number, number] },
  })),
};

describe("region label features", () => {
  const labels = labelFeatures(fc, "co2");
  const byId = new Map(labels.features.map((f) => [f.properties.id, f]));

  test("one point per region, at the label point from the data, named from the data", () => {
    expect(labels.features).toHaveLength(4);
    expect(byId.get("samarinda")?.geometry.coordinates).toEqual([117.25, -0.2]);
    expect(byId.get("kutai-kartanegara")?.properties.name).toBe("Kutai Kartanegara");
  });

  test("a hand-placed region uses its curated point instead (the crowded coast)", () => {
    expect(byId.get("kutai-kartanegara")?.geometry.coordinates).toEqual(LABEL_PLACEMENT["kutai-kartanegara"]!.at!);
  });

  test("each label is lifted to the resting height of its column", () => {
    // Samarinda has the highest value, so its column is the tallest.
    expect(byId.get("samarinda")?.properties.lift).toBe(columnHeight(1));
    expect(byId.get("mahakam-ulu")!.properties.lift).toBeLessThan(byId.get("bontang")!.properties.lift);
  });

  test("the larger the region's value, the earlier its name is placed, so the big names never yield", () => {
    const order = [...labels.features].sort((a, b) => a.properties.rank - b.properties.rank).map((f) => f.properties.id);
    expect(order).toEqual(["samarinda", "kutai-kartanegara", "bontang", "mahakam-ulu"]);
  });

  test("the ranking follows the metric shown", () => {
    // A fixture where the two metrics disagree: Bontang uses more power but emits less.
    const swapped: RegionCollection = {
      ...fc,
      features: fc.features.map((f) =>
        f.properties.id === "bontang" ? { ...f, properties: { ...f.properties, kwhYear: 1.3e9, co2KgYear: 1 } } : f,
      ),
    };
    const rank = (metric: "co2" | "kwh") =>
      new Map(labelFeatures(swapped, metric).features.map((f) => [f.properties.id, f.properties.rank])).get("bontang");
    expect(rank("kwh")).toBe(1);
    expect(rank("co2")).toBe(3);
  });

  test("a region without a label point is left out instead of being drawn at 0,0", () => {
    const broken: RegionCollection = { ...fc, features: [{ ...fc.features[0]!, properties: { ...fc.features[0]!.properties, labelPoint: undefined } }] };
    expect(labelFeatures(broken, "co2").features).toEqual([]);
  });
});

describe("label anchors", () => {
  test("at the province view hand-placed regions get their anchor and offset; the rest sit centred", () => {
    const [step, input, province, zoom, close] = labelAnchor() as unknown[];
    expect([step, input, zoom, close]).toEqual(["step", ["zoom"], CLOSE_LABEL_ZOOM, "center"]);
    const anchor = province as unknown[];
    expect(anchor.slice(0, 2)).toEqual(["match", ["get", "id"]]);
    expect(anchor.at(-1)).toBe("center");
    expect(anchor[anchor.indexOf("bontang") + 1]).toBe(LABEL_PLACEMENT.bontang!.anchor);
    const [, , offsets, , closeOffset] = labelOffset() as unknown[];
    const offset = offsets as unknown[];
    expect(offset.at(-1)).toEqual(["literal", [0, 0]]);
    expect(offset[offset.indexOf("bontang") + 1]).toEqual(["literal", LABEL_PLACEMENT.bontang!.offset]);
    expect(closeOffset).toEqual(["literal", [0, 0]]);
  });

  test("closer in (a selected region fills the view) every label is centred on its point", () => {
    // Above the province view (6.6) and below the first region close-up (7.97 for Kutai Kartanegara).
    expect(CLOSE_LABEL_ZOOM).toBeGreaterThan(6.6);
    expect(CLOSE_LABEL_ZOOM).toBeLessThan(7.9);
  });
});

describe("label opacity", () => {
  test("full or nothing, only while the columns are the map: never half-faded", () => {
    // A selected region's camera can rest anywhere from zoom 7.5 to 10.5; a fade band there left a ghost.
    // On the globe the basemap names the geography instead, and from city zoom the place names return.
    expect(labelOpacity()).toEqual(["step", ["zoom"], 0, GLOBE_LABEL_ZOOM, 1, PLACE_LABEL_ZOOM, 0]);
  });
});

describe("label lift follows the columns", () => {
  test("the lift flattens with zoom exactly like the column heights", () => {
    expect(labelLift()).toEqual(columnZoomScale(["coalesce", ["get", "lift"], 0]));
  });
});

describe("basemap labels make room for the region labels", () => {
  test("no basemap place or road labels at the province view", () => {
    expect(basemapLabelConfig(6.6)).toEqual({ showPlaceLabels: false, showRoadLabels: false });
    expect(basemapLabelConfig(GLOBE_LABEL_ZOOM)).toEqual({ showPlaceLabels: false, showRoadLabels: false });
  });
  test("the globe and the start of the intro name the geography (Malaysia, Sulawesi, Selat Makassar)", () => {
    expect(GLOBE_LABEL_ZOOM).toBe(5.5);
    expect(basemapLabelConfig(2)).toEqual({ showPlaceLabels: true, showRoadLabels: false });
    expect(basemapLabelConfig(5.49)).toEqual({ showPlaceLabels: true, showRoadLabels: false });
  });
  test("place names come back closer in, road names at city zoom", () => {
    // Place names wait until the columns are gone (zoom 12): behind a fading column they look ghosted.
    expect(PLACE_LABEL_ZOOM).toBe(12);
    expect(basemapLabelConfig(10.5)).toEqual({ showPlaceLabels: false, showRoadLabels: false });
    expect(basemapLabelConfig(11)).toEqual({ showPlaceLabels: false, showRoadLabels: true });
    expect(basemapLabelConfig(12)).toEqual({ showPlaceLabels: true, showRoadLabels: true });
    expect(basemapLabelConfig(16.6)).toEqual({ showPlaceLabels: true, showRoadLabels: true });
  });
});
