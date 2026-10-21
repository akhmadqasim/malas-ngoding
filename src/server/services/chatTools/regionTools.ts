import { fmtNumber } from "../../../shared/format.ts";
import type { FuelType, RecommendationCategory, RecommendationItem, RegionSummary } from "../../../shared/types.ts";
import { recommendationsFor } from "../recommendations.ts";
import {
  co2PerYear,
  estimated,
  kwhPerYear,
  NO_DATA,
  percent,
  REGION_PARAM,
  region,
  type ServerTool,
} from "./common.ts";

// Region-level tools: the ranking of the 10 kabupaten/kota, one region's figures and the grid mix.

const REGION_NOTE =
  "Listrik per wilayah adalah perkiraan dari penjualan listrik PLN 2024 per cabang, dibagi menurut jumlah pelanggan. " +
  "Emisi CO2 = kWh dikali faktor emisi jaringan Kaltim. Sumber: BPS Kalimantan Timur 2024 dan Kementerian ESDM.";
const FUEL_WORDS: Record<FuelType, string> = {
  batubara: "batu bara",
  gas: "gas",
  diesel: "diesel",
  surya: "surya",
  air: "air",
  biomassa: "biomassa",
  lainnya: "lainnya",
};

function rankByCo2(regions: RegionSummary[]): RegionSummary[] {
  return [...regions].sort((a, b) => b.co2KgYear - a.co2KgYear);
}

export const listRegions: ServerTool = {
  definition: {
    name: "list_regions",
    description:
      "All 10 kabupaten/kota of Kalimantan Timur with their yearly electricity use and CO2 emissions, ranked from the highest to the lowest CO2 (rank 1 emits the most), plus the Kaltim total. Call it to compare regions or to find the region with the highest or lowest use or emissions.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (deps) => {
    const regions = await deps.db.listRegions();
    const totalKwh = regions.reduce((sum, r) => sum + r.kwhYear, 0);
    const totalCo2 = regions.reduce((sum, r) => sum + r.co2KgYear, 0);
    return {
      result: {
        note: REGION_NOTE,
        kaltim: { kwhText: estimated(kwhPerYear(totalKwh)), co2Text: estimated(co2PerYear(totalCo2)) },
        regions: rankByCo2(regions).map((r, i) => ({
          rank: i + 1,
          id: r.id,
          name: r.name,
          kind: r.kind,
          kwhText: estimated(kwhPerYear(r.kwhYear), r.estimated),
          co2Text: estimated(co2PerYear(r.co2KgYear)),
          kwhShareText: estimated(percent(totalKwh > 0 ? (r.kwhYear / totalKwh) * 100 : 0), r.estimated),
        })),
      },
    };
  },
};

export const getRegionStats: ServerTool = {
  definition: {
    name: "get_region_stats",
    description:
      "Figures for one kabupaten/kota: electricity use, CO2, its share of Kaltim's electricity, electricity per person, population, PLN customers, electrification ratio, villages without PLN service, and its CO2 rank among the 10 regions. Call it whenever the user asks about a specific region.",
    input_schema: { type: "object", properties: { region: REGION_PARAM }, required: ["region"] },
  },
  run: async (deps, i) => {
    const wanted = region(i.region);
    if ("problem" in wanted) return wanted;
    const regions = await deps.db.listRegions();
    const ranked = rankByCo2(regions);
    const rank = ranked.findIndex((r) => r.id === wanted.id) + 1;
    const r = ranked[rank - 1];
    if (!r) return { problem: `Data wilayah ${wanted.id} belum ada.` };
    const totalKwh = regions.reduce((sum, x) => sum + x.kwhYear, 0);
    return {
      result: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        co2Rank: `${rank} dari ${ranked.length} wilayah (1 = emisi tertinggi)`,
        facts: {
          "Listrik terpakai": estimated(kwhPerYear(r.kwhYear), r.estimated),
          "Emisi CO2": estimated(co2PerYear(r.co2KgYear)),
          "Bagian dari listrik Kaltim": estimated(percent(totalKwh > 0 ? (r.kwhYear / totalKwh) * 100 : 0), r.estimated),
          "Listrik per orang": r.population
            ? estimated(`${fmtNumber(r.kwhYear / r.population)} kWh per tahun`, r.estimated)
            : NO_DATA,
          Penduduk: r.population === null ? NO_DATA : `${fmtNumber(r.population)} jiwa`,
          "Pelanggan PLN": r.customers === null ? NO_DATA : fmtNumber(r.customers),
          "Rasio elektrifikasi": r.electrificationPct === null ? NO_DATA : percent(r.electrificationPct),
          "Desa belum dilayani PLN": r.villagesNoPln === null ? NO_DATA : `${fmtNumber(r.villagesNoPln)} desa`,
        },
        note: REGION_NOTE,
      },
    };
  },
};

