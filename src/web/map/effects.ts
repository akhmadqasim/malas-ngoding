import type { FogSpecification, Map as MapboxMap, RainSpecification } from "mapbox-gl";
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
export const RAIN_FULL_ZOOM = 16.5;

type ZoomRamp = ["interpolate", ["linear"], ["zoom"], number, number, number, number];
const zoomReveal = (value: number): ZoomRamp => ["interpolate", ["linear"], ["zoom"], RAIN_MIN_ZOOM, 0, RAIN_FULL_ZOOM, value];

/**
 * The rain look (docs/research/design/00-direction.md section 9): nothing below building zoom, then thin
 * light streaks. Real rain shows as light streaks against a dim sky; dark drops on pale buildings read as
 * needles. By day the dim background comes from the rain haze (`rainFog`), drawn inside the map. The
 * Mapbox example uses [2.6, 18.2] drops from zoom 11, which read as blobs.
 */
export function rainSpec(tone: Tone, colors: { color: string; vignetteColor: string }) {
  const light = tone === "light";
  return {
    density: zoomReveal(light ? 1 : 0.9),
    intensity: 0.85,
    color: colors.color,
    opacity: light ? 0.72 : 0.6,
    vignette: zoomReveal(light ? 0.3 : 0.35),
    "vignette-color": colors.vignetteColor,
    direction: [0, 80] as [number, number],
    "droplet-size": (light ? [1, 12] : [1.1, 11]) as [number, number],
    "distortion-strength": light ? 0.35 : 0.3,
    // Keeps the middle of the screen, where the user clicks buildings, a little clearer.
    "center-thinning": 0.15,
  } satisfies RainSpecification;
}

/** The rain haze at full rain: fog closing in from just behind the camera, and how it meets the sky. */
const RAIN_FOG = { range: [-1, 2.5] as [number, number], horizonBlend: 0.25 };

type FogValue = FogSpecification[keyof FogSpecification];

/**
 * A basemap fog value carried up to building zoom and then faded into the rain value between
 * RAIN_MIN_ZOOM and RAIN_FULL_ZOOM. Basemap zoom stops beyond RAIN_MIN_ZOOM are dropped; a plain value
 * becomes the start of the fade.
 */
function spliceAtRainZoom(base: FogValue | undefined, rain: unknown): unknown {
  if (base === undefined || base === null) return rain;
  const isZoomCurve =
    Array.isArray(base) && base[0] === "interpolate" && Array.isArray(base[2]) && (base[2] as unknown[])[0] === "zoom";
  if (!isZoomCurve) return ["interpolate", ["linear"], ["zoom"], RAIN_MIN_ZOOM, base, RAIN_FULL_ZOOM, rain];
  const [, kind, input, ...stops] = base as unknown[];
  const kept: unknown[] = [];
  let atRain: unknown = stops[1];
  for (let i = 0; i + 1 < stops.length; i += 2) {
    const zoom = stops[i] as number;
    if (zoom > RAIN_MIN_ZOOM) break;
    atRain = stops[i + 1];
    if (zoom < RAIN_MIN_ZOOM) kept.push(zoom, atRain);
  }
  return ["interpolate", kind, input, ...kept, RAIN_MIN_ZOOM, atRain, RAIN_FULL_ZOOM, rain];
}

/**
 * The basemap's fog with a rain haze spliced in at building zoom: below zoom 15 nothing changes (the
 * globe and the province view keep their atmosphere), from 15 to 16.5 a slate haze closes in, so the
 * light drops of `rainSpec` show against it like rain against an overcast sky.
 */
export function rainFog(base: FogSpecification | null, colors: { color: string; highColor: string }): FogSpecification {
  const from = base ?? {};
  const splice = (key: keyof FogSpecification, rain: unknown) => spliceAtRainZoom(from[key], rain);
  return {
    ...from,
    color: splice("color", colors.color),
    "high-color": splice("high-color", colors.highColor),
    range: splice("range", base ? ["literal", RAIN_FOG.range] : RAIN_FOG.range),
    "horizon-blend": splice("horizon-blend", RAIN_FOG.horizonBlend),
  } as FogSpecification;
}

/** Maps whose fog currently carries the rain haze. */
const hazed = new WeakSet<MapboxMap>();

/**
 * Turns the (experimental) Mapbox rain effect on or off, styled for the ground tone. On a light ground it
 * also sets the rain haze; `baseFog` (the basemap's fog, captured before any change) is put back after.
 */
export function setRainEffect(map: MapboxMap, on: boolean, tone: Tone, baseFog: FogSpecification | null): void {
  const light = tone === "light";
  if (on && light) {
    map.setFog(rainFog(baseFog, { color: token("--color-rain-haze"), highColor: token("--color-rain-haze-high") }));
    hazed.add(map);
  } else if (hazed.has(map)) {
    // `setFog(null)` would leave no fog at all, not the basemap's: put the captured one back.
    map.setFog(baseFog);
    hazed.delete(map);
  }
  if (!on) {
    map.setRain(undefined);
    return;
  }
  map.setRain(
    rainSpec(tone, {
      color: token(light ? "--color-rain-day" : "--color-rain"),
      vignetteColor: token("--color-rain-vignette"),
    }),
  );
}

/** Strength of the overcast tint at full rain, per ground tone. By day the rain haze does most of it. */
export const OVERCAST_OPACITY: Record<Tone, number> = { light: 0.1, dark: 0.12 };

/** Opacity of the overcast tint: none without rain, then it fades in with the rain from zoom 15 to 16.5. */
export function overcastOpacity(rainOn: boolean, tone: Tone, zoom: number): number {
  if (!rainOn) return 0;
  const t = Math.min(1, Math.max(0, (zoom - RAIN_MIN_ZOOM) / (RAIN_FULL_ZOOM - RAIN_MIN_ZOOM)));
  return OVERCAST_OPACITY[tone] * t;
}
