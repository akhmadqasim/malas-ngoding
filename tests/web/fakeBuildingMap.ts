/** A fake Mapbox map for the building interaction tests: interactions, feature state, terrain, camera. */

/** A square building of side `d` degrees with its corner at lng, lat. */
export const square = (lng: number, lat: number, d: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
});

export type Handler = (e: { feature?: Feature; point?: { x: number; y: number } }) => unknown;
export interface Feature {
  id?: number;
  geometry: ReturnType<typeof square>;
  properties: Record<string, unknown>;
}

/** Enough of a Mapbox map for the building interaction: interactions, feature state, terrain, camera. */
/**
 * `holdFlights`: a flight does not land by itself; the test lands it (`land`) or moves the camera itself
 * (`fire("movestart", { originalEvent })`, a user gesture) while it is under way.
 */
export function fakeBuildingMap(opts: { zoom?: number; rendered?: Feature[]; holdFlights?: boolean } = {}) {
  const interactions = new Map<string, Handler>();
  const states = new Map<number | undefined, Record<string, unknown>>();
  const config: Record<string, unknown> = {};
  type Listener = (e?: Record<string, unknown>) => void;
  const listeners = new Map<string, Set<Listener>>();
  let terrain: object | null = { source: "mapbox-dem", exaggeration: 1.4 };
  let zoom = opts.zoom ?? 16;
  const canvas = { style: { cursor: "" }, clientWidth: 1000, clientHeight: 800 };
  const fire = (type: string, e?: Record<string, unknown>) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
  };
  const land = () => {
    fire("moveend");
    queueMicrotask(() => fire("idle"));
  };
  const map = {
    addInteraction: (id: string, spec: { handler: Handler }) => void interactions.set(id, spec.handler),
    removeInteraction: (id: string) => void interactions.delete(id),
    setFeatureState: (f: Feature, s: Record<string, unknown>) => void states.set(f.id, { ...states.get(f.id), ...s }),
    setConfigProperty: (_: string, key: string, value: unknown) => void (config[key] = value),
    getCanvas: () => canvas,
    getTerrain: () => terrain,
    setTerrain: (t: object | null) => void (terrain = t),
    getZoom: () => zoom,
    getBearing: () => -14,
    on: (type: string, fn: Listener) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    off: (type: string, fn: Listener) => void listeners.get(type)?.delete(fn),
    once: (type: string, fn: Listener) => {
      const wrap: Listener = (e) => {
        listeners.get(type)?.delete(wrap);
        fn(e);
      };
      map.on(type, wrap);
    },
    stop: () => {},
    flyTo: (o: { zoom: number }) => {
      zoom = o.zoom;
      // The flight's own movestart carries no originalEvent, as in Mapbox.
      fire("movestart", {});
      if (!opts.holdFlights) land();
    },
    easeTo: () => {},
    project: ([x, y]: [number, number]) => ({ x: x * 1000, y: y * 1000 }),
    queryRenderedFeatures: () => opts.rendered ?? [],
  };
  const setZoom = (z: number) => {
    zoom = z;
    fire("zoom");
  };
  const listenerCount = (type: string) => listeners.get(type)?.size ?? 0;
  return { map: map as unknown as import("mapbox-gl").Map, interactions, states, config, canvas, setZoom, terrain: () => terrain, fire, land, listenerCount };
}

