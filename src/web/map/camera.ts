import mapboxgl, { type LngLatBoundsLike, type Map as MapboxMap } from "mapbox-gl";

/** Overview camera for Kalimantan Timur: the whole province, tilted so the region columns read as 3D. */
export const KALTIM_VIEW = {
  center: [116.5, -0.1] as [number, number],
  zoom: 6.55,
  pitch: 55,
  bearing: -14,
  // Shifts the province right of the region panel on the left.
  padding: { top: 40, bottom: 120, left: 380, right: 40 },
};

/** Where the intro starts: the globe, turned so Borneo sits just right of centre. */
export const GLOBE_VIEW = { center: [101, -2] as [number, number], zoom: 2, pitch: 0, bearing: 0 };

const INTRO_MS = 6000;
/** Camera moves after the intro (docs/research/design/00-direction.md section 6). */
export const FLY_MS = 2000;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let finishIntro: ((skipped: boolean) => void) | null = null;

/**
 * Flies from the globe to Kaltim in about 6 s. Resolves when the camera lands, or right away after
 * `skipIntro()` or any user gesture on the map (the camera then settles on the overview quickly).
 */
export function introFlight(map: MapboxMap): Promise<void> {
  return new Promise((resolve) => {
    const gestures = ["mousedown", "wheel", "touchstart", "keydown"] as const;
    const canvas = map.getCanvasContainer();
    let done = false;

    const end = (skipped: boolean) => {
      if (done) return;
      done = true;
      finishIntro = null;
      map.off("moveend", onMoveEnd);
      for (const g of gestures) canvas.removeEventListener(g, onGesture);
      if (skipped) {
        map.stop();
        map.easeTo({ ...KALTIM_VIEW, duration: prefersReducedMotion() ? 0 : 900 });
      }
      resolve();
    };
    const onMoveEnd = () => end(false);
    const onGesture = () => end(true);

    finishIntro = end;
    for (const g of gestures) canvas.addEventListener(g, onGesture, { passive: true });

    if (prefersReducedMotion()) {
      map.jumpTo(KALTIM_VIEW);
      end(false);
      return;
    }
    map.once("moveend", onMoveEnd);
    map.flyTo({ ...KALTIM_VIEW, duration: INTRO_MS, curve: 1.6, essential: true });
  });
}

/** Ends a running intro flight early. Does nothing when no intro is playing. */
export function skipIntro(): void {
  finishIntro?.(true);
}

/** Drops a running intro without touching the camera (the map is being removed). */
export function abortIntro(): void {
  finishIntro?.(false);
}

/** Room between a framed place and the open chat panel, in px. */
export const CHAT_GAP_PX = 24;

/**
 * Px from the right edge of the window to the open chat panel's left edge, plus `gap`; 0 when the chat is
 * closed or covers most of the width (phones), where no padding could keep a place clear of it.
 */
export function chatInsetRight(gap = CHAT_GAP_PX): number {
  if (typeof document === "undefined") return 0;
  const chat = document.querySelector(".chat")?.getBoundingClientRect();
  const w = window.innerWidth;
  return chat && chat.width > 0 && chat.width < w / 2 ? w - chat.left + gap : 0;
}

/**
 * The overview camera. With the chat open the province frames left of it: the right padding reaches past
 * the chat, and the zoom drops by as much as the free strip narrows, so the whole province still fits.
 */
export function provinceView(): typeof KALTIM_VIEW {
  const chat = chatInsetRight();
  const { left, right } = KALTIM_VIEW.padding;
  if (chat <= right || typeof window === "undefined") return KALTIM_VIEW;
  const full = window.innerWidth - left - right;
  const strip = window.innerWidth - left - chat;
  if (full <= 0 || strip <= 0) return KALTIM_VIEW;
  return { ...KALTIM_VIEW, zoom: KALTIM_VIEW.zoom + Math.log2(strip / full), padding: { ...KALTIM_VIEW.padding, right: chat } };
}

/** Flies back to the whole province (the overview), at its resting bearing, where the idle sway belongs. */
export function flyToProvince(map: MapboxMap): void {
  map.flyTo({ ...provinceView(), duration: prefersReducedMotion() ? 0 : FLY_MS, curve: 1.2, essential: true });
}

export interface FlyOptions {
  /** The region's bounding box; when given, the zoom is chosen so the region fills the view. */
  bounds?: LngLatBoundsLike;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  /** Screen padding so the region is framed beside the side panels. */
  padding?: { top: number; bottom: number; left: number; right: number };
}

