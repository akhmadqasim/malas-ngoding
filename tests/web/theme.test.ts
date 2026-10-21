import { afterEach, describe, expect, test } from "bun:test";
import { clearTokenCache, mixColors, mixRamp, rampTokens, token } from "../../src/web/theme.ts";

describe("mixRamp mixes evenly spaced stops like Mapbox's linear interpolate", () => {
  test("midpoint of two stops", () => {
    expect(mixRamp(["#000000", "#ffffff"], 0.5)).toBe("#808080");
  });
  test("ends and inner stops come back exactly", () => {
    const stops = ["#b4863f", "#c39653", "#d5a969", "#e7bc7e", "#f9cf94", "#fee5c3"];
    expect(mixRamp(stops, 0)).toBe("#b4863f");
    expect(mixRamp(stops, 0.2)).toBe("#c39653");
    expect(mixRamp(stops, 1)).toBe("#fee5c3");
  });
  test("mixColors moves a colour part of the way toward another", () => {
    expect(mixColors("#000000", "#ffffff", 0.6)).toBe("#999999");
    expect(mixColors("#b4863f", "#3e4a5a", 0)).toBe("#b4863f");
    expect(mixColors("#b4863f", "#3e4a5a", 1)).toBe("#3e4a5a");
  });
  test("clamps outside 0..1 and survives NaN", () => {
    expect(mixRamp(["#102030", "#405060"], -1)).toBe("#102030");
    expect(mixRamp(["#102030", "#405060"], 7)).toBe("#405060");
    expect(mixRamp(["#102030", "#405060"], Number.NaN)).toBe("#102030");
  });
});

describe("token reads the CSS custom properties from styles.css", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  afterEach(() => {
    g.document = saved.document;
    g.getComputedStyle = saved.getComputedStyle;
    clearTokenCache();
  });
  function fakeRoot(values: Record<string, string>) {
    g.document = { documentElement: {} };
    g.getComputedStyle = () => ({ getPropertyValue: (name: string) => values[name] ?? "" });
  }

  test("returns the trimmed value", () => {
    fakeRoot({ "--color-paper": " #ece9e2 " });
    expect(token("--color-paper")).toBe("#ece9e2");
  });
  test("a missing token is a loud error, not a silent black", () => {
    fakeRoot({});
    expect(() => token("--color-nope")).toThrow("--color-nope");
  });
  test("rampTokens lists the six stops of a metric for a dark ground", () => {
    fakeRoot(Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`--color-kwh-${i}`, `#00000${i}`])));
    expect(rampTokens("kwh", "dark")).toEqual(["#000001", "#000002", "#000003", "#000004", "#000005", "#000006"]);
  });
  test("a light ground uses the day ramp, where the highest value is the darkest", () => {
    fakeRoot(Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`--color-co2-day-${i}`, `#0000a${i}`])));
    expect(rampTokens("co2", "light")).toEqual(["#0000a1", "#0000a2", "#0000a3", "#0000a4", "#0000a5", "#0000a6"]);
  });
});
