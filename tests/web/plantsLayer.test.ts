import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection } from "../../src/web/api.ts";
import { addPlants, PLANT_CLUSTER_LAYER, PLANT_LAYER, plantClusterHtml, plantPopupHtml, removePlants } from "../../src/web/map/plantsLayer.ts";
import { clearTokenCache } from "../../src/web/theme.ts";

/** Just enough of mapboxgl.Map to add and remove the plant layers, keeping the layer order. */
function fakeMap(existing: string[] = []) {
  const order = [...existing];
  const specs = new Map<string, { layout?: Record<string, unknown>; paint?: Record<string, unknown> }>();
  const images = new Map<string, { width: number; height: number }>();
  const sources = new Set<string>();
  const map = {
    addSource: (id: string) => void sources.add(id),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string; layout?: Record<string, unknown>; paint?: Record<string, unknown> }, before?: string) => {
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
    triggerRepaint: () => {},
  };
  return { map: map as unknown as MapboxMap, order, specs, images };
}

const plants: PlantCollection = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [117.45, -0.12] }, properties: { name: "A", fuel: "batubara", capacityMw: 2200, status: "operating", approx: false, source: "t" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [117.14, -0.99] }, properties: { name: "B", fuel: "gas", capacityMw: 117, status: "operating", approx: false, source: "t" } },
  ],
};

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

describe("plant markers never cost a region name", () => {
  test("the markers are drawn under the region names and never push a name away", () => {
    const { map, order, specs } = fakeMap(["regions-extrusion", "region-labels"]);
    addPlants(map, plants, true, { below: "region-labels" });
    // A name may sit over a marker (its ink halo keeps it legible); the marker stays visible around it.
    expect(order).toEqual(["regions-extrusion", PLANT_LAYER, PLANT_CLUSTER_LAYER, "region-labels"]);
    for (const id of [PLANT_LAYER, PLANT_CLUSTER_LAYER]) {
      expect(specs.get(id)?.layout?.["icon-ignore-placement"]).toBe(true);
      expect(specs.get(id)?.layout?.["icon-allow-overlap"]).toBe(true);
    }
    expect(specs.get(PLANT_CLUSTER_LAYER)?.layout?.["text-ignore-placement"]).toBe(true);
    removePlants(map);
    expect(order).toEqual(["regions-extrusion", "region-labels"]);
  });

  test("only the marker images of the fuels present are added, and all of them are removed", () => {
    const { map, images } = fakeMap();
    addPlants(map, plants, true);
    expect([...images.keys()].sort()).toEqual(["plant-batubara", "plant-cluster", "plant-gas"]);
    removePlants(map);
    expect(images.size).toBe(0);
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
