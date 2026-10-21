import { beforeEach, describe, expect, test } from "bun:test";
import type { WeatherResponse } from "../../src/web/api.ts";
import {
  AUTO_RAIN_MIN_ZOOM,
  BIG_MOVE_KM,
  distanceKm,
  forecastIsCurrent,
  liveRainFrom,
  nextRainMode,
  nextStep,
  RECHECK_MS,
  rainNote,
  rainVisible,
  startAutoRain,
} from "../../src/web/map/autoRain.ts";
import { RAIN_MIN_ZOOM } from "../../src/web/map/effects.ts";
import { useAppStore } from "../../src/web/store.ts";

// Forecast times are WITA (UTC+8) without an offset, as Open-Meteo sends them.
const NOW = Date.parse("2026-10-21T14:20:00+08:00");
const hour = (time: string) => ({ time, ghiWm2: 300, cloudPct: 90, precipMm: 2, weatherCode: 61, pvKwh: 0.2 });
const weather = (over: Partial<WeatherResponse> & { raining?: boolean } = {}): WeatherResponse => ({
  hours: [hour("2026-10-21T14:00"), hour("2026-10-21T15:00")],
  days: [],
  current: { raining: over.raining ?? true, cloudPct: 90, precipMm: 2, isDay: true },
  stale: false,
  ...over,
});

describe("live rain from a forecast", () => {
  test("a fresh forecast is taken at its word", () => {
    expect(liveRainFrom(weather({ raining: true }), NOW)).toBe(true);
    expect(liveRainFrom(weather({ raining: false }), NOW)).toBe(false);
  });
  test("a stale forecast that still covers now is used", () => {
    expect(liveRainFrom(weather({ stale: true }), NOW)).toBe(true);
  });
  test("a stale forecast whose nearest hour is more than 2 h away is ignored (Task 5 carry-over)", () => {
    const old = weather({ stale: true, hours: [hour("2026-10-20T10:00"), hour("2026-10-21T12:00")] });
    // Nearest hour 12:00 is 2 h 20 min before now.
    expect(liveRainFrom(old, NOW)).toBe(false);
    // The same forecast, fresh, would still count (the server says it is current).
    expect(liveRainFrom({ ...old, stale: false }, NOW)).toBe(true);
  });
  test("a stale forecast exactly 2 h away still counts", () => {
    expect(liveRainFrom(weather({ stale: true, hours: [hour("2026-10-21T12:20")] }), NOW)).toBe(true);
  });
  test("no hours at all is not rain", () => {
    expect(liveRainFrom(weather({ stale: true, hours: [] }), NOW)).toBe(false);
  });
});

describe("is the forecast about now?", () => {
  test("a fresh forecast always is; a stale one only within 2 h of one of its hours", () => {
    expect(forecastIsCurrent(weather({ hours: [hour("2026-10-20T10:00")] }), NOW)).toBe(true);
    expect(forecastIsCurrent(weather({ stale: true }), NOW)).toBe(true);
    expect(forecastIsCurrent(weather({ stale: true, hours: [hour("2026-10-21T12:00")] }), NOW)).toBe(false);
    expect(forecastIsCurrent(weather({ stale: true, hours: [] }), NOW)).toBe(false);
  });
});

