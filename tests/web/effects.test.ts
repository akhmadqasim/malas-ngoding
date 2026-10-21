import { describe, expect, test } from "bun:test";
import { lightPresetFor, presetTone, RAIN_MIN_ZOOM, rainSpec, witaHour } from "../../src/web/map/effects.ts";

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
  test("only the day preset has a light ground", () => {
    expect(presetTone("day")).toBe("light");
    expect(presetTone("dawn")).toBe("dark");
    expect(presetTone("dusk")).toBe("dark");
    expect(presetTone("night")).toBe("dark");
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
  const spec = rainSpec({ color: "#a8adbc", vignetteColor: "#283040" });

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
