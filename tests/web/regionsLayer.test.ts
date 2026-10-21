import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { RegionCollection } from "../../src/web/api.ts";
import {
  addRegions,
  REGION_LAYER,
  type RegionHandlers,
  removeRegions,
  setRegionHover,
  setRegionMetric,
} from "../../src/web/map/regionsLayer.ts";
import { clearTokenCache } from "../../src/web/theme.ts";
import type { RegionSummary } from "../../src/shared/types.ts";

type Handler = (e: Record<string, unknown>) => unknown;

/** Just enough of mapboxgl.Map for the regions layer: records feature state, paint calls and handlers. */
function fakeMap() {
  const interactions = new Map<string, Handler>();
  const listeners = new Map<string, Set<Handler>>();
  const layers = new Set<string>();
  const sources = new Set<string>();
  const featureState = new Map<string, Record<string, unknown>>();
  const paintCalls: [string, string][] = [];
  const canvas = { style: { cursor: "" } };
  const map = {
    addSource: (id: string) => void sources.add(id),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    removeSource: (id: string) => void sources.delete(id),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    removeLayer: (id: string) => void layers.delete(id),
    setPaintProperty: (layer: string, prop: string) => void paintCalls.push([layer, prop]),
    setLayoutProperty: () => {},
    setFeatureState: (f: { id: string }, s: Record<string, unknown>) =>
      void featureState.set(f.id, { ...featureState.get(f.id), ...s }),
    on: (type: string, fn: Handler) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    off: (type: string, fn: Handler) => void listeners.get(type)?.delete(fn),
    addInteraction: (id: string, spec: { handler: Handler }) => void interactions.set(id, spec.handler),
    removeInteraction: (id: string) => void interactions.delete(id),
    getCanvas: () => canvas,
  };
  return {
    map: map as unknown as MapboxMap,
    fire: (id: string, e: Record<string, unknown>) => interactions.get(id)?.(e),
    emit: (type: string, e: Record<string, unknown>) => listeners.get(type)?.forEach((fn) => fn(e)),
    hovered: (id: string) => featureState.get(id)?.hover === true,
    paintCalls,
    interactions,
    layers,
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
    properties,
  })),
};

const g = globalThis as unknown as Record<string, unknown>;
const saved = { document: g.document, getComputedStyle: g.getComputedStyle, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };

beforeEach(() => {
  // Tokens resolve to a fixed colour; animation frames never run on their own.
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });
  g.requestAnimationFrame = () => 1;
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
});
