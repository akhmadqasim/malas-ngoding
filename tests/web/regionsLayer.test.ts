import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { RegionCollection } from "../../src/web/api.ts";
import {
  addRegions,
  REGION_LAYER,
  type ColumnTop,
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
import { expressionErrors, styleSpec } from "./styleSpec.ts";

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
/** How far a column's colour has moved toward the dimmed colour (feature-state `fade`, 0 when unset). */
const fade = (s: Record<string, unknown>) => Number(s.fade ?? 0);

/** Runs the queued frames once, `ms` from now: part of the way through a tween started just before. */
function step(ms: number) {
  const run = frames;
  frames = [];
  const at = performance.now() + ms;
  for (const f of run) f(at);
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
    expect(fade(state("paser"))).toBeCloseTo(0.6, 5);
    expect(fade(state("samarinda"))).toBe(0);
    fire("regions-leave", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    flush();
    expect(Number(state("samarinda").h)).toBeCloseTo(resting, 0);
    expect(fade(state("paser"))).toBe(0);
    removeRegions(map);
  });

  test("the other columns fade toward the dimmed colour over the hover time, never in one jump", () => {
    const { map, fire, state } = setup();
    riseRegions(map, fc);
    flush();
    fire("regions-enter", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    // Nothing changes colour on the event itself...
    expect(fade(state("paser"))).toBe(0);
    // ...half-way through the 300 ms it is on its way...
    step(150);
    expect(fade(state("paser"))).toBeGreaterThan(0.05);
    expect(fade(state("paser"))).toBeLessThan(0.6);
    // ...and it settles at the preview's 60%.
    flush();
    expect(fade(state("paser"))).toBeCloseTo(0.6, 5);
    fire("regions-leave", { feature: { id: "samarinda" }, point: { x: 0, y: 0 } });
    step(150);
    expect(fade(state("paser"))).toBeGreaterThan(0);
    expect(fade(state("paser"))).toBeLessThan(0.6);
    flush();
    expect(fade(state("paser"))).toBe(0);
    removeRegions(map);
  });

  test("the colour follows the fade state: the ramp at 0, the dimmed colour at 1", () => {
    const { map, specs } = setup();
    const color = specs.get(REGION_LAYER)?.paint?.["fill-extrusion-color"] as unknown[];
    expect(color.slice(0, 3)).toEqual(["interpolate", ["linear"], ["coalesce", ["feature-state", "fade"], 0]]);
    const [, , , atZero, ramp, atOne, dim] = color;
    expect([atZero, atOne]).toEqual([0, 1]);
    expect((ramp as unknown[])[2]).toEqual(["coalesce", ["feature-state", "t"], 0]);
    expect(dim).toBe("#123456");
    // Mapbox's own parser accepts it as a feature-state driven colour.
    expect(expressionErrors(color, styleSpec.latest["paint_fill-extrusion"]["fill-extrusion-color"])).toEqual([]);
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
    flush();
    expect(fade(state("samarinda"))).toBe(0);
    expect(fade(state("paser"))).toBe(1);
    removeRegions(map);
  });

  test("a selection dims the other columns all the way, over the selection time", () => {
    const { map, state } = setup();
    riseRegions(map, fc);
    flush();
    setSelectedRegion(map, "samarinda");
    step(450);
    expect(fade(state("paser"))).toBeGreaterThan(0.05);
    expect(fade(state("paser"))).toBeLessThan(1);
    flush();
    expect(fade(state("paser"))).toBe(1);
    expect(fade(state("samarinda"))).toBe(0);
    setSelectedRegion(map, null);
    flush();
    expect(fade(state("paser"))).toBe(0);
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
    flush();
    expect(fade(state("samarinda"))).toBe(0);
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

describe("column tops for the plant pins", () => {
  function withTops() {
    const f = fakeMap();
    const reports: ColumnTop[][] = [];
    addRegions(f.map, fc, "co2", { onColumnTops: (tops) => reports.push(tops) });
    /** The last reported top of a column. */
    const top = (id: string) => reports.flat().filter((t) => t.id === id).at(-1);
    return { ...f, reports, top };
  }

  test("every column starts on the ground, then reports each frame of its rise until it stands", () => {
    const { map, reports, top, state } = withTops();
    expect(reports[0]?.map((t) => t.id).sort()).toEqual(["paser", "samarinda"]);
    expect(top("samarinda")).toEqual({ id: "samarinda", h: 0, selected: false });
    riseRegions(map, fc);
    step(400);
    const midway = top("samarinda")!.h;
    expect(midway).toBeGreaterThan(0);
    flush();
    expect(top("samarinda")!.h).toBeGreaterThan(midway);
    expect(top("samarinda")!.h).toBe(Number(state("samarinda").h));
    removeRegions(map);
  });

  test("a hover lift and a selection move the tops; the selected column reports its own curve", () => {
    const { map, top, state } = withTops();
    riseRegions(map, fc);
    flush();
    setRegionHover(map, "paser");
    flush();
    expect(top("paser")!.h).toBe(Number(state("paser").h));
    setRegionHover(map, null);
    setSelectedRegion(map, "paser");
    expect(top("paser")!.selected).toBe(true);
    flush();
    expect(top("samarinda")).toEqual({ id: "samarinda", h: 0, selected: false });
    expect(top("paser")!.h).toBe(Number(state("paser").h));
    removeRegions(map);
  });

  test("with the columns switched off every top is on the ground, and back where it stands when on", () => {
    const { map, top, state } = withTops();
    riseRegions(map, fc);
    flush();
    setRegionsVisible(map, false);
    expect(top("samarinda")!.h).toBe(0);
    expect(top("paser")!.h).toBe(0);
    setRegionsVisible(map, true);
    expect(top("samarinda")!.h).toBe(Number(state("samarinda").h));
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
