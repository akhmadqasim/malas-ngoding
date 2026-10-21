import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection, RegionCollection } from "../../src/web/api.ts";
import { columnZoomScale, selectedZoomScale } from "../../src/web/map/columns.ts";
import {
  addPlants,
  countOffset,
  PIN,
  pinIconSize,
  pinScale,
  plantClusterHtml,
  plantLayerIds,
  plantPopupHtml,
  removePlants,
  setPlantLifts,
} from "../../src/web/map/plantsLayer.ts";
import { clearTokenCache } from "../../src/web/theme.ts";
import { expressionErrors, styleSpec } from "./styleSpec.ts";

type LayerSpec = { filter?: unknown; layout?: Record<string, unknown>; paint?: Record<string, unknown> };

/** Just enough of mapboxgl.Map to add and remove the plant layers, keeping the layer order. */
function fakeMap(existing: string[] = []) {
  const order = [...existing];
  const specs = new Map<string, LayerSpec>();
  const paintCalls: [string, string, unknown][] = [];
  const images = new Map<string, { width: number; height: number }>();
  const sources = new Set<string>();
  const opacity = new Map<number, number>();
  const map = {
    addSource: (id: string) => void sources.add(id),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: LayerSpec & { id: string }, before?: string) => {
      specs.set(l.id, l);
      const at = before ? order.indexOf(before) : -1;
      if (at >= 0) order.splice(at, 0, l.id);
      else order.push(l.id);
    },
    getLayer: (id: string) => (order.includes(id) ? {} : undefined),
    removeLayer: (id: string) => void order.splice(order.indexOf(id), 1),
    addImage: (id: string, image: { width: number; height: number }) => void images.set(id, image),
    hasImage: (id: string) => images.has(id),
    removeImage: (id: string) => void images.delete(id),
    addInteraction: () => {},
    removeInteraction: () => {},
    getCanvas: () => ({ style: { cursor: "" } }),
    getZoom: () => 6.55,
    on: () => {},
    off: () => {},
    setFeatureState: (target: { id: number }, state: { o: number }) => void opacity.set(target.id, state.o),
    setPaintProperty: (layer: string, prop: string, value: unknown) => void paintCalls.push([layer, prop, value]),
    triggerRepaint: () => {},
  };
  return { map: map as unknown as MapboxMap, order, specs, images, opacity, paintCalls };
}

const plants: PlantCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [117.45, -0.12] }, properties: { name: "A", fuel: "batubara", capacityMw: 2200, status: "operating", approx: false, source: "t" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [117.14, -0.99] }, properties: { name: "B", fuel: "gas", capacityMw: 117, status: "operating", approx: false, source: "t" } },
  ],
};

/** Two square regions: a holds the 2.200 MW plant, b the 117 MW one; the third plant lies at sea. */
const square = (id: string, lng: number, lat: number) => ({
  type: "Feature" as const,
  id,
  geometry: { type: "Polygon" as const, coordinates: [[[lng, lat], [lng + 0.5, lat], [lng + 0.5, lat + 0.5], [lng, lat + 0.5], [lng, lat]]] },
  properties: { id, name: id, labelPoint: [lng + 0.25, lat + 0.25] } as never,
});
const regions: RegionCollection = { type: "FeatureCollection", features: [square("a", 117.2, -0.3), square("b", 117, -1.2)] };
const withSea: PlantCollection = {
  ...plants,
  features: [
    ...plants.features,
    { type: "Feature", geometry: { type: "Point", coordinates: [118.5, -1.5] }, properties: { name: "C", fuel: "diesel", capacityMw: 10, status: "operating", approx: false, source: "t" } },
  ],
};
/** Puts every column back on the ground, so no lift carries over into the next test. */
const flatten = (map: MapboxMap) =>
  setPlantLifts(map, [
    { id: "a", h: 0, selected: false },
    { id: "b", h: 0, selected: false },
  ]);

type SpecTable = Record<string, Record<string, unknown>>;
const latest = styleSpec.latest as unknown as SpecTable;

const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, window: g.window, getComputedStyle: g.getComputedStyle };
beforeEach(() => {
  // A canvas without a 2D context: the marker images fall back to empty pixels, which is all this test needs.
  g.document = { documentElement: {}, hidden: false, createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  g.window = { matchMedia: () => ({ matches: false }) };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });
});
afterEach(() => {
  Object.assign(g, saved);
  clearTokenCache();
});

