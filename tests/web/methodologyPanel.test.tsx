import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import buildingTypes from "../../data/seed/building-types.json";
import equivalents from "../../data/seed/equivalents.json";
import grid from "../../data/seed/grid.json";
import regions from "../../data/seed/regions.json";
import type { GridMix } from "../../src/shared/types.ts";
import {
  fuelMixAverage,
  isVerified,
  kwhSplit,
  MethodologyContent,
  PLN_2024,
  perKwhSold,
  SPLIT,
} from "../../src/web/panels/MethodologyPanel.tsx";

const mix = grid as GridMix;
const html = renderToStaticMarkup(<MethodologyContent grid={mix} />);
const text = html.replace(/<[^>]+>/g, "");
const byId = (id: string) => regions.find((r) => r.id === id)!;

describe("kWh per region", () => {
  test("the four BPS branch totals add up to the 2024 sales", () => {
    const sum = Object.values(PLN_2024.branches).reduce((a, b) => a + b, 0);
    expect(sum).toBe(PLN_2024.soldKwh);
  });

  test("the seed figures follow the stated split (gaps-filled.md section 4)", () => {
    const split = kwhSplit();
    // Mahakam Ulu: customers x the assumed 1,500 kWh, rounded to 0,1 million in the seed.
    const mahulu = byId("mahakam-ulu");
    expect(Math.abs(mahulu.customers! * SPLIT.mahakamUluKwhPerCustomer - mahulu.kwhYear)).toBeLessThan(50_000);
    // Berau: its customers against 25,000 assumed Malinau customers.
    expect(Math.abs(split.berau.share * PLN_2024.branches.berau - byId("berau").kwhYear)).toBeLessThan(500_000);
    expect(Math.round(split.berau.share * 100)).toBe(78);
    // The ten regions are the four branches minus Malinau.
    expect(Math.abs(split.regionsKwh - (PLN_2024.soldKwh - split.malinauKwh))).toBeLessThan(1_000_000);
    // The Kutai Kartanegara shares cover all of its customers.
    expect(Object.values(SPLIT.kukarShareByBranch).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  test("names the exceptions to the split by customers and marks them asumsi", () => {
    expect(text).toContain("Tetap 1.380,7 juta kWh dari tabel BPS Samarinda");
    expect(text).toContain("tahunnya dianggap 2024");
    expect(text).toContain("7.071 pelanggan × 1.500 kWh per pelanggan = 10,6 juta kWh");
    expect(text).toContain("60% di sini, 25% Balikpapan, 15% Bontang");
    expect(text).toContain("Berau mendapat 78%: 89.331 pelanggan Berau dibanding 25.000 pelanggan Malinau");
    expect(text).toContain("Jumlah sepuluh wilayah 5.393,6 juta kWh");
    const split = html.slice(html.indexOf("methodology__table--split"), html.indexOf("</table>"));
    expect(split.match(/data-assumption/g)?.length).toBe(4);
  });
});

describe("the grid factor", () => {
  test("the fuel-mix average is about 0,87 per kWh generated and 0,94 per kWh sold", () => {
    expect(fuelMixAverage(mix)).toBeCloseTo(0.8714, 4);
    expect(perKwhSold(fuelMixAverage(mix))).toBeCloseTo(0.9406, 3);
  });

  test("says the app uses the official 1,14 and that totals lean high against 0,94 per kWh sold", () => {
    expect(text).toContain("Faktor resmi Sistem Mahakam");
    expect(text).toContain("1,14 kg CO2/kWh, dipakai");
    expect(text).toContain("combined margin");
    expect(text).toContain("data 2019");
    expect(text).toContain("0,87 kg CO2/kWh dibangkitkan, perkiraan");
    expect(text).toContain("Sekitar 0,94 per kWh terjual");
    expect(text).toContain("sekitar 7,4% listrik yang dibangkitkan tidak sampai terjual");
    expect(text).toContain("simulasi panel surya dan penghematan listrik");
    expect(text).toContain("total emisi di peta cenderung tinggi");
    // 1.14 / 0.9406 is 21% higher.
    expect(text).toContain("sekitar 21% di atas hitungan dengan rata-rata bauran per kWh terjual (0,94)");
  });
});

describe("formulas and factor tables", () => {
  test("kWh, CO2, equivalents and solar each have their formula", () => {
    expect(text).toContain("CO2 (kg) = listrik (kWh) × 1,14 kg CO2 per kWh");
    expect(text).toContain("kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi");
    expect(text).toContain("padanan = kg CO2 ÷ kg CO2 per satuan");
    expect(text).toContain("0,78 adalah rasio kinerja");
    expect(text).toContain("luas atap × 0,6");
    expect(text).toContain("1,13 khusus untuk PLTS dan PLTB");
    expect(text).toContain("3 m ke bawah");
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
    expect(html.match(/data-assumption/g)?.length).toBe(4 + types + equiv + fuels);
    // Every building type and every equivalent has a row (4 header rows, 6 split rows).
    expect(html.match(/<tr/g)?.length).toBe(4 + 6 + Object.keys(buildingTypes).length + equivalents.length + fuels);
  });

  test("the fuel table says how each factor was made", () => {
    expect(text).toContain("IPCC 2006, efisiensi PLTU 33%");
    expect(text).toContain("CO2 biogenik dihitung 0");
  });

  test("every number in a basis line appears in that row's seed source", () => {
    // Indonesian digits ("180,95", "1.300") back to the seed's English form ("180.95", "1300" or "1,300").
    const seedForms = (n: string) => {
      const plain = n.replaceAll(".", "");
      return [plain.replace(",", "."), plain.replace(/(\d)(\d{3})$/, "$1,$2")];
    };
    const rows = [
      ...Object.entries(buildingTypes).map(([key, t]) => ({ label: TYPE_LABEL[key]!, source: t.source })),
      ...equivalents.map((e) => ({ label: e.label, source: e.source })),
    ];
    for (const { label, source } of rows) {
      const tr = html.split("<tr").find((r) => r.includes(`<th scope="row">${label}</th>`))?.split("</tr>")[0];
      expect(tr).toBeDefined();
      const basis = tr!.slice(tr!.lastIndexOf("<td>")).replace(/<[^>]+>/g, "");
      for (const n of basis.replace("CO2", "CO").match(/\d[\d.,]*\d|\d/g) ?? []) {
        if (n === "2021") continue; // the survey year, part of the survey's name
        expect({ label, n, found: seedForms(n).some((f) => source.includes(f)) }).toEqual({ label, n, found: true });
      }
    }
  });
});

const TYPE_LABEL: Record<string, string> = {
  rumah: "Rumah",
  ruko: "Ruko",
  kantor: "Kantor",
  pemerintahan: "Kantor pemerintah",
  sekolah: "Sekolah",
  kampus: "Kampus",
  rumah_sakit: "Rumah sakit",
  hotel: "Hotel",
  mal: "Mal",
  ibadah: "Rumah ibadah",
  gudang: "Gudang",
  industri: "Industri ringan",
};

describe("sources", () => {
  test("names every source with its licence, geoBoundaries as CC BY 3.0 IGO", () => {
    expect(text).toContain("geoBoundaries gbOpen IDN ADM2");
    expect(text).toContain("CC BY 3.0 IGO");
    expect(text).toContain("Runfola");
    for (const name of ["BPS Kalimantan Timur", "Kementerian ESDM", "NASA POWER", "Open-Meteo", "OpenStreetMap", "Global Energy Monitor"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("Weather data by Open-Meteo.com");
    expect(text).toContain("WRI Global Power Plant Database CC BY 4.0");
    expect(text).toContain("Koran Jakarta, 15 September 2026");
  });
});
