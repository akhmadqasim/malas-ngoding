import { fmtCompact, fmtKg, fmtNumber, fmtRupiah } from "../../shared/format.ts";
import type { RecommendationItem } from "../../shared/types.ts";
import { dec, placeName, rankWords } from "./recommendationPrompt.ts";
import type { RegionFacts } from "./recommendations.ts";

/** From this coal share the grid counts as coal-heavy, and rooftop PV moves up. */
const COAL_HEAVY_SHARE = 0.5;
/** Regions that use at least this share of Kaltim's electricity get rooftop PV first. */
const LARGE_USER_PCT = 15;
/** Below this electrification ratio an access item is added; below `LOW_ACCESS_PCT` it comes first. */
const ACCESS_PCT = 95;
const LOW_ACCESS_PCT = 90;
/** Use per person at this multiple of the Kaltim figure makes efficiency the first priority. */
const HIGH_USE_FACTOR = 1.25;

/**
 * Recommendations built from rules when Claude is not available: communal PV for villages without PLN,
 * an access plan for a low electrification ratio, rooftop PV on government buildings (first when the grid
 * is coal-heavy and the region is a large user), efficiency where use per person is more than 5% above the
 * Kaltim average (PPU left out, see `POPULATION_NOT_COMPARABLE`), plus spatial planning and policy.
 * Always 3 to 6 items, ordered by priority.
 */