describe("rain mode and the Hujan switch", () => {
  test("rain shows when switched on, or in auto mode while it rains at the view centre", () => {
    const at: [number, number] = [117.15, -0.5];
    expect(rainVisible({ rain: "on", liveRain: null })).toBe(true);
    expect(rainVisible({ rain: "auto", liveRain: null })).toBe(false);
    expect(rainVisible({ rain: "auto", liveRain: { raining: true, at } })).toBe(true);
    expect(rainVisible({ rain: "auto", liveRain: { raining: false, at } })).toBe(false);
    expect(rainVisible({ rain: "off", liveRain: { raining: true, at } })).toBe(false);
  });
  test("switching on forces rain; switching off goes back to auto, or to off while it really rains", () => {
    expect(nextRainMode(true, false)).toBe("on");
    expect(nextRainMode(true, true)).toBe("on");
    expect(nextRainMode(false, false)).toBe("auto");
    expect(nextRainMode(false, true)).toBe("off");
  });
  test("the note under the switch", () => {
    const wet = { raining: true, at: [117.15, -0.5] as [number, number] };
    expect(rainNote({ rain: "on", liveRain: null }, RAIN_MIN_ZOOM - 1)).toBe("Terlihat saat peta diperbesar sampai tingkat gedung.");
    expect(rainNote({ rain: "on", liveRain: null }, RAIN_MIN_ZOOM)).toBeNull();
    expect(rainNote({ rain: "auto", liveRain: null }, 16)).toBeNull();
    expect(rainNote({ rain: "auto", liveRain: wet }, 16)).toBe("Sedang hujan di sini menurut prakiraan Open-Meteo.");
    expect(rainNote({ rain: "auto", liveRain: wet }, 13)).toBe(
      "Sedang hujan di sini menurut prakiraan Open-Meteo. Terlihat saat peta diperbesar sampai tingkat gedung.",
    );
    expect(rainNote({ rain: "off", liveRain: wet }, 16)).toBe("Efek hujan mati sampai hujan di sini reda.");
    expect(rainNote({ rain: "off", liveRain: { ...wet, raining: false } }, 16)).toBeNull();
  });
});

describe("when to check the weather", () => {
  const samarinda: [number, number] = [117.1475, -0.4955];
  test("distanceKm is the great-circle distance", () => {
    // 0.01 degree of latitude is about 1.11 km.
    expect(distanceKm([117, -0.5], [117, -0.49])).toBeCloseTo(1.112, 2);
    expect(distanceKm(samarinda, samarinda)).toBe(0);
  });
  test("farther out than city zoom the live rain is cleared", () => {
    expect(nextStep(samarinda, samarinda, AUTO_RAIN_MIN_ZOOM - 0.1)).toBe("clear");
    expect(nextStep(null, samarinda, 5)).toBe("clear");
  });
  test("at city zoom: check the first time and after a big move, not after a small one", () => {
    expect(nextStep(null, samarinda, AUTO_RAIN_MIN_ZOOM)).toBe("check");
    const near: [number, number] = [samarinda[0] + 0.01, samarinda[1]];
    const far: [number, number] = [samarinda[0] + 0.05, samarinda[1]];
    expect(distanceKm(samarinda, near)).toBeLessThan(BIG_MOVE_KM);
    expect(distanceKm(samarinda, far)).toBeGreaterThan(BIG_MOVE_KM);
    expect(nextStep(samarinda, near, 16)).toBe("keep");
    expect(nextStep(samarinda, far, 16)).toBe("check");
  });
});

