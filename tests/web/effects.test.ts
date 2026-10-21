import { describe, expect, test } from "bun:test";
import type { FogSpecification } from "mapbox-gl";
import { clearTokenCache } from "../../src/web/theme.ts";
import {
  basemapLight,
  BASEMAP_THEME,
  LIGHT_NOTE,
  type LightMode,
  lightModeFor,
  lightModeFromQuery,
  lightOption,
  lightPresetFor,
  overcastOpacity,
  presetTone,
  RAIN_HAZE_RANGE,
  RAIN_MIN_ZOOM,
  rainFog,
  rainSpec,
  resolvePreset,
  setRainEffect,
  witaHour,
} from "../../src/web/map/effects.ts";
import { expressionErrors, styleSpec } from "./styleSpec.ts";

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
  test("the basemap is Standard's own look, lightly muted, in every light", () => {
    expect(BASEMAP_THEME).toBe("faded");
  });
  test("dawn and dusk use Standard's day and night light, never its warm tan wash", () => {
    expect(basemapLight("day")).toBe("day");
    expect(basemapLight("dawn")).toBe("day");
    expect(basemapLight("dusk")).toBe("night");
    expect(basemapLight("night")).toBe("night");
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

describe("the Cahaya switch always shows one choice", () => {
  const modes: LightMode[] = ["auto", "dawn", "day", "dusk", "night"];

  test("dawn and dusk have no button: a link that pins one shows as Otomatis", () => {
    expect(lightOption("dawn")).toBe("auto");
    expect(lightOption("dusk")).toBe("auto");
    expect(lightOption("auto")).toBe("auto");
    expect(lightOption("day")).toBe("day");
    expect(lightOption("night")).toBe("night");
  });

  test("pressing the option already shown never changes the light, whatever the link asked for", () => {
    for (const linked of modes) expect(lightModeFor(lightOption(linked), linked)).toBe(linked);
  });

  test("Otomatis goes back to the clock, or to the dawn or dusk of the link", () => {
    expect(lightModeFor("auto", "auto")).toBe("auto");
    expect(lightModeFor("auto", "night")).toBe("auto");
    expect(lightModeFor("auto", "dusk")).toBe("dusk");
    expect(lightModeFor("day", "dusk")).toBe("day");
  });

  test("the legend names the light when no button does", () => {
    expect(LIGHT_NOTE.dawn).toBe("fajar");
    expect(LIGHT_NOTE.dusk).toBe("senja");
    expect(LIGHT_NOTE.day).toBeUndefined();
    expect(LIGHT_NOTE.night).toBeUndefined();
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
    expect(across).toBeLessThanOrEqual(1.5);
    expect(along).toBeLessThanOrEqual(14);
    expect(spec["center-thinning"]).toBeGreaterThan(0);
  });

  test("at night the streaks are bright and crisp, not faint glassy smears (no refraction)", () => {
    expect(spec.opacity).toBeGreaterThanOrEqual(0.9);
    expect(spec["distortion-strength"]).toBe(0);
    expect(atZoom(spec.density, 16.5)).toBe(1);
  });

  test("colours come from the caller (design tokens), not from literals", () => {
    expect(spec.color).toBe("#a8adbc");
    expect(spec["vignette-color"]).toBe("#283040");
  });
});

describe("rain on a light ground (day, dawn)", () => {
  const light = rainSpec("light", { color: "#e2e5ea", vignetteColor: "#283040" });
  test("still nothing below building zoom", () => {
    expect(atZoom(light.density, 14.9)).toBe(0);
    expect(atZoom(light.vignette, 14.9)).toBe(0);
  });
  test("light streaks, like real rain against an overcast sky (dark drops read as needles)", () => {
    expect(light.color).toBe("#e2e5ea");
    // Full strength: on the pale city a softer streak disappears.
    expect(light.opacity).toBe(1);
    // One streak shape in every light.
    expect(light["droplet-size"]).toEqual(rainSpec("dark", { color: "#e2e5ea", vignetteColor: "#283040" })["droplet-size"]);
    expect(light["distortion-strength"]).toBe(0);
    expect(atZoom(light.density, 16.5)).toBe(1);
  });
});

describe("rain haze: the overcast drawn inside the map, so light drops show against it", () => {
  const colors = { color: "#5f6874", highColor: "#4a525e" };
  const base = {
    color: ["interpolate", ["exponential", 1.2], ["zoom"], 5, "A5", 7, "A7"],
    "high-color": "#ffffff",
    range: ["interpolate", ["linear"], ["zoom"], 13, ["literal", [1, 10]], 15, ["literal", [1, 4]], 22, ["literal", [14, 20]]],
    "horizon-blend": ["interpolate", ["exponential", 1.2], ["zoom"], 5, 0.01, 7, 0.1],
    "space-color": "#000000",
    "star-intensity": 0.2,
  };
  const fog = rainFog(base as unknown as FogSpecification, colors);

  test("below building zoom the basemap's own fog is untouched", () => {
    expect(fog.color).toEqual(["interpolate", ["exponential", 1.2], ["zoom"], 5, "A5", 7, "A7", 15, "A7", 16.5, "#5f6874"]);
    expect(fog["space-color"]).toBe("#000000");
    expect(fog["star-intensity"]).toBe(0.2);
  });

  test("the haze closes in from zoom 15 to 16.5; later basemap stops are dropped", () => {
    expect(fog.range).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      13,
      ["literal", [1, 10]],
      15,
      ["literal", [1, 4]],
      16.5,
      ["literal", RAIN_HAZE_RANGE],
    ]);
  });

  test("the haze dims the city without swallowing it: thin at the centre, never solid within the view", () => {
    // Mapbox fog opacity at a depth (0 = the map centre, 1 = one camera-to-centre distance further):
    // (1 - e^(-6r))^3 with r the share of `range` (fog_helpers.ts, GL JS 3.33).
    const opacityAt = (depth: number) => {
      const [start, end] = RAIN_HAZE_RANGE;
      const r = Math.max(0, (depth - start) / (end - start));
      return Math.min(1, 1.00747 * (1 - Math.exp(-6 * r)) ** 3);
    };
    expect(opacityAt(0)).toBeLessThan(0.45);
    expect(opacityAt(2)).toBeLessThan(0.8);
    expect(opacityAt(0)).toBeGreaterThan(0.2);
  });

  test("a plain basemap value fades into the rain value", () => {
    expect(fog["high-color"]).toEqual(["interpolate", ["linear"], ["zoom"], 15, "#ffffff", 16.5, "#4a525e"]);
    expect(fog["horizon-blend"]).toEqual(["interpolate", ["exponential", 1.2], ["zoom"], 5, 0.01, 7, 0.1, 15, 0.1, 16.5, 0.2]);
  });

  test("without a basemap fog the rain values apply as they are", () => {
    const bare = rainFog(null, colors);
    expect(bare.color).toBe("#5f6874");
    expect(bare.range).toEqual(RAIN_HAZE_RANGE);
  });

  test("a plain array from the basemap goes into the fade as a literal, the form every Mapbox version reads", () => {
    const plain = rainFog({ range: [0.5, 10], color: "#ffffff" } as FogSpecification, colors);
    expect(plain.range).toEqual(["interpolate", ["linear"], ["zoom"], 15, ["literal", [0.5, 10]], 16.5, ["literal", RAIN_HAZE_RANGE]]);
    // The same inside a zoom curve whose stops are bare arrays.
    const curve = rainFog({ range: ["interpolate", ["linear"], ["zoom"], 13, [1, 10], 15, [1, 4]] } as unknown as FogSpecification, colors);
    expect(curve.range).toEqual(["interpolate", ["linear"], ["zoom"], 13, ["literal", [1, 10]], 15, ["literal", [1, 4]], 16.5, ["literal", RAIN_HAZE_RANGE]]);
  });

  test("Mapbox accepts the hazed fog: every spliced property parses, and the fog validates", () => {
    // The fog of the Standard style as the app captures it (map.getFog(), Mapbox GL 3.33, day light).
    const standard = {
      "vertical-range": [30, 120],
      range: ["interpolate", ["linear"], ["zoom"], 13, ["literal", [1, 10]], 15, ["literal", [1, 4]], 22, ["literal", [14, 20]]],
      color: ["interpolate", ["exponential", 1.2], ["zoom"], 5, ["interpolate", ["linear"], ["measure-light", "brightness"], 0.1, "hsla(0, 0%, 20%, 1)", 0.4, "hsla(0, 0%, 100%, 1)"], 7, "hsla(200, 60%, 98%, 0.9)"],
      "high-color": ["interpolate", ["exponential", 1.2], ["zoom"], 5, "hsla(215, 100%, 20%, 1)", 7, "hsla(0, 0%, 100%, 1)"],
      "space-color": ["interpolate", ["exponential", 1.2], ["zoom"], 5, "hsl(0, 0%, 0%)", 7, "hsl(210, 40%, 30%)"],
      "horizon-blend": ["interpolate", ["exponential", 1.2], ["zoom"], 5, 0.01, 7, ["interpolate", ["exponential", 1.2], ["measure-light", "brightness"], 0.35, 0.03, 0.4, 0.1]],
      "star-intensity": ["interpolate", ["exponential", 1.2], ["zoom"], 5, 0.4, 7, 0],
    };
    for (const base of [standard, { range: [0.5, 10], color: "#ffffff", "horizon-blend": 0.1 }]) {
      const fog = rainFog(base as unknown as FogSpecification, colors) as Record<string, unknown>;
      for (const key of ["color", "high-color", "range", "horizon-blend"]) {
        expect(expressionErrors(fog[key], (styleSpec.latest.fog as Record<string, unknown>)[key])).toEqual([]);
      }
      const errors = styleSpec.validate({ version: 8, sources: {}, layers: [], fog } as unknown as Parameters<typeof styleSpec.validate>[0]);
      expect(errors.map((e) => e.message)).toEqual([]);
    }
  });
});

