import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import buildingTypes from "../../data/seed/building-types.json";
import equivalents from "../../data/seed/equivalents.json";
import grid from "../../data/seed/grid.json";
import type { GridMix } from "../../src/shared/types.ts";
import { fuelMixAverage, isVerified, MethodologyContent } from "../../src/web/panels/MethodologyPanel.tsx";

const mix = grid as GridMix;
const html = renderToStaticMarkup(<MethodologyContent grid={mix} />);
const text = html.replace(/<[^>]+>/g, "");

describe("the grid factor", () => {
  test("the fuel-mix average of the seed is about 0,87 kg per kWh", () => {
    expect(fuelMixAverage(mix)).toBeCloseTo(0.8714, 4);
  });

  test("says the app uses the official 1,14 combined margin of Sistem Mahakam (2019 data), next to the 0,87 average", () => {
    expect(text).toContain("Faktor resmi Sistem Mahakam");
    expect(text).toContain("1,14 kg CO2/kWh, dipakai");
    expect(text).toContain("combined margin");
    expect(text).toContain("data 2019");
    expect(text).toContain("Rata-rata bauran listrik");
    expect(text).toContain("0,87 kg CO2/kWh, perkiraan");
    expect(text).toContain("Aplikasi memakai 1,14 karena itu angka resmi");
    // 1.14 / 0.8714 is 31% higher.
    expect(text).toContain("sekitar 31% lebih tinggi");
  });
});

describe("formulas and factor tables", () => {
  test("kWh, CO2 and equivalents each have their formula", () => {
    expect(text).toContain("CO2 (kg) = listrik (kWh) × 1,14 kg CO2 per kWh");
    expect(text).toContain("kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi");
    expect(text).toContain("padanan = kg CO2 ÷ kg CO2 per satuan");
  });

  test("only values with a verified source escape the asumsi mark", () => {
    expect(isVerified("ESDM SEC survey 2021, office mean 180.95 kWh/m2/year (verified)")).toBe(true);
    expect(isVerified("Average new car 190 g/km (GFEI/IEA via snippet); unverified")).toBe(false);
    expect(isVerified("Estimate: lighting and fans, low load (estimated)")).toBe(false);
  });

  test("asumsi rows are marked in the tables", () => {
    const types = Object.values(buildingTypes).filter((t) => !isVerified(t.source)).length;
    const equiv = equivalents.filter((e) => !isVerified(e.source)).length;
    const fuels = Object.values(mix.shares).filter((s) => s > 0).length;
    expect(types).toBe(8);
    expect(html.match(/data-assumption/g)?.length).toBe(types + equiv + fuels);
    // Every building type and every equivalent has a row.
    expect(html.match(/<tr/g)?.length).toBe(3 + Object.keys(buildingTypes).length + equivalents.length + fuels);
  });
});

describe("sources", () => {
  test("names every source with its licence, geoBoundaries as CC BY 3.0 IGO", () => {
    expect(text).toContain("geoBoundaries gbOpen IDN ADM2");
    expect(text).toContain("CC BY 3.0 IGO");
    expect(text).toContain("Runfola");
    for (const name of ["BPS Kalimantan Timur", "Kementerian ESDM", "NASA POWER", "Open-Meteo", "OpenStreetMap", "Global Energy Monitor"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("CC BY 4.0");
  });
});
