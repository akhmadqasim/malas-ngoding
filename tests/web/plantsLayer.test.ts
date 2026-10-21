import { describe, expect, test } from "bun:test";
import { PULSE_IDLE_MS, pulseWantsFrame } from "../../src/web/map/plantsLayer.ts";

describe("plant pulse repaints only while a marker is drawn", () => {
  test("keeps asking for frames right after Mapbox drew a marker", () => {
    expect(pulseWantsFrame(10_000, 9_990)).toBe(true);
    expect(pulseWantsFrame(10_000, 10_000 - PULSE_IDLE_MS + 1)).toBe(true);
  });
  test("stops when no marker has been drawn for a while (all plants off screen)", () => {
    expect(PULSE_IDLE_MS).toBeLessThanOrEqual(500);
    expect(pulseWantsFrame(10_000, 10_000 - PULSE_IDLE_MS)).toBe(false);
    expect(pulseWantsFrame(10_000, Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