describe("overcast tint while it rains", () => {
  test("none without rain or above building zoom", () => {
    expect(overcastOpacity(false, "light", 17)).toBe(0);
    expect(overcastOpacity(true, "light", 14)).toBe(0);
  });
  test("fades in with the rain between zoom 15 and 16.5 (the haze carries the daytime gloom)", () => {
    expect(overcastOpacity(true, "light", 16.5)).toBeCloseTo(0.1);
    expect(overcastOpacity(true, "light", 18)).toBeCloseTo(0.1);
    expect(overcastOpacity(true, "dark", 15.75)).toBeCloseTo(0.06);
  });
});

describe("setRainEffect leaves the basemap fog alone unless the haze was applied", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  const base = { color: "#ffffff" } as FogSpecification;
  function fakeMap() {
    const calls: { fog: unknown[]; rain: unknown[] } = { fog: [], rain: [] };
    const map = { setFog: (f: unknown) => void calls.fog.push(f), setRain: (r: unknown) => void calls.rain.push(r) };
    return { map: map as unknown as import("mapbox-gl").Map, calls };
  }
  test("rain off, or rain on a dark ground: the fog is never touched", () => {
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });
    const { map, calls } = fakeMap();
    setRainEffect(map, false, "light", base);
    setRainEffect(map, true, "dark", base);
    expect(calls.fog).toEqual([]);
    Object.assign(g, saved);
    clearTokenCache();
  });
  test("rain on a light ground hazes the fog; turning it off puts the basemap fog back once", () => {
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });
    const { map, calls } = fakeMap();
    setRainEffect(map, true, "light", base);
    expect(calls.fog).toHaveLength(1);
    expect(calls.fog[0]).not.toEqual(base);
    setRainEffect(map, false, "light", base);
    setRainEffect(map, false, "light", base);
    expect(calls.fog).toEqual([calls.fog[0], base]);
    Object.assign(g, saved);
    clearTokenCache();
  });
});