const CATEGORY_WORDS: Record<RecommendationCategory, string> = {
  energi_terbarukan: "energi terbarukan",
  efisiensi: "efisiensi energi",
  tata_ruang: "tata ruang",
  akses_listrik: "akses listrik",
  kebijakan: "kebijakan",
};
const PRIORITY_WORDS: Record<RecommendationItem["priority"], string> = {
  1: "prioritas 1 (paling penting)",
  2: "prioritas 2",
  3: "prioritas 3",
};
const WITA_DATE = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Makassar", day: "numeric", month: "long", year: "numeric" });

export const getRecommendations: ServerTool = {
  definition: {
    name: "get_recommendations",
    description:
      "Recommendations for the local government of one kabupaten/kota (renewable energy, efficiency, spatial planning, electricity access, policy), written from the region's data, with their priority and expected impact. The same list shows in the region's panel on the map, so call fly_to_region too. The first answer for a region can take about 10 seconds.",
    input_schema: { type: "object", properties: { region: REGION_PARAM }, required: ["region"] },
  },
  run: async (deps, i) => {
    const wanted = region(i.region);
    if ("problem" in wanted) return wanted;
    const [recs, summary] = await Promise.all([recommendationsFor(deps, wanted.id), deps.db.regionById(wanted.id)]);
    if (!recs) return { problem: `Data wilayah ${wanted.id} belum ada.` };
    return {
      result: {
        region: summary?.name ?? wanted.id,
        source: recs.model
          ? `ditulis AI (${recs.model}) dari data wilayah, dibuat ${WITA_DATE.format(new Date(recs.generatedAt))}`
          : "berbasis aturan dari data wilayah (AI sedang tidak tersedia)",
        items: recs.items.map((item) => ({
          priority: PRIORITY_WORDS[item.priority],
          category: CATEGORY_WORDS[item.category],
          title: item.title,
          body: item.body,
          impact: item.impact,
        })),
        note: "Rekomendasi ini juga tampil di panel wilayah di peta. Angka dampaknya perkiraan.",
      },
    };
  },
};

export const getGridMix: ServerTool = {
  definition: {
    name: "get_grid_mix",
    description:
      "The Kaltim electricity grid: its emission factor (kg CO2 per kWh) and the share of each power source (coal, gas, diesel, solar and others). Call it to explain where the electricity comes from and why using it emits CO2.",
    input_schema: { type: "object", properties: {} },
  },
  run: async (deps) => {
    const grid = await deps.db.getGridMix();
    const mix = (Object.entries(grid.shares) as [FuelType, number][])
      .filter(([, share]) => share > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([fuel, share]) => ({ fuel: FUEL_WORDS[fuel] ?? fuel, shareText: percent(share * 100, 0) }));
    return {
      result: {
        year: grid.year,
        gridFactorText: `${fmtNumber(grid.factorKgPerKwh, 2)} kg CO2 per kWh`,
        mix,
        note:
          "Porsi tiap sumber adalah perkiraan. Listrik PLN di Kaltim mengalir lewat satu jaringan, jadi campuran ini " +
          "berlaku untuk semua pelanggan; listrik satu gedung tidak bisa ditelusuri ke satu pembangkit.",
        source: grid.source,
      },
    };
  },
};
