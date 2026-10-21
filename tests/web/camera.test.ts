import { describe, expect, test } from "bun:test";
import { canOrbit, ORBIT_MAX_ZOOM } from "../../src/web/map/camera.ts";

describe("idle orbit", () => {
  test("turns only at the overview, never at city or building zoom", () => {
    expect(ORBIT_MAX_ZOOM).toBe(11);
    expect(canOrbit(6.6)).toBe(true);
    expect(canOrbit(10.99)).toBe(true);
    expect(canOrbit(11)).toBe(false);
    expect(canOrbit(16.6)).toBe(false);
  });
});
