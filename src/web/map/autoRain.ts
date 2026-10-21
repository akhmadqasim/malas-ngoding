import { api, type WeatherResponse } from "../api.ts";
import { type LiveRain, type RainMode, useAppStore } from "../store.ts";
import { RAIN_MIN_ZOOM } from "./effects.ts";

/*
 * Live rain (spec Goal 4): in the "auto" rain mode the map rains when the forecast says it rains at the
 * view centre now. The weather is checked at city zoom only (farther out the centre is not a place
 * anyone looks at, and rain shows from building zoom anyway), after big camera moves and every 10 minutes.
 */

/** Below this zoom the view centre is not a place, so the live rain is unknown (null). */
export const AUTO_RAIN_MIN_ZOOM = 12;
/** A move farther than this checks the weather again. Open-Meteo is cached on a 0.05° grid (about 5.5 km). */
export const BIG_MOVE_KM = 2;
/** The weather changes; check the same place again this often. */
export const RECHECK_MS = 10 * 60_000;
/** A stale forecast (Open-Meteo down, an old cached one) counts only if one of its hours is this close to now. */
export const STALE_GAP_MS = 2 * 60 * 60_000;

/** Forecast times are WITA (UTC+8, no daylight saving) without an offset. */
const witaMs = (time: string) => Date.parse(`${time}:00+08:00`);

/** Gap between `nowMs` and the nearest forecast hour, Infinity without hours. */
function nearestHourGapMs(hours: { time: string }[], nowMs: number): number {
  let best = Infinity;
  for (const h of hours) {
    const gap = Math.abs(witaMs(h.time) - nowMs);
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * Whether it rains now according to a forecast. The server reads `current` from the hour nearest to now;
 * for a stale forecast that hour can be days old, so then it only counts within 2 hours of now.
 */
export function liveRainFrom(w: Pick<WeatherResponse, "current" | "stale" | "hours">, nowMs: number): boolean {
  if (w.stale && !(nearestHourGapMs(w.hours, nowMs) <= STALE_GAP_MS)) return false;
  return w.current.raining;
}

type RainState = { rain: RainMode; liveRain: LiveRain | null };

/** Rain is drawn when switched on, or in auto mode while it really rains at the view centre. */
export function rainVisible({ rain, liveRain }: RainState): boolean {
  return rain === "on" || (rain === "auto" && liveRain?.raining === true);
}

/**
 * The mode the Hujan switch sets. On forces rain. Off returns to auto, unless it really rains here: then
 * auto would bring the rain straight back, so off stays off.
 */
export function nextRainMode(on: boolean, liveRaining: boolean): RainMode {
  if (on) return "on";
  return liveRaining ? "off" : "auto";
}

const FAR_OUT = "Terlihat saat peta diperbesar sampai tingkat gedung.";
const LIVE = "Sedang hujan di sini menurut prakiraan Open-Meteo.";

/** The quiet note under the Hujan switch, or null. */
export function rainNote(state: RainState, zoom: number): string | null {
  const farOut = zoom < RAIN_MIN_ZOOM;
  if (state.rain === "on") return farOut ? FAR_OUT : null;
  if (state.rain === "auto" && state.liveRain?.raining) return farOut ? `${LIVE} ${FAR_OUT}` : LIVE;
  return null;
}

/** Great-circle distance between two [lng, lat] points, in km. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** What a camera change means for the live rain: forget it, check the weather, or keep what we have. */
export function nextStep(lastAt: [number, number] | null, centre: [number, number], zoom: number): "clear" | "check" | "keep" {
  if (zoom < AUTO_RAIN_MIN_ZOOM) return "clear";
  if (!lastAt || distanceKm(lastAt, centre) > BIG_MOVE_KM) return "check";
  return "keep";
}

/** The part of a Mapbox map that auto rain uses. */
export interface AutoRainMap {
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  on(type: "moveend", fn: () => void): unknown;
  off(type: "moveend", fn: () => void): unknown;
}

interface Options {
  fetchWeather?: (lat: number, lng: number, kWp: number) => Promise<WeatherResponse>;
  now?: () => number;
  /** Runs `fn` every `ms`; returns a cancel function. */
  every?: (fn: () => void, ms: number) => () => void;
}

const everyDefault = (fn: () => void, ms: number) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

/**
 * Keeps `liveRain` in the store up to date for the view centre: now, after every big camera move and
 * every 10 minutes. It tracks the weather in every rain mode, so switching rain off knows whether it
 * really rains. Returns a stop function. Never throws and never leaves a promise unhandled.
 */
export function startAutoRain(map: AutoRainMap, { fetchWeather = api.weather, now = Date.now, every = everyDefault }: Options = {}): () => void {
  let lastAt: [number, number] | null = null;
  let seq = 0;
  let stopped = false;
  const store = useAppStore.getState;

  const check = (again: boolean) => {
    if (stopped) return;
    const c = map.getCenter();
    const centre: [number, number] = [c.lng, c.lat];
    let step = nextStep(lastAt, centre, map.getZoom());
    if (again && step === "keep") step = "check";
    if (step === "keep") return;
    seq++;
    if (step === "clear") {
      lastAt = null;
      if (store().liveRain) store().setLiveRain(null);
      return;
    }
    const id = seq;
    lastAt = centre;
    fetchWeather(centre[1], centre[0], 0).then(
      (w) => {
        if (!stopped && id === seq) store().setLiveRain({ raining: liveRainFrom(w, now()), at: centre });
      },
      () => {
        if (stopped || id !== seq) return;
        // Unknown, so no live rain; the next move tries again.
        lastAt = null;
        store().setLiveRain(null);
      },
    );
  };

  const onMove = () => check(false);
  map.on("moveend", onMove);
  const cancel = every(() => check(true), RECHECK_MS);
  check(false);

  return () => {
    stopped = true;
    map.off("moveend", onMove);
    cancel();
  };
}
