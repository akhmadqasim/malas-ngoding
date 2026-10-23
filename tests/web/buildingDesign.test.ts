import { expect, test } from "bun:test";
import { designFor } from "../../src/web/map/buildingDesign.ts";
import { installedSolarPoints } from "../../src/web/map/homesLayer.ts";
import type { PemdaHomes } from "../../src/shared/auth.ts";
import { square } from "./fakeBuildingMap.ts";

test("a place of worship is not assumed to be a mosque without a mosque name", () => {
  expect(designFor("ibadah", "Masjid Al Ikhlas").model).toBe("mosque-roof");
  expect(designFor("ibadah", "Gereja Katedral").model).toBeNull();
  expect(designFor("ibadah").model).toBeNull();
  expect(designFor("gudang").roof).toBe("gabled");
  expect(designFor("kantor").roof).toBe("parapet");
  expect(designFor("rumah").roof).toBe("hipped");
});

test("only recorded installations get solar models, including ones whose capacity is unknown", () => {
  const homes: PemdaHomes = { type: "FeatureCollection", features: [true, false].map(installed => ({
    type: "Feature", geometry: { type: "Point", coordinates: [117.15, -0.5] },
    properties: { buildingType: "rumah", potentialKwp: 12, interested: true, installed,
      installedKwp: null, footprintM2: 100, heightM: null, regionId: "samarinda", demo: true },
  })) };
  const models = installedSolarPoints(homes, [{ geometry: square(117.1499, -0.5001, 0.0002), properties: { height: 3 } }]);
  expect(models.features).toHaveLength(1);
  expect(models.features[0]!.properties.installed).toBe(true);
  expect(models.features[0]!.properties.installedKwp).toBeNull();
  expect(models.features[0]!.properties.translation).toEqual([0, 0, 3.25]);
  expect(installedSolarPoints(homes).features).toHaveLength(0);
  const duplicate = { ...homes, features: [homes.features[0]!, homes.features[0]!] };
  expect(installedSolarPoints(duplicate, [{ id: 10, geometry: square(117.1499, -0.5001, 0.0002), properties: { height: 3 } }]).features).toHaveLength(1);
});