describe("plant pins never cost a region name", () => {
  test("the pins are drawn under the region names and never push a name away", () => {
    const { map, order, specs } = fakeMap(["regions-extrusion", "region-labels"]);
    addPlants(map, withSea, true, { below: "region-labels", regions });
    // A name may sit over a pin (its ink halo keeps it legible); the pin stays visible around it.
    const pins = plantLayerIds();
    expect(pins).toHaveLength(3);
    expect(order).toEqual(["regions-extrusion", ...pins, "region-labels"]);
    for (const id of pins) {
      expect(specs.get(id)?.layout?.["icon-ignore-placement"]).toBe(true);
      expect(specs.get(id)?.layout?.["icon-allow-overlap"]).toBe(true);
      expect(specs.get(id)?.layout?.["text-ignore-placement"]).toBe(true);
      expect(specs.get(id)?.layout?.["text-allow-overlap"]).toBe(true);
    }
    removePlants(map);
    expect(order).toEqual(["regions-extrusion", "region-labels"]);
    expect(plantLayerIds()).toEqual([]);
  });

  test("each marker's opacity is written to feature-state for the current zoom, not left to a paint expression", () => {
    const { map, specs, opacity } = fakeMap();
    addPlants(map, plants, true);
    for (const id of plantLayerIds()) {
      expect(specs.get(id)?.paint?.["icon-opacity"]).toEqual(["coalesce", ["feature-state", "o"], 0]);
      expect(specs.get(id)?.paint?.["text-opacity"]).toEqual(["coalesce", ["feature-state", "o"], 0]);
    }
    // Two plants far apart: both fully shown at the province view.
    expect([...opacity.values()].filter((o) => o === 1)).toHaveLength(2);
    removePlants(map);
  });

  test("only the marker images of the fuels present are added, and all of them are removed", () => {
    const { map, images } = fakeMap();
    addPlants(map, plants, true);
    expect([...images.keys()].sort()).toEqual(["plant-batubara", "plant-gas"]);
    removePlants(map);
    expect(images.size).toBe(0);
  });
});

