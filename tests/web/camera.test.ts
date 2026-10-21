import { describe, expect, test } from "bun:test";
import {
  canOrbit,
  KALTIM_VIEW,
  ORBIT_MAX_ZOOM,
  SWAY_DEG,
  SWAY_PERIOD_MS,
  type SwayState,
  swayFrom,
  swayStep,
} from "../../src/web/map/camera.ts";

describe("idle orbit", () => {
  test("turns only at the overview, never at city or building zoom", () => {
    expect(ORBIT_MAX_ZOOM).toBe(11);
    expect(canOrbit(6.6)).toBe(true);
    expect(canOrbit(10.99)).toBe(true);
    expect(canOrbit(11)).toBe(false);
    expect(canOrbit(16.6)).toBe(false);
  });
});

/** Runs the sway at 60 fps for `ms` and records every bearing it sets. */
function run(start: SwayState, ms: number): { end: SwayState; bearings: number[] } {
  let s = start;
  const bearings: number[] = [];
  for (let t = 0; t < ms; t += 16) {
    s = swayStep(s, 16);
    bearings.push(s.bearing);
  }
  return { end: s, bearings };
}

describe("idle sway: a slow pendulum around the resting bearing, not a full turn", () => {
  const rest = KALTIM_VIEW.bearing;

  test("swings 12 to 15 degrees either side and never further", () => {
    expect(SWAY_DEG).toBeGreaterThanOrEqual(12);
    expect(SWAY_DEG).toBeLessThanOrEqual(15);
    const { bearings } = run(swayFrom(null, rest), SWAY_PERIOD_MS * 2);
    expect(Math.min(...bearings)).toBeGreaterThanOrEqual(rest - SWAY_DEG - 1e-9);
    expect(Math.max(...bearings)).toBeLessThanOrEqual(rest + SWAY_DEG + 1e-9);
    // It really uses the whole arc, both ways.
    expect(Math.max(...bearings) - Math.min(...bearings)).toBeGreaterThan(2 * SWAY_DEG - 0.5);
  });

  test("slow: never faster than the old orbit's 2.2 degrees a second", () => {
    const { bearings } = run(swayFrom(null, rest), SWAY_PERIOD_MS);
    const fastest = Math.max(...bearings.slice(1).map((b, i) => Math.abs(b - bearings[i]!) / 0.016));
    expect(fastest).toBeLessThanOrEqual(2.2);
    expect(fastest).toBeGreaterThan(1.5);
  });

  test("starts from rest instead of with a jolt", () => {
    const { bearings } = run(swayFrom(null, rest), 1000);
    const firstFrame = Math.abs(bearings[0]! - rest) / 0.016;
    expect(firstFrame).toBeLessThan(0.05);
    // After one second it has moved less than half a degree.
    expect(Math.abs(bearings.at(-1)! - rest)).toBeLessThan(0.5);
  });

  test("an input stops it where it is; idle again, it carries on around the same resting bearing", () => {
    const { end } = run(swayFrom(null, rest), 9000);
    expect(Math.abs(end.bearing - rest)).toBeGreaterThan(3);
    const resumed = swayFrom(end, end.bearing);
    expect(resumed.center).toBe(rest);
    expect(resumed.phase).toBe(end.phase);
    // It does not jump: the first frame lands right next to where it stopped.
    expect(Math.abs(swayStep(resumed, 16).bearing - end.bearing)).toBeLessThan(0.01);
  });

  test("once the camera has been turned or flown elsewhere, it sways around the new bearing", () => {
    const { end } = run(swayFrom(null, rest), 9000);
    const fresh = swayFrom(end, 40);
    expect(fresh.center).toBe(40);
    expect(fresh.phase).toBe(0);
  });

  test("Mapbox wraps the bearing at 180 degrees; that is not a turn by the user", () => {
    const near = { ...swayFrom(null, 178), bearing: 181 };
    expect(swayFrom(near, -179).center).toBe(178);
  });
});
