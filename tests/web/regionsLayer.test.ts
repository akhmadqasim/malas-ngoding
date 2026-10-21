import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { RegionCollection } from "../../src/web/api.ts";
import {
  addRegions,
  REGION_LAYER,
  type RegionHandlers,
  removeRegions,
  riseRegions,
  setRegionHover,
  setRegionMetric,
  setRegionsVisible,
  setSelectedRegion,
} from "../../src/web/map/regionsLayer.ts";
import { REGION_LABEL_LAYER } from "../../src/web/map/regionLabels.ts";
import { clearTokenCache } from "../../src/web/theme.ts";
import type { RegionSummary } from "../../src/shared/types.ts";

type Handler = (e: Record<string, unknown>) => unknown;

/** Just enough of mapboxgl.Map for the regions layer: records feature state, paint calls and handlers. */
function fakeMap() {
  const interactions = new Map<string, Handler>();
  const listeners = new Map<string, Set<Handler>>();
  const layers = new Set<string>();
  const specs = new Map<string, { paint?: Record<string, unknown> }>();
  const sources = new Set<string>();
  const featureState = new Map<string, Record<string, unknown>>();
  const paintCalls: [string, string, unknown][] = [];
  const filters = new Map<string, unknown>();
  const sourceData: unknown[] = [];
  const visibility = new Map<string, unknown>();
  const canvas = { style: { cursor: "" } };
  const zoom = { value: 6.6 };
  const map = {
    addSource: (id: string) => void sources.add(id),
    getSource: (id: string) => (sources.has(id) ? { setData: (d: unknown) => void sourceData.push(d) } : undefined),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string; paint?: Record<string, unknown> }) => {
      layers.add(l.id);
      specs.set(l.id, l);
    },
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: (layer: string, prop: string, value: unknown) => void paintCalls.push([layer, prop, value]),
    setLayoutProperty: (layer: string, prop: string, value: unknown) => {
      if (prop === "visibility") visibility.set(layer, value);
    },
    setFilter: (layer: string, filter: unknown) => void filters.set(layer, filter),
    setFeatureState: (f: { id: string }, s: Record<string, unknown>) =>
      void featureState.set(f.id, { ...featureState.get(f.id), ...s }),
    on: (type: string, fn: Handler) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    off: (type: string, fn: Handler) => void listeners.get(type)?.delete(fn),
    addInteraction: (id: string, spec: { handler: Handler }) => void interactions.set(id, spec.handler),
    removeInteraction: (id: string) => void interactions.delete(id),
    getCanvas: () => canvas,
    getZoom: () => zoom.value,
  };
  return {
    map: map as unknown as MapboxMap,
    zoom,
    fire: (id: string, e: Record<string, unknown>) => interactions.get(id)?.(e),
    emit: (type: string, e: Record<string, unknown>) => listeners.get(type)?.forEach((fn) => fn(e)),
    hovered: (id: string) => featureState.get(id)?.hover === true,
    state: (id: string) => featureState.get(id) ?? {},
    specs,
    paintCalls,
    interactions,
    layers,
    filters,
    visibility,
    /** Data set on a source after it was added (the label heights after a metric switch). */
    labelData: () => sourceData,
    /** The last text-opacity set on the label layer: 0 when hidden, an expression when shown. */
    labelOpacity: () => paintCalls.filter(([l, prop]) => l === REGION_LABEL_LAYER && prop === "text-opacity").at(-1)?.[2],
  };
}

