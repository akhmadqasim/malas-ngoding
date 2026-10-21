import type { Map as MapboxMap, RainSpecification } from "mapbox-gl";
import { token } from "../theme.ts";

export type LightPreset = "dawn" | "day" | "dusk" | "night";
/** "auto" follows WITA time; a preset pins the light (the Cahaya control, or `?cahaya=`). */
export type LightMode = "auto" | LightPreset;
/** Whether the ground under the data is light or dark. Ramps, outlines, dimming and rain follow it. */
export type Tone = "light" | "dark";

const PRESETS: readonly LightPreset[] = ["dawn", "day", "dusk", "night"];

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

/** `?cahaya=night` (or dawn, day, dusk) pins the light; anything else leaves it automatic. */
export function lightModeFromQuery(search: string): LightMode {
  const v = new URLSearchParams(search).get("cahaya");
  return PRESETS.includes(v as LightPreset) ? (v as LightPreset) : "auto";
}

/** The preset in effect: the pinned one, or the one for the time of day in WITA. */
export function resolvePreset(mode: LightMode, date: Date): LightPreset {
  return mode === "auto" ? lightPresetFor(date) : mode;
}

/**
 * Ground tone per preset, measured from the render: the land is near white at day and dawn, dark grey at
 * dusk and navy at night (values in docs/research/design/00-direction.md section 4).
 */
export function presetTone(preset: LightPreset): Tone {
  return preset === "day" || preset === "dawn" ? "light" : "dark";
}

/**
 * Standard basemap theme per preset. The neutral `monochrome` ground lets the data colours carry the
 * map and does not clash with the ink panels; at night the navy `faded` theme reads better, above all
 * at building zoom, where monochrome night turns the city black.
 */
export function basemapTheme(preset: LightPreset): "monochrome" | "faded" {
  return preset === "night" ? "faded" : "monochrome";
}

/** Sets the basemap light and theme for a preset. */
export function applyLightPreset(map: MapboxMap, preset: LightPreset): void {
  map.setConfigProperty("basemap", "lightPreset", preset);
  map.setConfigProperty("basemap", "theme", basemapTheme(preset));
}

/** Rain starts to show at this zoom, where Standard draws solid buildings, and is full at RAIN_FULL_ZOOM. */
export const RAIN_MIN_ZOOM = 15;
const RAIN_FULL_ZOOM = 16.5;

type ZoomRamp = ["interpolate", ["linear"], ["zoom"], number, number, number, number];
const zoomReveal = (value: number): ZoomRamp => ["interpolate", ["linear"], ["zoom"], RAIN_MIN_ZOOM, 0, RAIN_FULL_ZOOM, value];

/**
 * The rain look (docs/research/design/00-direction.md section 9): nothing below building zoom, then thin
 * streaks. The Mapbox example uses [2.6, 18.2] drops from zoom 11, which read as blobs over a city.
 */
export function rainSpec(colors: { color: string; vignetteColor: string }) {
  return {
    density: zoomReveal(0.9),
    intensity: 0.85,
    color: colors.color,
    opacity: 0.6,
    vignette: zoomReveal(0.35),
    "vignette-color": colors.vignetteColor,
    direction: [0, 80] as [number, number],
    "droplet-size": [1.1, 11] as [number, number],
    "distortion-strength": 0.3,
    // Keeps the middle of the screen, where the user clicks buildings, a little clearer.
    "center-thinning": 0.15,
  } satisfies RainSpecification;
}

/** Turns the (experimental) Mapbox rain effect on or off. */
export function setRainEffect(map: MapboxMap, on: boolean): void {
  if (!on) {
    map.setRain(undefined);
    return;
  }
  map.setRain(rainSpec({ color: token("--color-rain"), vignetteColor: token("--color-rain-vignette") }));
}
