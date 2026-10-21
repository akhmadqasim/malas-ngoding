import { describe, expect, test } from "bun:test";
import type { PlantCollection } from "../../src/web/api.ts";
import { FUEL_LABELS, fuelsPresent, plantIconExpression } from "../../src/web/map/fuels.ts";

function plants(...fuels: string[]): PlantCollection {
  return {
    type: "FeatureCollection",
    features: fuels.map((fuel, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [117, -0.5] },
      properties: { name: `PLT ${i}`, fuel: fuel as never, capacityMw: 10, status: "operating", approx: false, source: "test" },
    })),
  };
}

describe("plant marker images are made only for fuels on the map", () => {
  test("present fuels, once each, in legend order", () => {
    expect(fuelsPresent(plants("surya", "batubara", "gas", "batubara"))).toEqual(["batubara", "gas", "surya"]);
  });
  test("an unknown fuel falls back to lainnya", () => {
    expect(fuelsPresent(plants("panas_bumi", "gas"))).toEqual(["gas", "lainnya"]);
  });
  test("no plants, no images", () => {
    expect(fuelsPresent(plants())).toEqual([]);
  });
  test("the icon expression only names registered images", () => {
    expect(plantIconExpression(["batubara", "gas"])).toEqual([
      "concat",
      "plant-",
      ["match", ["get", "fuel"], ["batubara", "gas"], ["get", "fuel"], "lainnya"],
    ]);
    // Only lainnya registered: every feature uses it, no match needed.
    expect(plantIconExpression(["lainnya"])).toBe("plant-lainnya");
  });
  test("every fuel has an Indonesian label", () => {
    expect(FUEL_LABELS.batubara).toBe("Batu bara");
    expect(Object.keys(FUEL_LABELS)).toHaveLength(7);
  });
});