const region = (id: string, kwhYear: number): RegionSummary => ({
  id,
  name: id,
  kind: "kota",
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
  features: [region("samarinda", 2e9), region("paser", 5e8)].map((properties, i) => ({
    type: "Feature",
    id: properties.id,
    geometry: { type: "Polygon", coordinates: [[[116 + i, 0], [116.5 + i, 0], [116.5 + i, -0.5], [116 + i, 0]]] },
    properties: { ...properties, labelPoint: [116.25 + i, -0.2] as [number, number] },
  })),
};

/** Animation frames queued by the layer; `flush()` runs them as if a few seconds passed. */
let frames: ((now: number) => void)[] = [];
function flush() {
  for (let i = 0; i < 50 && frames.length; i++) {
    const run = frames;
    frames = [];
    for (const f of run) f(performance.now() + 10_000);
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, getComputedStyle: g.getComputedStyle, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };

beforeEach(() => {
  // Tokens resolve to a fixed colour; animation frames never run on their own.
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });
  frames = [];
  g.requestAnimationFrame = (f: (now: number) => void) => {
    frames.push(f);
    return frames.length;
  };
  g.cancelAnimationFrame = () => {};
});
afterEach(() => {
  Object.assign(g, { document: saved.document, getComputedStyle: saved.getComputedStyle });
  g.requestAnimationFrame = saved.raf;
  g.cancelAnimationFrame = saved.caf;
  clearTokenCache();
});

function setup() {
  const f = fakeMap();
  const calls = { hover: [] as (string | null)[], pointer: 0 };
  const handlers: RegionHandlers = { onHover: (id) => calls.hover.push(id), onPointer: () => calls.pointer++ };
  addRegions(f.map, fc, "co2", handlers);
  return { ...f, calls };
}

