import type { LngLatBoundsLike, Map as MapboxMap } from "mapbox-gl";

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

export interface FlyOptions {
  /** The region's bounding box; when given, the zoom is chosen so the region fills the view. */
  bounds?: LngLatBoundsLike;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  /** Screen padding so the region is framed beside the side panels. */
  padding?: { top: number; bottom: number; left: number; right: number };
}

/** Smooth camera move centred on a region. */
export function flyToRegion(map: MapboxMap, centroid: [number, number], opts: FlyOptions = {}): void {
  const pitch = opts.pitch ?? 58;
  const padding = opts.padding ?? { top: 80, bottom: 80, left: 420, right: 80 };
  let zoom = opts.zoom;
  if (zoom === undefined && opts.bounds) {
    zoom = map.cameraForBounds(opts.bounds, { padding, pitch })?.zoom;
  }
  map.flyTo({
    center: centroid,
    zoom: Math.min(zoom ?? 8.5, 10.5),
    pitch,
    bearing: opts.bearing ?? map.getBearing(),
    padding,
    duration: prefersReducedMotion() ? 0 : FLY_MS,
    curve: 1.2,
    essential: true,
  });
}

const IDLE_MS = 20_000;
const DEG_PER_SECOND = 2.2;

let orbit: { stop: () => void } | null = null;

/**
 * After 20 s without input, slowly turns the camera around the view centre. Any input stops the turn
 * and restarts the 20 s wait. Call `stopIdleOrbit()` to switch the behaviour off.
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

  const spin = (now: number) => {
    // Never fight a camera animation (fly to region, intro): wait for it to finish.
    if (!map.isEasing()) {
      const dt = last ? Math.min(now - last, 64) : 16;
      map.setBearing(map.getBearing() + (DEG_PER_SECOND * dt) / 1000);
    }
    last = now;
    frame = requestAnimationFrame(spin);
  };
  const arm = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    clearTimeout(timer);
    timer = setTimeout(() => (frame = requestAnimationFrame(spin)), IDLE_MS);
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