/** How many region flights each map has started, and who waits for the next one (map/actions.ts). */
const regionFlights = new WeakMap<MapboxMap, { count: number; waiters: Set<() => void> }>();

function regionFlightsOf(map: MapboxMap) {
  let entry = regionFlights.get(map);
  if (!entry) {
    entry = { count: 0, waiters: new Set() };
    regionFlights.set(map, entry);
  }
  return entry;
}

/** How many region flights `flyToRegion` has started on this map. */
export function regionFlightCount(map: MapboxMap): number {
  return regionFlights.get(map)?.count ?? 0;
}

/**
 * Calls `fn` once, when `flyToRegion` next starts a flight on this map. Unlike `movestart`, the idle sway's
 * bearing frames and the user's gestures do not count. Returns a function that cancels the wait.
 */
export function onNextRegionFlight(map: MapboxMap, fn: () => void): () => void {
  const { waiters } = regionFlightsOf(map);
  const once = () => {
    waiters.delete(once);
    fn();
  };
  waiters.add(once);
  return () => void waiters.delete(once);
}

/** MapView's flight to a region (its box, the measured chrome padding), per map. */
const regionFlyers = new WeakMap<MapboxMap, (id: string) => void>();

/** MapView registers how it flies to a region, so the chat can fly to the open region the same way. */
export function setRegionFlyer(map: MapboxMap, fly: ((id: string) => void) | null): void {
  if (fly) regionFlyers.set(map, fly);
  else regionFlyers.delete(map);
}

/** MapView's region flight for this map, if it has registered one. */
export function regionFlyer(map: MapboxMap): ((id: string) => void) | undefined {
  return regionFlyers.get(map);
}

