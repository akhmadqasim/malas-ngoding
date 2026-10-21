import { describe, expect, test } from "bun:test";
import { FADE_ZOOMS, partZoom, plantGroups, visibility } from "../../src/web/map/plantGroups.ts";

const p = (name: string, lng: number, lat: number, capacityMw = 10) => ({ lng, lat, capacityMw, props: { name } });

describe("plant groups part smoothly as the map zooms in", () => {
  // Two plants 330 m apart (Tanjung Batu), one 2 km away (Embalut), one far off (Sangatta).
  const plants = [p("A", 117.0515, -0.3844, 100), p("B", 117.0513, -0.3814, 60), p("C", 117.05, -0.4, 50), p("D", 117.45, -0.12, 2200)];
  const nodes = plantGroups(plants);
  const plantsOnly = nodes.filter((n) => n.kind === "plant");
  const groups = nodes.filter((n) => n.kind === "group");

  test("every plant has its own marker that never parts", () => {
    expect(plantsOnly.map((n) => n.members[0]!.name).sort()).toEqual(["A", "B", "C", "D"]);
    for (const n of plantsOnly) expect(n.split).toBeGreaterThan(20);
  });

  test("closer plants part later: the 330 m pair holds longer than the group with the 2 km plant", () => {
    const pair = groups.find((g) => g.members.length === 2)!;
    const trio = groups.find((g) => g.members.length === 3)!;
    expect(pair.split).toBeGreaterThan(trio.split);
    // The pair appears where the trio parts, so one hands over to the other in place.
    expect(pair.appear).toBeCloseTo(trio.split, 6);
    expect(pair.capacityMw).toBe(160);
  });

  test("at any zoom the visible weight of each plant adds up to one: no gap, no double", () => {
    for (let z = 4; z <= 16; z += 0.1) {
      for (const name of ["A", "B", "C", "D"]) {
        const total = nodes.filter((n) => n.members.some((m) => m.name === name)).reduce((sum, n) => sum + visibility(n, z), 0);
        expect(total).toBeGreaterThan(0.99);
        expect(total).toBeLessThan(1.01);
      }
    }
  });

  test("a marker cross-fades over the fade band, half way at the zoom it parts", () => {
    const trio = groups.find((g) => g.members.length === 3)!;
    expect(visibility(trio, trio.split)).toBeCloseTo(0.5, 6);
    expect(visibility(trio, trio.split + FADE_ZOOMS / 2)).toBe(0);
    expect(visibility(trio, trio.split - FADE_ZOOMS / 2)).toBe(1);
  });

  test("the parting zoom follows the screen distance", () => {
    // 18 px at zoom z is 18 / (512 * 2^z) world units: they part exactly there.
    expect(partZoom(18 / (512 * 2 ** 9))).toBeCloseTo(9, 6);
  });

});