describe("plant pins stand on the column tops", () => {
  test("one pin layer per column with plants in it: the ground first, then the columns north to south", () => {
    const { map, specs } = fakeMap();
    addPlants(map, withSea, true, { regions });
    // C lies at sea, A in region a (further north), B in region b (nearer the camera, drawn last).
    expect(plantLayerIds()).toEqual(["plants-ground", "plants-a", "plants-b"]);
    expect(specs.get("plants-a")?.filter).toEqual(["==", ["get", "column"], "a"]);
    removePlants(map);
  });

  test("without the region shapes every pin stands on the ground", () => {
    const { map } = fakeMap();
    addPlants(map, plants, true);
    expect(plantLayerIds()).toEqual(["plants-ground"]);
    removePlants(map);
  });

  test("a pin is lifted to its column's top by zoom, follows every move, and skips writes that change nothing", () => {
    const { map, specs, paintCalls } = fakeMap();
    setPlantLifts(map, [
      { id: "a", h: 60_000, selected: false },
      { id: "b", h: 0, selected: false },
    ]);
    addPlants(map, withSea, true, { regions });
    // Columns that rose before the pins were added: the pins start on them.
    expect(specs.get("plants-a")?.paint?.["symbol-z-offset"]).toEqual(columnZoomScale(60_000));
    expect(specs.get("plants-b")?.paint?.["symbol-z-offset"]).toBe(0);
    expect(specs.get("plants-ground")?.paint?.["symbol-z-offset"]).toBe(0);
    // Every frame of a tween moves the pins, with no transition, which would lag behind the column.
    expect(specs.get("plants-a")?.paint?.["symbol-z-offset-transition"]).toEqual({ duration: 0, delay: 0 });
    setPlantLifts(map, [{ id: "b", h: 30_000.4, selected: false }]);
    expect(paintCalls.at(-1)).toEqual(["plants-b", "symbol-z-offset", columnZoomScale(30_000)]);
    // A selected column flattens sooner; its pins follow its curve.
    setPlantLifts(map, [{ id: "b", h: 33_000, selected: true }]);
    expect(paintCalls.at(-1)).toEqual(["plants-b", "symbol-z-offset", selectedZoomScale(33_000)]);
    // The Wilayah switch off reports every column at 0: the pins go to the ground.
    setPlantLifts(map, [{ id: "a", h: 0, selected: false }]);
    expect(paintCalls.at(-1)).toEqual(["plants-a", "symbol-z-offset", 0]);
    const writes = paintCalls.length;
    setPlantLifts(map, [{ id: "a", h: 0, selected: false }]);
    expect(paintCalls).toHaveLength(writes);
    removePlants(map);
    flatten(map);
  });

  test("the point of the pin marks the plant, and the pins ride on the columns, never ghosted", () => {
    const { map, specs } = fakeMap();
    addPlants(map, plants, true, { regions });
    for (const id of plantLayerIds()) {
      expect(specs.get(id)?.layout?.["icon-anchor"]).toBe("bottom");
      expect(specs.get(id)?.layout?.["symbol-z-elevate"]).toBe(true);
      expect(specs.get(id)?.paint?.["icon-occlusion-opacity"]).toBe(1);
      expect(specs.get(id)?.paint?.["text-occlusion-opacity"]).toBe(1);
    }
    removePlants(map);
  });

  test("every layout and paint value of a pin layer is valid Mapbox style", () => {
    const { map, specs } = fakeMap();
    setPlantLifts(map, [{ id: "a", h: 60_000, selected: true }]);
    addPlants(map, plants, true, { regions });
    const spec = specs.get("plants-a")!;
    for (const [key, value] of Object.entries(spec.layout ?? {})) expect([key, expressionErrors(value, latest.layout_symbol![key])]).toEqual([key, []]);
    for (const [key, value] of Object.entries(spec.paint ?? {}))
      if (!key.endsWith("-transition")) expect([key, expressionErrors(value, latest.paint_symbol![key])]).toEqual([key, []]);
    removePlants(map);
    flatten(map);
  });

  test("a group's count sits in the centre of its pin's head at every size", () => {
    const offset = styleSpec.expression.createPropertyExpression(countOffset(), latest.layout_symbol!["text-offset"] as never);
    const size = styleSpec.expression.createPropertyExpression(pinIconSize(), latest.layout_symbol!["icon-size"] as never);
    if (offset.result !== "success" || size.result !== "success") throw new Error("invalid expression");
    for (const capacityMw of [10, 400, 2200, 5000]) {
      const feature = { type: "Point", properties: { kind: "group", capacityMw } } as never;
      const scale = size.value.evaluate({ zoom: 7 } as never, feature) as number;
      expect(scale).toBeCloseTo(pinScale("group", capacityMw), 6);
      // text-offset is in ems of the 12 px count, up from the point of the pin.
      const [, dy] = offset.value.evaluate({ zoom: 7 } as never, feature) as number[];
      expect(-dy! * 12).toBeCloseTo(PIN.headAbovePoint * scale, 4);
    }
    // A single plant is scaled by its own MW, never raised to a group's minimum.
    expect(pinScale("plant", 10)).toBeLessThan(pinScale("group", 10));
  });
});

describe("plant tooltips", () => {
  const props = (name: string, fuel: string, capacityMw: number, status = "operating", approx = false) =>
    ({ name, fuel, capacityMw, status, approx, source: "t" }) as never;

  test("one plant: name, fuel and capacity in MW, and its status when it is not operating", () => {
    const html = plantPopupHtml(props("PLTU <Teluk>", "batubara", 2200, "planned", true));
    expect(html).toContain("PLTU &lt;Teluk&gt;");
    expect(html).toContain("Batu bara");
    expect(html).toContain('<span class="num">2.200</span> MW');
    expect(html).toContain("Rencana");
    expect(html).toContain("Lokasi perkiraan");
    expect(plantPopupHtml(props("PLTG", "gas", 40))).not.toContain("plant-popup__note");
  });

  test("a cluster lists its plants, largest first", () => {
    const html = plantClusterHtml([props("Kecil", "gas", 40), props("Besar", "batubara", 220), props("Sedang", "surya", 100)]);
    expect(html).toContain("3 pembangkit berdekatan");
    expect(html.indexOf("Besar")).toBeLessThan(html.indexOf("Sedang"));
    expect(html.indexOf("Sedang")).toBeLessThan(html.indexOf("Kecil"));
    expect(html).toContain('data-fuel="surya"');
  });
});
