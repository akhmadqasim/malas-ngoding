import type { Metric } from "./store.ts";

/*
 * Design tokens live in one place: the `@theme static` block in styles.css (see
 * docs/research/design/00-direction.md). Map paint and canvas drawing cannot use CSS variables, so
 * they read the computed values here instead of typing a second copy of each colour.
 */

const cache = new Map<string, string>();

/** The value of a CSS custom property on :root, for example `token("--color-paper")`. Throws if missing. */
export function token(name: `--${string}`): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Design token ${name} is missing from styles.css`);
  cache.set(name, value);
  return value;
}

/** Forgets cached token values (tests swap the stylesheet between cases). */
export function clearTokenCache(): void {
  cache.clear();
}

export const RAMP_STEPS = 6;

/** The six stops of a metric's colour ramp, low to high. */
export function rampTokens(metric: Metric): string[] {
  return Array.from({ length: RAMP_STEPS }, (_, i) => token(`--color-${metric}-${i + 1}`));
}

const channels = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Colour at `t` (0..1) along evenly spaced hex stops, mixed per channel like Mapbox's linear
 * `interpolate`, so a list bar matches its column on the map.
 */
export function mixRamp(stops: readonly string[], t: number): string {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const pos = x * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const a = channels(stops[i]!);
  const b = channels(stops[i + 1]!);
  return `#${a.map((v, k) => Math.round(v + (b[k]! - v) * f).toString(16).padStart(2, "0")).join("")}`;
}