export function ruleBasedRecommendations(f: RegionFacts): RecommendationItem[] {
  const { region: r, comparison: c, climate, grid, solar } = f;
  const place = placeName(r);
  const psh = `rata-rata ${fmtNumber(climate.pshYear, 1)} jam puncak matahari per hari (${climate.fallback ? "asumsi" : "NASA POWER"})`;
  const tariff = `Rp ${fmtNumber(solar.govTariffRpPerKwh, 2)}`;
  const items: RecommendationItem[] = [];

  if (r.villagesNoPln !== null && r.villagesNoPln > 0) {
    const villages = `${fmtNumber(r.villagesNoPln)} desa`;
    items.push({
      title: "Usulkan PLTS komunal untuk desa tanpa listrik PLN",
      category: "akses_listrik",
      body: `Tercatat ${villages} di ${place} belum mendapat listrik PLN (pernyataan Gubernur yang dikutip media, 2026, belum terverifikasi). Usulkan PLTS komunal dengan baterai untuk desa-desa ini bersama Dinas ESDM Provinsi Kalimantan Timur dan PLN, dimulai dari desa yang paling jauh dari jaringan, dan siapkan BUMDes untuk mengelola serta merawatnya.`,
      impact: `Usulan dengan data desa yang lengkap menjadi dasar bagi PLN dan Dinas ESDM Provinsi untuk menilai PLTS komunal di ${villages} tersebut.`,
      priority: 1,
    });
  }

  if (r.electrificationPct !== null && c.electrificationRank !== null && r.electrificationPct < ACCESS_PCT) {
    items.push({
      title: "Petakan dan usulkan penyambungan rumah tangga tanpa listrik",
      category: "akses_listrik",
      body: `Rasio elektrifikasi ${place} ${dec(r.electrificationPct)}% (BPS 2024), ${rankWords(c.electrificationRank, c.regionCount, "tertinggi", "terendah")} di Kalimantan Timur. Petakan rumah tangga yang belum berlistrik per kecamatan, lalu bersama PLN dan Dinas ESDM Provinsi Kalimantan Timur tentukan cara yang paling murah untuk tiap lokasi: perluasan jaringan PLN, PLTS komunal, atau PLTS rumah dengan baterai.`,
      impact: `Selisih rasio elektrifikasi ke 100% saat ini ${dec(100 - r.electrificationPct)} poin persentase.`,
      priority: r.electrificationPct < LOW_ACCESS_PCT ? 1 : 2,
    });
  }

  const coal = grid.shares.batubara ?? 0;
  items.push({
    title: "Pasang PLTS atap di gedung milik pemerintah daerah",
    category: "energi_terbarukan",
    body: `Batu bara menyumbang ${dec(coal * 100, 0)}% listrik Kalimantan Timur (perkiraan bauran ${grid.year}), dengan faktor emisi ${dec(grid.factorKgPerKwh)} kg CO2 per kWh. Dengan ${psh}, setiap 1 kWp PLTS atap di ${place} menghasilkan sekitar ${fmtNumber(solar.kwhPerKwpYear)} kWh per tahun (perkiraan). Mulailah dari kantor pemerintah, sekolah negeri, dan puskesmas yang atapnya luas dan listriknya banyak dipakai pada siang hari.`,
    impact: `Setiap 1 kWp menghindari sekitar ${fmtKg(solar.co2AvoidedKgPerKwpYear)} CO2 dan menghemat sekitar ${fmtRupiah(solar.savingRpPerKwpYear)} per tahun pada tarif P1 ${tariff} per kWh, dengan balik modal sekitar ${dec(solar.paybackYears, 1)} tahun (perkiraan, biaya pasang ${fmtRupiah(solar.costRpPerKwp)} per kWp).`,
    priority: coal >= COAL_HEAVY_SHARE ? (c.kwhSharePct >= LARGE_USER_PCT ? 1 : 2) : 3,
  });

  if (c.kwhPerCapita !== null && c.kwhPerCapitaAll !== null && c.kwhPerCapitaVsAll === "above") {
    const leftOut = c.kwhPerCapitaLeftOut.length ? `; tanpa ${c.kwhPerCapitaLeftOut.join(", ")}` : "";
    items.push({
      title: "Jalankan program hemat energi di gedung pemerintah",
      category: "efisiensi",
      body: `Konsumsi listrik ${place} sekitar ${fmtNumber(c.kwhPerCapita)} kWh per penduduk per tahun (perkiraan), di atas rata-rata ${c.kwhPerCapitaCount} kabupaten/kota di Kalimantan Timur ${fmtNumber(c.kwhPerCapitaAll)} kWh (perkiraan${leftOut}). Lakukan audit energi di gedung pemerintah yang tagihan listriknya paling besar, ganti lampu ke LED, atur jadwal dan suhu AC, lalu jadikan hasilnya contoh bagi gedung swasta.`,
      impact: `Setiap kWh yang dihemat mengurangi emisi ${dec(grid.factorKgPerKwh)} kg CO2 dan tagihan listrik ${tariff} pada tarif gedung pemerintah (P1).`,
      priority: c.kwhPerCapita >= HIGH_USE_FACTOR * c.kwhPerCapitaAll ? 1 : 2,
    });
  }

  items.push({
    title: "Masukkan potensi surya ke dalam rencana tata ruang",
    category: "tata_ruang",
    body: `Gunakan data potensi surya ${place}, ${psh}, dalam penyusunan atau revisi RTRW dan RDTR. Tetapkan lokasi yang cocok untuk PLTS, dan syaratkan bangunan publik baru siap dipasangi PLTS atap: atap kuat, cukup luas, dan tidak terhalang bayangan.`,
    impact: "Lokasi untuk energi bersih sudah tersedia dalam rencana tata ruang, sehingga pembangunan PLTS lebih cepat dan tidak berbenturan dengan peruntukan lahan lain.",
    priority: 2,
  });

  items.push({
    title: "Tetapkan target listrik bersih dalam RPJMD",
    category: "kebijakan",
    body: `Emisi CO2 dari pemakaian listrik di ${place} sekitar ${fmtCompact(r.co2KgYear / 1000)} ton per tahun (perkiraan). Masukkan target tahunan PLTS atap dan penghematan listrik di gedung pemerintah ke dalam RPJMD dan Renstra perangkat daerah, sediakan anggarannya di APBD, dan laporkan capaiannya setiap tahun.`,
    impact: "Program energi bersih berjalan terukur dan berlanjut setiap tahun, tidak berhenti pada proyek percontohan.",
    priority: 3,
  });

  return items.sort((a, b) => a.priority - b.priority);
}
