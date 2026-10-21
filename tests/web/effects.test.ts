import { describe, expect, test } from "bun:test";
import {
  basemapTheme,
  lightModeFromQuery,
  lightPresetFor,
  overcastOpacity,
  presetTone,
  RAIN_MIN_ZOOM,
  rainSpec,
  resolvePreset,
  witaHour,
} from "../../src/web/map/effects.ts";

// WITA is UTC+8, so 05:00 WITA is 21:00 UTC the day before.
const wita = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 21, hh - 8, mm));

describe("light preset follows WITA time", () => {
  test("witaHour converts from UTC", () => {
    expect(witaHour(new Date(Date.UTC(2026, 9, 21, 0, 30)))).toBe(8.5);
    expect(witaHour(new Date(Date.UTC(2026, 9, 21, 20, 0)))).toBe(4);
  });
  test("dawn 05-07, day 07-17, dusk 17-19, night otherwise", () => {
    expect(lightPresetFor(wita(4, 59))).toBe("night");
    expect(lightPresetFor(wita(5))).toBe("dawn");
    expect(lightPresetFor(wita(6, 59))).toBe("dawn");
    expect(lightPresetFor(wita(7))).toBe("day");
    expect(lightPresetFor(wita(16, 59))).toBe("day");
    expect(lightPresetFor(wita(17))).toBe("dusk");
    expect(lightPresetFor(wita(19))).toBe("night");
    expect(lightPresetFor(wita(23, 30))).toBe("night");
  });
  test("day and dawn have a light ground, dusk and night a dark one (measured from the render)", () => {
    expect(presetTone("day")).toBe("light");
    expect(presetTone("dawn")).toBe("light");
    expect(presetTone("dusk")).toBe("dark");
    expect(presetTone("night")).toBe("dark");
  });
  test("the basemap is neutral except at night, where the navy faded theme stays", () => {
    expect(basemapTheme("day")).toBe("monochrome");
    expect(basemapTheme("dawn")).toBe("monochrome");
    expect(basemapTheme("dusk")).toBe("monochrome");
    expect(basemapTheme("night")).toBe("faded");
  });
});

describe("light mode (the Cahaya control and ?cahaya=)", () => {
  test("the query parameter pins a preset; anything else means automatic", () => {
    expect(lightModeFromQuery("?cahaya=night")).toBe("night");
    expect(lightModeFromQuery("?x=1&cahaya=dawn")).toBe("dawn");
    expect(lightModeFromQuery("?cahaya=pagi")).toBe("auto");
    expect(lightModeFromQuery("")).toBe("auto");
  });
  test("automatic follows WITA time; a pin wins", () => {
    expect(resolvePreset("auto", wita(12))).toBe("day");
    expect(resolvePreset("auto", wita(22))).toBe("night");
    expect(resolvePreset("night", wita(12))).toBe("night");
    expect(resolvePreset("day", wita(22))).toBe("day");
  });
});

/** Evaluates the `["interpolate", ["linear"], ["zoom"], z0, v0, z1, v1]` ramps that rainSpec uses. */
function atZoom(value: unknown, zoom: number): number {
  if (typeof value === "number") return value;
  const [op, , input, z0, v0, z1, v1] = value as [string, unknown, unknown, number, number, number, number];
  expect(op).toBe("interpolate");
  expect(input).toEqual(["zoom"]);
  if (zoom <= z0) return v0;
  if (zoom >= z1) return v1;
  return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
}

describe("rain only shows at building zoom", () => {
  const spec = rainSpec("dark", { color: "#a8adbc", vignetteColor: "#283040" });

  test("no rain at the province, region or city view", () => {
    for (const zoom of [2, 6.5, 9, 12, 14, 14.99]) {
      expect(atZoom(spec.density, zoom)).toBe(0);
      expect(atZoom(spec.vignette, zoom)).toBe(0);
    }
    expect(RAIN_MIN_ZOOM).toBe(15);
  });

  test("rain is visible once the buildings are close", () => {
    expect(atZoom(spec.density, 16.5)).toBeGreaterThan(0.3);
    expect(atZoom(spec.density, 18)).toBe(atZoom(spec.density, 16.5));
  });

  test("drops are thin streaks, far smaller than the Mapbox example's [2.6, 18.2]", () => {
    const [across, along] = spec["droplet-size"];
    expect(across).toBeLessThanOrEqual(1.2);
    expect(along).toBeLessThanOrEqual(12);
    expect(spec["center-thinning"]).toBeGreaterThan(0);
    expect(spec["distortion-strength"]).toBeLessThanOrEqual(0.4);
  });

  test("colours come from the caller (design tokens), not from literals", () => {
    expect(spec.color).toBe("#a8adbc");
    expect(spec["vignette-color"]).toBe("#283040");
  });
});

describe("rain on a light ground (day, dawn)", () => {
  const light = rainSpec("light", { color: "#4a5262", vignetteColor: "#283040" });
  test("still nothing below building zoom", () => {
    expect(atZoom(light.density, 14.9)).toBe(0);
    expect(atZoom(light.vignette, 14.9)).toBe(0);
  });
  test("darker, more opaque drops that read on pale buildings, still thin", () => {
    expect(light.color).toBe("#4a5262");
    expect(light.opacity).toBeGreaterThanOrEqual(0.7);
    expect(light["droplet-size"]).toEqual([1.2, 12]);
    expect(light["distortion-strength"]).toBe(0.5);
  });
});

describe("overcast tint while it rains", () => {
  test("none without rain or above building zoom", () => {
    expect(overcastOpacity(false, "light", 17)).toBe(0);
    expect(overcastOpacity(true, "light", 14)).toBe(0);
  });
  test("fades in with the rain between zoom 15 and 16.5, stronger on a light ground", () => {
    expect(overcastOpacity(true, "light", 16.5)).toBeCloseTo(0.24);
    expect(overcastOpacity(true, "light", 18)).toBeCloseTo(0.24);
    expect(overcastOpacity(true, "dark", 15.75)).toBeCloseTo(0.06);
  });
});
