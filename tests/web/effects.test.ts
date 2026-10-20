import { describe, expect, test } from "bun:test";
import { lightPresetFor, witaHour } from "../../src/web/map/effects.ts";

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
});