describe("region hover", () => {
  test("moving the pointer inside a region moves the tooltip without re-reporting the region", () => {
    const { fire, emit, calls, map } = setup();
    fire("regions-enter", { feature: { id: "samarinda" }, point: { x: 10, y: 10 } });
    for (let i = 0; i < 20; i++) emit("mousemove", { point: { x: 10 + i, y: 10 } });
    expect(calls.hover).toEqual(["samarinda"]);
    expect(calls.pointer).toBeGreaterThanOrEqual(20);
    removeRegions(map);
  });

  test("entering the next region before leaving the last keeps the new one hovered", () => {
    const { fire, calls, hovered, map } = setup();
    fire("regions-enter", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    fire("regions-enter", { feature: { id: "paser" }, point: { x: 1, y: 0 } });
    fire("regions-leave", { feature: { id: "samarinda" }, point: { x: 1, y: 0 } });
    expect(calls.hover.at(-1)).toBe("paser");
    expect(hovered("paser")).toBe(true);
    expect(hovered("samarinda")).toBe(false);
    removeRegions(map);
  });

  test("hover from the region list lifts the column on the map", () => {
    const { hovered, calls, map } = setup();
    setRegionHover(map, "paser");
    expect(hovered("paser")).toBe(true);
    setRegionHover(map, null);
    expect(hovered("paser")).toBe(false);
    // The list already knows; the map does not echo it back.
    expect(calls.hover).toEqual([]);
    removeRegions(map);
  });
});

describe("hover previews the selection", () => {
  test("the hovered column lifts by 12% and every other column recedes", () => {
    const { map, fire, state } = setup();
    riseRegions(map, fc);
    flush();
    const resting = Number(state("samarinda").h);
    fire("regions-enter", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    flush();
    expect(Number(state("samarinda").h)).toBeCloseTo(resting * 1.12, 0);
    expect(state("paser").recede).toBe(true);
    expect(state("samarinda").recede).toBe(false);
    fire("regions-leave", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    flush();
    expect(Number(state("samarinda").h)).toBeCloseTo(resting, 0);
    expect(state("paser").recede).toBe(false);
    removeRegions(map);
  });

  test("the hovered column is not brightened (one emissive value for every column)", () => {
    const { map, specs } = setup();
    expect(typeof specs.get(REGION_LAYER)?.paint?.["fill-extrusion-emissive-strength"]).toBe("number");
    removeRegions(map);
  });

  test("while a region is selected, hover leaves the dimming to the selection", () => {
    const { map, fire, state } = setup();
    setSelectedRegion(map, "samarinda");
    fire("regions-enter", { feature: { id: "paser" }, point: { x: 0, y: 0 } });
    expect(state("samarinda").recede).toBe(false);
    expect(state("paser").dim).toBe(true);
    removeRegions(map);
  });

  test("the outline no longer claims to mark the selection (it sits under the column)", () => {
    const { map, specs } = setup();
    expect(JSON.stringify(specs.get("regions-outline")?.paint)).not.toContain("selected");
    removeRegions(map);
  });
});

describe("hover after zooming in", () => {
  test("a hover ends when the columns fade out, even if the pointer never moves", () => {
    const { map, fire, emit, zoom, calls, hovered, state } = setup();
    fire("regions-enter", { feature: { id: "paser" }, point: { x: 0, y: 0 } });
    expect(calls.hover).toEqual(["paser"]);
    // A wheel zoom with a still pointer: no mouseleave, only zoom events.
    zoom.value = 9;
    emit("zoom", {});
    expect(hovered("paser")).toBe(true);
    zoom.value = 11.6;
    emit("zoom", {});
    expect(calls.hover).toEqual(["paser", null]);
    expect(hovered("paser")).toBe(false);
    expect(state("samarinda").recede).toBe(false);
    removeRegions(map);
  });
});

describe("region labels", () => {
  test("the labels sit on the columns: hidden while the intro flies, shown once the columns have risen", () => {
    const { map, layers, specs, labelOpacity } = setup();
    expect(layers.has(REGION_LABEL_LAYER)).toBe(true);
    expect(specs.get(REGION_LABEL_LAYER)?.paint?.["text-opacity"]).toBe(0);
    riseRegions(map, fc);
    expect(labelOpacity()).toBeUndefined();
    flush();
    expect(labelOpacity()).not.toBe(0);
    expect(labelOpacity()).toBeDefined();
    removeRegions(map);
  });

  test("a metric switch hides the labels while the columns sink and rise, then shows them again", async () => {
    const { map, labelOpacity, labelData } = setup();
    riseRegions(map, fc);
    flush();
    setRegionMetric(map, "kwh");
    expect(labelOpacity()).toBe(0);
    // The columns have sunk, but the swap to the new metric has not happened yet: still hidden.
    flush();
    expect(labelOpacity()).toBe(0);
    await Bun.sleep(450);
    flush();
    expect(labelOpacity()).not.toBe(0);
    // The labels were moved to the heights of the new metric.
    expect(labelData().at(-1)).toBeDefined();
    removeRegions(map);
  });

  test("selecting a region keeps only its label, once the columns have settled", () => {
    const { map, filters, labelOpacity } = setup();
    riseRegions(map, fc);
    flush();
    setSelectedRegion(map, "paser");
    expect(labelOpacity()).toBe(0);
    flush();
    expect(filters.get(REGION_LABEL_LAYER)).toEqual(["==", ["get", "id"], "paser"]);
    expect(labelOpacity()).not.toBe(0);
    setSelectedRegion(map, null);
    flush();
    expect(filters.get(REGION_LABEL_LAYER)).toBeNull();
    removeRegions(map);
  });

  test("the labels follow the region layer switch", () => {
    const { map, visibility } = setup();
    setRegionsVisible(map, false);
    expect(visibility.get(REGION_LABEL_LAYER)).toBe("none");
    setRegionsVisible(map, true);
    expect(visibility.get(REGION_LABEL_LAYER)).toBe("visible");
    removeRegions(map);
  });
});

describe("cleanup", () => {
  test("removeRegions cancels a pending metric switch and removes everything it added", async () => {
    const { map, paintCalls, interactions, layers } = setup();
    setRegionMetric(map, "kwh");
    removeRegions(map);
    await Bun.sleep(500);
    expect(paintCalls.filter(([layer, prop]) => layer === REGION_LAYER && prop === "fill-extrusion-color")).toEqual([]);
    expect(interactions.size).toBe(0);
    expect(layers.size).toBe(0);
  });

  test("removeRegions also cancels a pending label reveal", () => {
    const { map, labelOpacity } = setup();
    riseRegions(map, fc);
    removeRegions(map);
    flush();
    expect(labelOpacity()).toBeUndefined();
  });
});
