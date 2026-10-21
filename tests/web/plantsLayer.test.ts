import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { PlantCollection } from "../../src/web/api.ts";
import { addPlants, PLANT_HIT_LAYER, PLANT_LAYER, PULSE_IDLE_MS, pulseWantsFrame, removePlants } from "../../src/web/map/plantsLayer.ts";
import { clearTokenCache } from "../../src/web/theme.ts";

describe("plant pulse repaints only while a marker is drawn", () => {
  test("keeps asking for frames right after Mapbox drew a marker", () => {
    expect(pulseWantsFrame(10_000, 9_990)).toBe(true);
    expect(pulseWantsFrame(10_000, 10_000 - PULSE_IDLE_MS + 1)).toBe(true);
  });
  test("stops when no marker has been drawn for a while (all plants off screen)", () => {
    expect(PULSE_IDLE_MS).toBeLessThanOrEqual(500);
    expect(pulseWantsFrame(10_000, 10_000 - PULSE_IDLE_MS)).toBe(false);
    expect(pulseWantsFrame(10_000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});

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

describe("plant markers keep the region labels clear", () => {
  test("the drawn markers go under the region labels; an invisible copy above them keeps labels off the markers", () => {
    const { map, order, specs } = fakeMap(["regions-extrusion", "region-labels"]);
    addPlants(map, plants, true, { below: "region-labels" });
    expect(order).toEqual(["regions-extrusion", PLANT_LAYER, "region-labels", PLANT_HIT_LAYER]);
    // Drawn markers never push other symbols away (their pulse ring is large)...
    expect(specs.get(PLANT_LAYER)?.layout?.["icon-ignore-placement"]).toBe(true);
    // ...the hit layer does, with a box the size of the marker itself, and is never seen.
    const hit = specs.get(PLANT_HIT_LAYER)!;
    expect(hit.layout?.["icon-ignore-placement"]).toBe(false);
    expect(hit.layout?.["icon-allow-overlap"]).toBe(true);
    expect(hit.paint?.["icon-opacity"]).toBe(0);
    expect(hit.layout?.["icon-size"]).toEqual(specs.get(PLANT_LAYER)?.layout?.["icon-size"]);
    removePlants(map);
    expect(order).toEqual(["regions-extrusion", "region-labels"]);
  });

  test("the hit box is the marker's core and ring, not its pulse", () => {
    const { map, images } = fakeMap();
    addPlants(map, plants, true);
    const hit = images.get("plant-hit")!;
    const marker = images.get("plant-batubara")!;
    expect(hit.width).toBeLessThan(marker.width / 2);
    removePlants(map);
    expect(images.size).toBe(0);
  });
});