/** Smooth camera move centred on a region. */
export function flyToRegion(map: MapboxMap, centroid: [number, number], opts: FlyOptions = {}): void {
  const pitch = opts.pitch ?? 58;
  const padding = opts.padding ?? { top: 80, bottom: 80, left: 420, right: 80 };
  const bearing = opts.bearing ?? map.getBearing();
  let zoom = opts.zoom;
  let center = centroid;
  if (zoom === undefined && opts.bounds) {
    // Frame the whole box inside the padding, centred on the box (the centroid can sit far off-centre).
    const fit = map.cameraForBounds(opts.bounds, { padding, pitch, bearing });
    zoom = fit?.zoom;
    if (fit?.center) center = mapboxgl.LngLat.convert(fit.center).toArray() as [number, number];
  }
  map.flyTo({
    center,
    zoom: Math.min(zoom ?? 8.5, 10.5),
    pitch,
    bearing,
    padding,
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
  const flights = regionFlightsOf(map);
  flights.count++;
  for (const fn of [...flights.waiters]) fn();
}

const IDLE_MS = 20_000;
/** The orbit is an overview effect. From city zoom up it would keep the GPU streaming new tiles. */
export const ORBIT_MAX_ZOOM = 11;

/** Whether the idle orbit may turn the camera at this zoom. */
export const canOrbit = (zoom: number) => zoom < ORBIT_MAX_ZOOM;

// --- The idle orbit is a sway ----------------------------------------------------------------------
// A slow pendulum around the bearing the camera rests at, not a full turn: the province stays readable
// while a presenter talks, and the region names only have to hold over this arc (smoke-checked).

/** How far the sway swings either side of the resting bearing. */
export const SWAY_DEG = 12;
/** One swing there and back. At its fastest, through the middle, it turns about 2.1 degrees a second. */
export const SWAY_PERIOD_MS = 36_000;
/** A sway starts from rest and reaches full speed over this time, so it never starts with a jolt. */
const SWAY_EASE_MS = 4000;

export interface SwayState {
  /** The resting bearing it swings around. */
  center: number;
  /** Where in the swing it is, in radians. */
  phase: number;
  /** The bearing it last set. */
  bearing: number;
  /** Time since this run of the sway started, in ms. */
  elapsed: number;
  /** Outside its arc (the camera was turned away): it first glides back to the nearest end of the arc. */
  returning?: boolean;
}

/** a - b in degrees, wrapped to [-180, 180). */
const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

/** Below this zoom the camera is at the province view, where the sway always centres on its bearing. */
export const PROVINCE_SWAY_ZOOM = 7.5;
/** The fastest the sway turns, in degrees per ms (at the middle of the swing): about 2.1 degrees a second. */
const SWAY_TOP_SPEED = (2 * Math.PI * SWAY_DEG) / SWAY_PERIOD_MS;

/**
 * Where a sway starts once the page has been idle long enough.
 * - At the province view (`home` given): always around the province bearing, the arc the region names
 *   are swept on, even after "Hadapkan ke utara" or a drag turned the camera. From inside the arc it picks
 *   up where the bearing is; from outside it first glides back to the arc.
 * - Elsewhere: carrying on around the same resting bearing if nothing turned the camera since the last
 *   sway stopped, or else around the current bearing.
 */
export function swayFrom(previous: SwayState | null, bearing: number, home?: number): SwayState {
  if (home !== undefined) {
    if (previous && previous.center === home && Math.abs(angleDiff(bearing, previous.bearing)) < 0.01) return { ...previous, elapsed: 0 };
    const offset = angleDiff(bearing, home);
    if (Math.abs(offset) <= SWAY_DEG) return { center: home, phase: Math.asin(offset / SWAY_DEG), bearing, elapsed: 0 };
    return { center: home, phase: Math.sign(offset) * (Math.PI / 2), bearing, elapsed: 0, returning: true };
  }
  if (previous && Math.abs(angleDiff(bearing, previous.bearing)) < 0.01) return { ...previous, elapsed: 0 };
  return { center: bearing, phase: 0, bearing, elapsed: 0 };
}

/** The sway `dt` ms later: a sine around the resting bearing, easing in from rest. */
export function swayStep(s: SwayState, dt: number): SwayState {
  const elapsed = s.elapsed + dt;
  const x = Math.min(1, elapsed / SWAY_EASE_MS);
  const speed = x * x * (3 - 2 * x);
  if (s.returning) {
    // Glide toward the nearest end of the arc at the sway's own top speed, then swing on from there.
    const edge = s.center + Math.sign(Math.sin(s.phase)) * SWAY_DEG;
    const gap = angleDiff(edge, s.bearing);
    const move = SWAY_TOP_SPEED * dt * speed;
    if (Math.abs(gap) <= move) return { center: s.center, phase: s.phase, bearing: edge, elapsed };
    return { ...s, bearing: s.bearing + Math.sign(gap) * move, elapsed };
  }
  const phase = s.phase + ((2 * Math.PI * dt) / SWAY_PERIOD_MS) * speed;
  return { center: s.center, phase, bearing: s.center + SWAY_DEG * Math.sin(phase), elapsed };
}

let orbit: { stop: () => void } | null = null;

/**
 * After 20 s without input, sways the camera slowly around its resting bearing (see SWAY_DEG), at the
 * overview only (below zoom 11). Any input stops it where it is and restarts the 20 s wait. Call
 * `stopIdleOrbit()` to switch the behaviour off.
 */
export function startIdleOrbit(map: MapboxMap): void {
  stopIdleOrbit();
  if (prefersReducedMotion()) return;

  const canvas = map.getCanvasContainer();
  // Input anywhere on the page (map, panels, keyboard) counts; hovering only counts over the map.
  const pageInputs = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let last = 0;
  let sway: SwayState | null = null;
  /** The sway has to (re)start from wherever the camera is once it stands still. */
  let fresh = true;

  const swing = (now: number) => {
    // A camera move took the view to city zoom: stop until the next input re-arms the wait.
    if (!canOrbit(map.getZoom())) {
      frame = 0;
      last = 0;
      return;
    }
    if (map.isEasing()) {
      // Never fight a camera animation (fly to region, intro); start from wherever it lands.
      fresh = true;
    } else {
      if (fresh || !sway) {
        sway = swayFrom(sway, map.getBearing(), map.getZoom() < PROVINCE_SWAY_ZOOM ? KALTIM_VIEW.bearing : undefined);
        fresh = false;
        last = 0;
      }
      const dt = last ? Math.min(now - last, 64) : 16;
      sway = swayStep(sway, dt);
      map.setBearing(sway.bearing);
      // Remember the bearing as Mapbox holds it (wrapped), so the next start can tell nothing turned it.
      sway.bearing = map.getBearing();
    }
    last = now;
    frame = requestAnimationFrame(swing);
  };
  const arm = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!canOrbit(map.getZoom())) return;
      fresh = true;
      frame = requestAnimationFrame(swing);
    }, IDLE_MS);
  };

  for (const i of pageInputs) window.addEventListener(i, arm, { passive: true });
  canvas.addEventListener("pointermove", arm, { passive: true });
  arm();

  orbit = {
    stop: () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      for (const i of pageInputs) window.removeEventListener(i, arm);
      canvas.removeEventListener("pointermove", arm);
    },
  };
}

export function stopIdleOrbit(): void {
  orbit?.stop();
  orbit = null;
}
