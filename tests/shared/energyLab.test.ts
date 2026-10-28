import { describe, test, expect } from "bun:test";
import { labRun } from "../../src/shared/energyLab.ts";
describe("weather and battery experiment", () => {
  test("energy conserved for weather, panel sizes and battery capacities", () => {
    for (const weather of ["clear", "cloudy", "rain", "heavy-rain", "night"] as const) for (const panel of [0, 0.5, 4]) for (const battery of [0, 0.1, 4]) {
      const r = labRun(panel, 0.6, battery, weather, 70);
      expect(r.solar).toBeCloseTo(r.direct + r.charge + r.exported, 8);
      expect(r.loadKw).toBeCloseTo(r.direct + r.discharge + r.grid, 8);
      expect(r.stored).toBeGreaterThanOrEqual(0); expect(r.stored).toBeLessThanOrEqual(battery);
    }
  });
  test("battery cannot supply power without previous solar surplus", () => {
    expect(labRun(0, 1, 5, "night", 60).discharge).toBe(0);
    expect(labRun(0.5, 1, 5, "night", 60).stored).toBe(0);
  });
  test("charged battery reduces night grid usage then depletes", () => {
    const early = labRun(4, 0.6, 0.1, "night", 30);
    expect(early.discharge).toBeGreaterThan(0);
    expect(early.grid).toBeLessThan(early.withoutBattery);
    const late = labRun(4, 0.6, 0.1, "night", 3600);
    expect(late.stored).toBe(0); expect(late.grid).toBeCloseTo(0.6);
  });
  test("rain intensity and gradual transition change PV production", () => {
    const first = labRun(2, 0.6, 0, "heavy-rain", 2);
    const later = labRun(2, 0.6, 0, "heavy-rain", 30);
    expect(first.solar).toBeGreaterThan(later.solar);
    expect(labRun(2, 0.6, 0, "rain", 30).solar).toBeGreaterThan(later.solar);
  });
});
