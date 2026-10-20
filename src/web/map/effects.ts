import type { Map as MapboxMap } from "mapbox-gl";

export type LightPreset = "dawn" | "day" | "dusk" | "night";

/** Kalimantan Timur uses WITA, a fixed UTC+8 with no daylight saving. */
const WITA_OFFSET_HOURS = 8;

/** Hour of day (0-23.99) in WITA for the given instant. */
export function witaHour(date: Date): number {
  const utc = date.getUTCHours() + date.getUTCMinutes() / 60;
  return (utc + WITA_OFFSET_HOURS) % 24;
}

/** Mapbox Standard light preset for the time of day in WITA. */
export function lightPresetFor(date: Date): LightPreset {
  const h = witaHour(date);
  if (h >= 5 && h < 7) return "dawn";
  if (h >= 7 && h < 17) return "day";
  if (h >= 17 && h < 19) return "dusk";
  return "night";
}

/** Sets the basemap light to match the real time of day in WITA and returns the preset used. */
export function applyLightPreset(map: MapboxMap, date: Date): LightPreset {
  const preset = lightPresetFor(date);
  map.setConfigProperty("basemap", "lightPreset", preset);
  return preset;
}

// Fades the rain in between zoom 11 and 13, as in the Mapbox rain example, so it never covers the regional view.
const zoomBasedReveal = (value: number): ["interpolate", ["linear"], ["zoom"], number, number, number, number] => [
  "interpolate",
  ["linear"],
  ["zoom"],
  11,
  0,
  13,
  value,
];

/** Turns the (experimental) Mapbox rain effect on or off. */
export function setRainEffect(map: MapboxMap, on: boolean): void {
  if (!on) {
    map.setRain(undefined);
    return;
  }
  map.setRain({
    density: zoomBasedReveal(0.5),
    intensity: 1,
    color: "#a8adbc",
    opacity: 0.7,
    vignette: zoomBasedReveal(1),
    "vignette-color": "#464646",
    direction: [0, 80],
    "droplet-size": [2.6, 18.2],
    "distortion-strength": 0.7,
    "center-thinning": 0,
  });
}