/** A map that only knows its camera and the `moveend` listeners. */
function fakeMap(center: [number, number], zoom: number) {
  const listeners = new Set<() => void>();
  return {
    center,
    zoom,
    listeners,
    getCenter() {
      return { lng: this.center[0], lat: this.center[1] };
    },
    getZoom() {
      return this.zoom;
    },
    on(_type: "moveend", fn: () => void) {
      listeners.add(fn);
    },
    off(_type: "moveend", fn: () => void) {
      listeners.delete(fn);
    },
    moveTo(c: [number, number], z: number) {
      this.center = c;
      this.zoom = z;
      for (const fn of listeners) fn();
    },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("startAutoRain", () => {
  beforeEach(() => useAppStore.setState({ liveRain: null, rain: "auto" }));

  test("checks the view centre at city zoom and stores the result", async () => {
    const calls: [number, number, number][] = [];
    const map = fakeMap([117.1475, -0.4955], 16);
    const stop = startAutoRain(map, {
      fetchWeather: async (lat, lng, kWp) => {
        calls.push([lat, lng, kWp]);
        return weather({ raining: true });
      },
      now: () => NOW,
    });
    await flush();
    expect(calls).toEqual([[-0.4955, 117.1475, 0]]);
    expect(useAppStore.getState().liveRain).toEqual({ raining: true, at: [117.1475, -0.4955] });
    stop();
    expect(map.listeners.size).toBe(0);
  });

  test("a small move does not refetch, a big move does, zooming out clears", async () => {
    let n = 0;
    const map = fakeMap([117.1475, -0.4955], 16);
    const stop = startAutoRain(map, {
      fetchWeather: async () => {
        n++;
        return weather({ raining: n === 1 });
      },
      now: () => NOW,
    });
    await flush();
    map.moveTo([117.15, -0.4955], 16.2);
    await flush();
    expect(n).toBe(1);
    map.moveTo([116.85, -1.24], 15); // Balikpapan
    await flush();
    expect(n).toBe(2);
    expect(useAppStore.getState().liveRain?.raining).toBe(false);
    map.moveTo([116.85, -1.24], 8);
    expect(useAppStore.getState().liveRain).toBeNull();
    stop();
  });

  test("an answer that arrives after a newer move is dropped", async () => {
    const pending: ((w: WeatherResponse) => void)[] = [];
    const map = fakeMap([117.1475, -0.4955], 16);
    const stop = startAutoRain(map, {
      fetchWeather: () => new Promise<WeatherResponse>((resolve) => pending.push(resolve)),
      now: () => NOW,
    });
    map.moveTo([116.85, -1.24], 16);
    pending[1]!(weather({ raining: false }));
    await flush();
    pending[0]!(weather({ raining: true }));
    await flush();
    expect(useAppStore.getState().liveRain).toEqual({ raining: false, at: [116.85, -1.24] });
    stop();
  });

  test("a failed forecast leaves the live rain unknown and retries on the next move", async () => {
    let fail = true;
    let n = 0;
    const map = fakeMap([117.1475, -0.4955], 16);
    const stop = startAutoRain(map, {
      fetchWeather: async () => {
        n++;
        if (fail) throw new Error("503");
        return weather({ raining: true });
      },
      now: () => NOW,
    });
    await flush();
    expect(useAppStore.getState().liveRain).toBeNull();
    fail = false;
    map.moveTo([117.148, -0.4955], 16); // a small move, but the last check failed
    await flush();
    expect(n).toBe(2);
    expect(useAppStore.getState().liveRain?.raining).toBe(true);
    stop();
  });

  test("off means off for this shower: a dry check brings auto back, a wet one keeps it off", async () => {
    let wet = true;
    const map = fakeMap([117.1475, -0.4955], 16);
    useAppStore.setState({ rain: "off" });
    const stop = startAutoRain(map, { fetchWeather: async () => weather({ raining: wet }), now: () => NOW });
    await flush();
    expect(useAppStore.getState().rain).toBe("off");
    wet = false;
    map.moveTo([116.85, -1.24], 16);
    await flush();
    expect(useAppStore.getState().rain).toBe("auto");
    stop();
  });

  test("a dry check leaves a rain switched on alone", async () => {
    const map = fakeMap([117.1475, -0.4955], 16);
    useAppStore.setState({ rain: "on" });
    const stop = startAutoRain(map, { fetchWeather: async () => weather({ raining: false }), now: () => NOW });
    await flush();
    expect(useAppStore.getState().rain).toBe("on");
    stop();
  });

  test("checks again every 10 minutes, and not after stop", async () => {
    let n = 0;
    const timers: (() => void)[] = [];
    const map = fakeMap([117.1475, -0.4955], 16);
    const stop = startAutoRain(map, {
      fetchWeather: async () => {
        n++;
        return weather();
      },
      now: () => NOW,
      every: (fn, ms) => {
        expect(ms).toBe(RECHECK_MS);
        timers.push(fn);
        return () => timers.splice(timers.indexOf(fn), 1);
      },
    });
    await flush();
    timers[0]!();
    await flush();
    expect(n).toBe(2);
    stop();
    expect(timers.length).toBe(0);
  });
});
