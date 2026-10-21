import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BuildingEstimate } from "../../src/shared/types.ts";
import { BUILDING_TYPE_LABELS, BUILDING_TYPES } from "../../src/web/panels/buildingTabs.ts";
import { co2Figure, EmissionTab } from "../../src/web/panels/EmissionTab.tsx";
import { EnergyTab } from "../../src/web/panels/EnergyTab.tsx";
import { Equivalents, fmtEquivalent } from "../../src/web/panels/Equivalents.tsx";
import { fmtShare, fuelShares, GridMixBar } from "../../src/web/panels/GridMixBar.tsx";
import { mixSummary } from "../../src/web/panels/EmissionContext.tsx";

/** Text of rendered markup, tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const building: BuildingEstimate = {
  featureId: "mapbox:1",
  type: "ruko",
  typeSource: "footprint",
  floors: 3,
  floorAreaM2: 1602,
  kwhYear: 176_220,
  kwhMonth: 14_685,
  co2KgYear: 200_890.8,
  bySource: [
    { fuel: "gas", kwh: 44_055, co2Kg: 30_600 },
    { fuel: "batubara", kwh: 116_305, co2Kg: 158_400 },
    { fuel: "diesel", kwh: 12_335, co2Kg: 12_100 },
    { fuel: "surya", kwh: 1762, co2Kg: 0 },
    { fuel: "biomassa", kwh: 1763, co2Kg: 0 },
  ],
  equivalents: [
    { key: "charge_hp", label: "kali charge HP", value: 11_817_106, unit: "kali" },
    { key: "pohon", label: "pohon menyerap setahun", value: 9131.4, unit: "pohon" },
    { key: "penerbangan", label: "penerbangan Jakarta–Balikpapan", value: 4.27, unit: "penerbangan" },
  ],
  region: { id: "samarinda", name: "Samarinda" },
  assumptions: ["Jenis bangunan tidak ada di data peta, ditebak dari luas lantai dasar: ruko.", "Luas dibatasi ke 10 m2."],
};

describe("grid mix shares", () => {
  test("largest first, zero and broken amounts dropped, shares add up to one", () => {
    const shares = fuelShares([
      { fuel: "gas", kwh: 25 },
      { fuel: "batubara", kwh: 66 },
      { fuel: "air", kwh: 0 },
      { fuel: "diesel", kwh: Number.NaN },
      { fuel: "surya", kwh: 1 },
    ]);
    expect(shares.map((s) => s.fuel)).toEqual(["batubara", "gas", "surya"]);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });
  test("nothing to share gives an empty list", () => {
    expect(fuelShares([])).toEqual([]);
    expect(fuelShares([{ fuel: "gas", kwh: 0 }])).toEqual([]);
  });
  test("a tiny share says <1%, never 0%", () => {
    expect(fmtShare(0.66)).toBe("66%");
    expect(fmtShare(0.003)).toBe("<1%");
    expect(fmtShare(0.006)).toBe("1%");
  });
  test("the bar lists every fuel with its share, and the CO2 when given", () => {
    const html = renderToStaticMarkup(<GridMixBar bySource={building.bySource} />);
    expect(text(html)).toContain("Batu bara 66%");
    expect(text(html)).toContain("158,4 ton CO 2");
    expect(html).toContain('aria-label="Asal listrik menurut bahan bakar: Batu bara 66%, Gas 25%, Diesel 7%, Biomassa 1%, Surya 1%"');
  });
  test("no data says so instead of an empty bar", () => {
    expect(text(renderToStaticMarkup(<GridMixBar bySource={[]} />))).toBe("Belum ada data campuran listrik.");
  });
});

describe("equivalents", () => {
  test("plain numbers: words from 100 ribu, whole numbers from 10, one decimal below", () => {
    expect(fmtEquivalent(11_817_106)).toBe("11,8 juta");
    expect(fmtEquivalent(9131.4)).toBe("9.131");
    expect(fmtEquivalent(4.27)).toBe("4,3");
    expect(fmtEquivalent(Number.NaN)).toBe("0,0");
    // One decimal in every word size, so miliar sits next to juta without a second decimal.
    expect(fmtEquivalent(32_360_000_000)).toBe("32,4 miliar");
  });
  test("rows come in reading order: trees, car, motorbike, phone, flight", () => {
    const html = renderToStaticMarkup(<Equivalents items={building.equivalents} />);
    const labels = [...html.matchAll(/equivalents__label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["pohon menyerap setahun", "kali charge HP", "penerbangan Jakarta–Balikpapan"]);
  });
});

describe("CO2 figure", () => {
  test("kilograms below a tonne, tonnes with one decimal below 100, whole tonnes above", () => {
    expect(co2Figure(850).unit).toBe("kg CO2 per tahun");
    const small = co2Figure(64_000);
    expect([small.unit, small.format(small.value)]).toEqual(["ton CO2 per tahun", "64,0"]);
    const big = co2Figure(200_890.8);
    expect(big.format(big.value)).toBe("201");
    expect(co2Figure(Number.NaN).value).toBe(0);
  });
});

describe("the tabs", () => {
  const at: [number, number] = [117.15, -0.5];
  test("Energi: floor area from footprint and floors, the region, the assumptions with m²", () => {
    const t = text(renderToStaticMarkup(<EnergyTab building={building} at={at} />));
    expect(t).toContain("534 m² × 3 lantai");
    expect(t).toContain("110 kWh/m² per tahun");
    expect(t).toContain("Samarinda");
    expect(t).toContain("Luas dibatasi ke 10 m².");
  });
  test("Energi outside Kaltim says so in place of the region", () => {
    const t = text(renderToStaticMarkup(<EnergyTab building={{ ...building, region: null }} at={at} />));
    expect(t).toContain("Di luar Kalimantan Timur");
  });
  test("Emisi: the grid factor behind the CO2 and the sources", () => {
    const t = text(renderToStaticMarkup(<EmissionTab building={building} at={at} />));
    expect(t).toContain("faktor emisi jaringan 1,14 kg CO 2 /kWh");
    expect(t).toContain("perkiraan");
  });
  test("every building type has an Indonesian name", () => {
    expect(BUILDING_TYPES).toHaveLength(12);
    for (const t of BUILDING_TYPES) expect(BUILDING_TYPE_LABELS[t].length).toBeGreaterThan(2);
  });
});

describe("the overview's one-line grid mix", () => {
  test("the three largest fuels, the rest summed as lainnya", () => {
    const shares = fuelShares([
      { fuel: "batubara", kwh: 0.66 },
      { fuel: "gas", kwh: 0.25 },
      { fuel: "diesel", kwh: 0.07 },
      { fuel: "surya", kwh: 0.01 },
      { fuel: "biomassa", kwh: 0.01 },
    ]);
    expect(mixSummary(shares)).toBe("Batu bara 66%, gas 25%, diesel 7%, lainnya 2%");
    expect(mixSummary(shares.slice(0, 2))).toBe("Batu bara 66%, gas 25%");
  });
  test("the bar can leave out its list", () => {
    expect(renderToStaticMarkup(<GridMixBar bySource={building.bySource} legend={false} />)).not.toContain("mix__list");
  });
});
