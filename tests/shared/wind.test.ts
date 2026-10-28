import { expect, test } from "bun:test";
import { compassName, windPose } from "../../src/shared/wind.ts";

test("meteorological bearing rotates the nacelle and hub together while flow points downwind", () => {
  for (const [bearing, east, north, to] of [[0, 0, 9, 180], [90, 9, 0, 270], [180, 0, -9, 0], [270, -9, 0, 90]]) {
    const pose = windPose(bearing!, 35);
    expect(pose.hub[0]).toBeCloseTo(east!, 6);
    expect(pose.hub[1]).toBeCloseTo(north!, 6);
    expect(pose.hub[2]).toBe(102);
    expect(pose.toDeg).toBe(to!);
    expect(pose.rotorRotation).toEqual([0, 35, bearing!]);
    expect(pose.towerRotation).toEqual([0, 0, bearing!]);
  }
  expect(windPose(450).toDeg).toBe(270);
  expect(compassName(360)).toBe("Utara");
  expect(compassName(225)).toBe("Barat daya");
});
