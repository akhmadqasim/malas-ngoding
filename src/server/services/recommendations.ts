import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import costs from "../../../data/seed/solar-costs.json";
import { fmtCompact, fmtKg, fmtNumber, fmtRupiah } from "../../shared/format.ts";
import { yieldPerKwpYear } from "../../shared/solar.ts";
import type {
  FuelType,
  GridMix,
  RecommendationCategory,
  RecommendationItem,
  Recommendations,
  RegionSummary,
} from "../../shared/types.ts";
import type { RegionPlant } from "../db.ts";
import type { AppDeps } from "../index.ts";
import { cachedClimatology } from "./cache.ts";
import type { Climatology } from "./nasaPower.ts";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 2048;
/** Per attempt; an answer took 8 to 10 s in testing. The client retries once on a timeout, a 429 or a 5xx. */
const ATTEMPT_TIMEOUT_MS = 45_000;
/** Hard limit for one region's answer, retries included. Routes keep their connection open longer than this. */
export const GENERATION_BUDGET_MS = 100_000;
const TOOL_NAME = "save_recommendations";

const CATEGORIES: readonly RecommendationCategory[] = [
  "energi_terbarukan",
  "efisiensi",
  "tata_ruang",
  "akses_listrik",
  "kebijakan",
];
const MIN_ITEMS = 3;
const MAX_ITEMS = 6;

// --- Facts ---------------------------------------------------------------------------------------

/** Everything the recommendations for one region may use. Every number comes from our data. */
export interface RegionFacts {
  region: RegionSummary;
  /** The region among all kabupaten/kota. Ranks count from the largest value (1 = largest); null without data. */
  comparison: {
    regionCount: number;
    kwhSharePct: number;
    kwhRank: number;
    kwhPerCapita: number | null;
    kwhPerCapitaRank: number | null;
    /** Total kWh over the total population of the regions that have a population. */
    kwhPerCapitaAll: number | null;
    kwhPerCustomer: number | null;
    electrificationRank: number | null;
  };
  /** Plants whose point lies inside the region. */
  plants: RegionPlant[];
  /** Peak sun hours at the region's label point. `fallback` is set when it is the seed assumption. */
  climate: Climatology & { fallback?: string };
  grid: GridMix;
  /** One kWp of rooftop PV on a government building in this region. All estimates. */
  solar: {
    kwhPerKwpYear: number;
    co2AvoidedKgPerKwpYear: number;
    costRpPerKwp: number;
    /** Tariff P1, government buildings of 6,600 VA to 200 kVA. */
    govTariffRpPerKwh: number;
    savingRpPerKwpYear: number;
    paybackYears: number;
  };
}

/** 1 + the number of values above `value`, or null when there is no value. */
function rankOf(value: number | null, values: (number | null)[]): number | null {
  if (value === null) return null;
  return 1 + values.filter((v) => v !== null && v > value).length;
}

const perCapita = (r: RegionSummary): number | null => (r.population ? r.kwhYear / r.population : null);

/** Pure part of `gatherRegionFacts`: derives the comparison and PV figures. Null for an unknown region. */
export function buildRegionFacts(input: {
  regionId: string;
  regions: RegionSummary[];
  plants: RegionPlant[];
  climate: Climatology & { fallback?: string };
  grid: GridMix;
}): RegionFacts | null {
  const { regions, plants, climate, grid } = input;
  const region = regions.find((r) => r.id === input.regionId);
  if (!region) return null;

  const totalKwh = regions.reduce((sum, r) => sum + r.kwhYear, 0);
  const withPeople = regions.filter((r) => r.population);
  const people = withPeople.reduce((sum, r) => sum + (r.population ?? 0), 0);
  const kwhPerKwpYear = yieldPerKwpYear(climate.pshYear);
  const savingRpPerKwpYear = kwhPerKwpYear * costs.tariffs.P1;
  return {
    region,
    comparison: {
      regionCount: regions.length,
      kwhSharePct: totalKwh > 0 ? (region.kwhYear / totalKwh) * 100 : 0,
      kwhRank: 1 + regions.filter((r) => r.kwhYear > region.kwhYear).length,
      kwhPerCapita: perCapita(region),
      kwhPerCapitaRank: rankOf(perCapita(region), regions.map(perCapita)),
      kwhPerCapitaAll: people > 0 ? withPeople.reduce((sum, r) => sum + r.kwhYear, 0) / people : null,
      kwhPerCustomer: region.customers ? region.kwhYear / region.customers : null,
      electrificationRank: rankOf(region.electrificationPct, regions.map((r) => r.electrificationPct)),
    },
    plants,
    climate,
    grid,
    solar: {
      kwhPerKwpYear,
      co2AvoidedKgPerKwpYear: kwhPerKwpYear * grid.factorKgPerKwh,
      costRpPerKwp: costs.costRpPerKwp,
      govTariffRpPerKwh: costs.tariffs.P1,
      savingRpPerKwpYear,
      paybackYears: savingRpPerKwpYear > 0 ? costs.costRpPerKwp / savingRpPerKwpYear : 0,
    },
  };
}

/**
 * Reads the facts for a region: its summary next to all others, the plants inside it, the grid mix and
 * the peak sun hours at its label point (NASA POWER through the cache). Null for an unknown region.
 * Throws on database errors.
 */
export async function gatherRegionFacts(
  deps: Pick<AppDeps, "db" | "nasa">,
  regionId: string,
): Promise<RegionFacts | null> {
  const [regions, plants, point, grid] = await Promise.all([
    deps.db.listRegions(),
    deps.db.plantsInRegion(regionId),
    deps.db.regionLabelPoint(regionId),
    deps.db.getGridMix(),
  ]);
  if (!point || !regions.some((r) => r.id === regionId)) return null;
  const [lng, lat] = point;
  const climate = await cachedClimatology(deps, lat, lng);
  return buildRegionFacts({ regionId, regions, plants, climate, grid });
}

// --- Wording -------------------------------------------------------------------------------------

/** Up to `digits` decimals in id-ID, without trailing zeros: 89,32 and 100. */
const dec = (n: number, digits = 2) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(n);
const placeName = (r: Pick<RegionSummary, "kind" | "name">) => `${r.kind === "kota" ? "Kota" : "Kabupaten"} ${r.name}`;

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const FUEL_LABEL: Record<FuelType, string> = {
  batubara: "batu bara",
  gas: "gas",
  diesel: "diesel",
  surya: "surya",
  air: "air",
  biomassa: "biomassa",
  lainnya: "lainnya",
};
const STATUS_LABEL: Record<string, string> = {
  operating: "beroperasi",
  planned: "masih rencana",
  unknown: "status tidak diketahui",
};

function gridMixText(grid: GridMix): string {
  return (Object.entries(grid.shares) as [FuelType, number][])
    .filter(([, share]) => share > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([fuel, share]) => `${FUEL_LABEL[fuel] ?? fuel} ${dec(share * 100, 0)}%`)
    .join(", ");
}

function plantText(p: RegionPlant): string {
  const parts = [FUEL_LABEL[p.fuel] ?? p.fuel, `${fmtNumber(p.capacityMw)} MW`, STATUS_LABEL[p.status] ?? p.status];
  if (p.approx) parts.push("lokasi perkiraan");
  return `- ${p.name}: ${parts.join(", ")}. Catatan sumber: ${p.source}`;
}

const ORDINAL = ["", "", "kedua", "ketiga"];

/**
 * A rank among `count` kabupaten/kota in words: "terbesar", "tertinggi kedua", "terendah ketiga", or
 * "urutan ke-5 dari 10 kabupaten/kota bila diurutkan dari yang tertinggi" in the middle.
 */
function rankWords(rank: number, count: number, top: string, bottom: string): string {
  const among = `dari ${count} kabupaten/kota`;
  const fromBottom = count - rank + 1;
  if (rank <= 3) return `${top}${rank > 1 ? ` ${ORDINAL[rank]}` : ""} ${among}`;
  if (fromBottom <= 3) return `${bottom}${fromBottom > 1 ? ` ${ORDINAL[fromBottom]}` : ""} ${among}`;
  return `urutan ke-${rank} ${among} bila diurutkan dari yang ${top}`;
}

/** The region's facts as the user message for Claude, in Indonesian with id-ID numbers. */
export function describeRegionFacts(f: RegionFacts): string {
  const { region: r, comparison: c, climate, grid, solar } = f;
  const n = c.regionCount;
  const est = r.estimated ? " (perkiraan)" : "";
  const lines = [`Wilayah: ${placeName(r)}`, "", "Listrik dan emisi"];

  lines.push(
    `- Pemakaian listrik pelanggan PLN 2024 (listrik terjual): ${fmtCompact(r.kwhYear)} kWh${est}, atau ${dec(c.kwhSharePct, 1)}% dari total Kalimantan Timur${est}; ${rankWords(c.kwhRank, n, "terbesar", "terkecil")}.`,
    `- Emisi CO2 dari pemakaian listrik itu: ${fmtCompact(r.co2KgYear / 1000)} ton CO2 per tahun (perkiraan).`,
  );
  if (c.kwhPerCapita !== null && c.kwhPerCapitaRank !== null) {
    const all = c.kwhPerCapitaAll === null ? "" : `; rata-rata Kalimantan Timur ${fmtNumber(c.kwhPerCapitaAll)} kWh (perkiraan)`;
    lines.push(
      `- Pemakaian listrik per penduduk: ${fmtNumber(c.kwhPerCapita)} kWh per tahun (perkiraan), ${rankWords(c.kwhPerCapitaRank, n, "terbesar", "terkecil")}${all}.`,
    );
  } else {
    lines.push("- Pemakaian listrik per penduduk: tidak tersedia.");
  }
  lines.push(r.population === null ? "- Penduduk: tidak tersedia." : `- Penduduk (proyeksi BPS 2025): ${fmtNumber(r.population)} jiwa.`);
  lines.push(
    r.customers === null || c.kwhPerCustomer === null
      ? "- Pelanggan PLN: tidak tersedia."
      : `- Pelanggan PLN 2024 (BPS): ${fmtNumber(r.customers)}, rata-rata ${fmtNumber(c.kwhPerCustomer)} kWh per pelanggan per tahun (perkiraan).`,
  );

  lines.push("", "Akses listrik");
  lines.push(
    r.electrificationPct === null || c.electrificationRank === null
      ? "- Rasio elektrifikasi: tidak tersedia."
      : `- Rasio elektrifikasi 2024 (BPS): ${dec(r.electrificationPct)}%, ${rankWords(c.electrificationRank, n, "tertinggi", "terendah")}.`,
  );
  lines.push(
    r.villagesNoPln === null
      ? "- Desa yang belum mendapat listrik PLN: tidak tersedia."
      : `- Desa yang belum mendapat listrik PLN: ${fmtNumber(r.villagesNoPln)} desa (pernyataan Gubernur yang dikutip media, 2026, belum terverifikasi).`,
  );

  lines.push(
    "",
    "Jaringan listrik Kalimantan Timur (sama untuk semua wilayah)",
    `- Bauran listrik ${grid.year} (perkiraan): ${gridMixText(grid)}.`,
    `- Faktor emisi grid resmi: ${dec(grid.factorKgPerKwh)} kg CO2 per kWh.`,
  );

  lines.push("", "Potensi surya");
  const months = climate.pshByMonth;
  if (climate.fallback) {
    lines.push(`- Data NASA POWER belum tersedia, jadi dipakai asumsi ${fmtNumber(climate.pshYear, 1)} jam puncak matahari per hari (perkiraan).`);
  } else if (months.length === 12) {
    const low = months.indexOf(Math.min(...months));
    const high = months.indexOf(Math.max(...months));
    lines.push(
      `- NASA POWER: rata-rata ${fmtNumber(climate.pshYear, 1)} jam puncak matahari per hari; terendah ${fmtNumber(months[low] ?? 0, 1)} (${MONTHS[low]}), tertinggi ${fmtNumber(months[high] ?? 0, 1)} (${MONTHS[high]}).`,
    );
  } else {
    lines.push(`- NASA POWER: rata-rata ${fmtNumber(climate.pshYear, 1)} jam puncak matahari per hari.`);
  }
  lines.push(
    `- PLTS 1 kWp menghasilkan sekitar ${fmtNumber(solar.kwhPerKwpYear)} kWh per tahun (perkiraan). Bila menggantikan listrik dari jaringan PLN, 1 kWp itu menghindari sekitar ${fmtKg(solar.co2AvoidedKgPerKwpYear)} CO2 per tahun (perkiraan).`,
    `- Biaya pasang sekitar ${fmtRupiah(solar.costRpPerKwp)} per kWp (perkiraan). Dengan tarif gedung pemerintah (golongan P1) Rp ${fmtNumber(solar.govTariffRpPerKwh, 2)} per kWh, 1 kWp menghemat sekitar ${fmtRupiah(solar.savingRpPerKwpYear)} per tahun dan balik modal sekitar ${dec(solar.paybackYears, 1)} tahun (perkiraan).`,
  );

  lines.push("");
  if (f.plants.length > 0) {
    lines.push(`Pembangkit utama dalam daftar riset yang titik lokasinya berada di wilayah ini (${f.plants.length})`);
    lines.push(...f.plants.map(plantText));
  } else {
    lines.push(
      "Tidak ada pembangkit utama dalam daftar riset yang titik lokasinya berada di wilayah ini (daftar ini tidak memuat PLTD dan pembangkit kecil).",
    );
  }

  lines.push("", `Tulis 4 atau 5 rekomendasi untuk ${placeName(r)} dan kirim lewat tool ${TOOL_NAME}.`);
  return lines.join("\n");
}

const SYSTEM_PROMPT = `Anda menyusun rekomendasi pembangunan berkelanjutan dan tata ruang untuk pemerintah daerah di Kalimantan Timur. Pembacanya pejabat pemerintah kabupaten/kota, misalnya di Bappeda dan perangkat daerah teknis, yang membutuhkan langkah nyata yang bisa direncanakan dan dianggarkan.

Tugas: tulis 4 atau 5 rekomendasi untuk satu wilayah dari data wilayah yang dikirim pengguna. Kirim hasilnya dengan memanggil tool ${TOOL_NAME} tepat satu kali, tanpa teks lain.

Aturan isi:
1. Pakai hanya angka yang ada di data. Jangan menambah statistik, target angka, atau perkiraan biaya yang tidak ada di data. Hitungan sederhana dari angka di data boleh, dan hasilnya diberi label "perkiraan".
2. Setiap angka yang berasal dari perkiraan diberi label "perkiraan" dalam kurung setelah angkanya, misalnya "sekitar 1.334 kWh per tahun (perkiraan)", termasuk saat mengutip data yang di sana sudah bertanda perkiraan.
3. Jangan menyebut nama desa, perusahaan, proyek, program, nomor peraturan, atau keadaan wilayah yang tidak ada di data, misalnya sumber listrik yang dipakai desa sekarang. Jangan menilai kecukupan yang tidak dihitung dari data, misalnya berapa rumah atau desa yang bisa dilayani. Instrumen pemerintahan yang umum seperti RPJMD, RTRW, RDTR, APBD, dan BUMDes boleh disebut.
4. Buat rekomendasi khusus untuk wilayah ini. Kaitkan setiap rekomendasi dengan data wilayah: konsumsi dan emisi listrik, elektrifikasi, desa tanpa listrik PLN, pembangkit di wilayah, dan potensi surya. Bandingkan dengan wilayah lain hanya lewat urutan yang diberikan. Hindari saran umum yang bisa dipakai di daerah mana saja.
5. "Tidak tersedia" berarti datanya tidak ada, bukan nol. Jangan menarik kesimpulan dari data yang tidak tersedia.
6. Untuk pembangkit dengan lokasi perkiraan atau status tidak diketahui, pakai kata hati-hati seperti "tercatat" atau "lokasi perkiraan". Pembangkit yang lokasinya perkiraan dan statusnya tidak diketahui atau masih rencana jangan dijadikan dasar rekomendasi. Pembangkit captive milik industri tidak memasok jaringan PLN. Jangan jadikan pemeriksaan data aplikasi ini, misalnya titik lokasi pembangkit, sebagai rekomendasi.
7. Sesuaikan dengan kewenangan daerah. Kabupaten/kota langsung mengurus gedung dan aset milik daerah, rencana tata ruang (RTRW, RDTR), persetujuan bangunan gedung, APBD, dan pembinaan desa. Ketenagalistrikan, termasuk jaringan dan listrik desa, terutama kewenangan pemerintah pusat dan provinsi; untuk urusan itu, tulis langkah kabupaten/kota sebagai pendataan, usulan, dan kerja sama dengan PLN serta Dinas ESDM Provinsi Kalimantan Timur.
8. Tulis dalam bahasa Indonesia baku yang lugas: kalimat aktif, langsung ke tindakan, tanpa istilah asing yang tidak perlu. Gunakan format angka Indonesia, misalnya 1.234,5.

Kategori:
- energi_terbarukan: PLTS atap, PLTS komunal, dan energi terbarukan lain.
- efisiensi: hemat energi di gedung dan fasilitas.
- tata_ruang: penetapan lokasi dan aturan ruang untuk energi bersih dan bangunan.
- akses_listrik: desa dan rumah tangga yang belum berlistrik.
- kebijakan: aturan, anggaran, dan kelembagaan.
Pilih kategori yang paling didukung data wilayah; tidak semua kategori harus muncul.

Prioritas: 1 untuk masalah yang paling mendesak menurut data, 2 untuk langkah penting berikutnya, 3 untuk langkah pendukung. Urutkan dari prioritas 1.

Bentuk setiap rekomendasi (ringkas, karena tampil sebagai kartu):
- title: tindakan singkat, paling banyak 8 kata, misalnya "Pasang PLTS atap di kantor pemerintah".
- body: 2 atau 3 kalimat, paling banyak 50 kata: apa yang dilakukan, di mana atau untuk siapa, dan data yang mendasarinya.
- impact: 1 kalimat, paling banyak 25 kata, tentang dampak yang diharapkan, dengan angka perkiraan bila bisa dihitung dari data.

Keterangan data:
- Listrik terjual per wilayah adalah perkiraan: penjualan cabang PLN tahun 2024 (BPS) dibagi menurut jumlah pelanggan. Di wilayah dengan industri atau tambang besar, selisihnya dengan angka sebenarnya bisa sekitar 30%. Angka Mahakam Ulu dihitung dari asumsi 1.500 kWh per pelanggan.
- Emisi CO2 = listrik terjual × faktor emisi grid resmi 1,14 kg CO2 per kWh (Kepmen ESDM 163.K/HK.02/MEM.S/2021, Sistem Mahakam, data 2019), jadi selalu perkiraan.
- Penduduk adalah proyeksi BPS untuk 2025. Untuk Penajam Paser Utara, proyeksi ini sudah memasukkan rencana pemindahan IKN sehingga jauh di atas jumlah penduduk saat ini; angka per penduduk di sana tidak layak dibandingkan.
- Pelanggan PLN dan rasio elektrifikasi berasal dari BPS (Provinsi Kalimantan Timur Dalam Angka 2025, data 2024).
- Jumlah desa tanpa listrik PLN berasal dari pernyataan Gubernur Kalimantan Timur yang dikutip media (September 2026) dan belum terverifikasi. Jumlah per wilayah hanya ada untuk Kutai Barat dan Mahakam Ulu. Desa tanpa listrik PLN juga ada di Paser, Berau, Kutai Kartanegara, dan Kutai Timur, tetapi jumlahnya tidak tersedia.
- Bauran listrik adalah perkiraan tahun 2024 dari kapasitas pembangkit (Dinas ESDM Kalimantan Timur) dikali faktor kapasitas, dan berlaku untuk seluruh jaringan Kalimantan Timur.
- Jam puncak matahari berasal dari NASA POWER (rata-rata jangka panjang, kWh/m² per hari) di satu titik dalam wilayah. Hasil, biaya, dan balik modal PLTS dihitung dengan rumus aplikasi ini dan semuanya perkiraan.
- Daftar pembangkit hanya memuat pembangkit utama hasil riset proyek ini, bukan daftar lengkap: PLTD dan pembangkit kecil tidak termasuk. Pembangkit dipetakan ke wilayah menurut titik lokasinya, dan sebagian titik masih perkiraan.`;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Menyimpan rekomendasi untuk pemerintah daerah. Panggil tepat satu kali dengan 4 atau 5 rekomendasi, urut dari prioritas 1.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "4 atau 5 rekomendasi, urut dari prioritas 1.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Tindakan singkat, paling banyak 8 kata." },
            category: { type: "string", enum: [...CATEGORIES] },
            body: { type: "string", description: "2 atau 3 kalimat, paling banyak 50 kata: apa, di mana atau untuk siapa, dan data yang mendasarinya." },
            impact: { type: "string", description: "1 kalimat, paling banyak 25 kata; angka perkiraan diberi label perkiraan." },
            priority: { type: "integer", enum: [1, 2, 3], description: "1 paling mendesak, 3 langkah pendukung." },
          },
          required: ["title", "category", "body", "impact", "priority"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

// --- Validation ----------------------------------------------------------------------------------

const isCategory = (v: unknown): v is RecommendationCategory => CATEGORIES.includes(v as RecommendationCategory);
const isPriority = (v: unknown): v is RecommendationItem["priority"] => v === 1 || v === 2 || v === 3;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Items from Claude or the cache, checked: 3 to 6 items, known categories, priority 1 to 3 and non-empty
 * text. Returns them trimmed, with only the known fields, ordered by priority; null when anything is off.
 */
export function parseRecommendationItems(list: unknown): RecommendationItem[] | null {
  if (!Array.isArray(list) || list.length < MIN_ITEMS || list.length > MAX_ITEMS) return null;
  const items: RecommendationItem[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) return null;
    const v = raw as Record<string, unknown>;
    const title = text(v.title);
    const body = text(v.body);
    const impact = text(v.impact);
    if (!title || !body || !impact || !isCategory(v.category) || !isPriority(v.priority)) return null;
    items.push({ title, category: v.category, body, impact, priority: v.priority });
  }
  return items.sort((a, b) => a.priority - b.priority);
}

// --- Rule-based fallback -------------------------------------------------------------------------

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
 * is coal-heavy and the region is a large user), efficiency where use per person is above the Kaltim
 * figure, plus spatial planning and policy. Always 3 to 6 items, ordered by priority.
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
      body: `Tercatat ${villages} di ${place} belum mendapat listrik PLN. Usulkan PLTS komunal dengan baterai untuk desa-desa ini bersama Dinas ESDM Provinsi Kalimantan Timur dan PLN, dimulai dari desa yang paling jauh dari jaringan, dan siapkan BUMDes untuk mengelola serta merawatnya.`,
      impact: `Warga di ${villages} bisa mendapat listrik tanpa menunggu perluasan jaringan PLN.`,
      priority: 1,
    });
  }

  if (r.electrificationPct !== null && c.electrificationRank !== null && r.electrificationPct < ACCESS_PCT) {
    items.push({
      title: "Petakan dan sambungkan rumah tangga yang belum berlistrik",
      category: "akses_listrik",
      body: `Rasio elektrifikasi ${place} ${dec(r.electrificationPct)}% (BPS 2024), ${rankWords(c.electrificationRank, c.regionCount, "tertinggi", "terendah")} di Kalimantan Timur. Petakan rumah tangga yang belum berlistrik per kecamatan, lalu bersama PLN dan Dinas ESDM Provinsi Kalimantan Timur tentukan cara yang paling murah untuk tiap lokasi: perluasan jaringan PLN, PLTS komunal, atau PLTS rumah dengan baterai.`,
      impact: `Menutup selisih ${dec(100 - r.electrificationPct)} poin persentase menuju rasio elektrifikasi 100%.`,
      priority: r.electrificationPct < LOW_ACCESS_PCT ? 1 : 2,
    });
  }

  const coal = grid.shares.batubara ?? 0;
  items.push({
    title: "Pasang PLTS atap di gedung milik pemerintah daerah",
    category: "energi_terbarukan",
    body: `Sebanyak ${dec(coal * 100, 0)}% listrik Kalimantan Timur berasal dari batu bara (perkiraan bauran ${grid.year}), dengan faktor emisi ${dec(grid.factorKgPerKwh)} kg CO2 per kWh. Dengan ${psh}, setiap 1 kWp PLTS atap di ${place} menghasilkan sekitar ${fmtNumber(solar.kwhPerKwpYear)} kWh per tahun (perkiraan). Mulailah dari kantor pemerintah, sekolah negeri, dan puskesmas yang atapnya luas dan listriknya banyak dipakai pada siang hari.`,
    impact: `Setiap 1 kWp menghindari sekitar ${fmtKg(solar.co2AvoidedKgPerKwpYear)} CO2 dan menghemat sekitar ${fmtRupiah(solar.savingRpPerKwpYear)} per tahun pada tarif P1 ${tariff} per kWh, dengan balik modal sekitar ${dec(solar.paybackYears, 1)} tahun (perkiraan, biaya pasang ${fmtRupiah(solar.costRpPerKwp)} per kWp).`,
    priority: coal >= COAL_HEAVY_SHARE ? (c.kwhSharePct >= LARGE_USER_PCT ? 1 : 2) : 3,
  });

  if (c.kwhPerCapita !== null && c.kwhPerCapitaAll !== null && c.kwhPerCapita > c.kwhPerCapitaAll) {
    items.push({
      title: "Jalankan program hemat energi di gedung pemerintah",
      category: "efisiensi",
      body: `Konsumsi listrik ${place} sekitar ${fmtNumber(c.kwhPerCapita)} kWh per penduduk per tahun (perkiraan), di atas rata-rata Kalimantan Timur ${fmtNumber(c.kwhPerCapitaAll)} kWh (perkiraan). Lakukan audit energi di gedung pemerintah yang tagihan listriknya paling besar, ganti lampu ke LED, atur jadwal dan suhu AC, lalu jadikan hasilnya contoh bagi gedung swasta.`,
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

// --- Claude --------------------------------------------------------------------------------------

/** Writes recommendations for a region. Throws on API errors and on answers that fail validation. */
export type RecommendationWriter = (facts: RegionFacts) => Promise<{ items: RecommendationItem[]; model: string }>;

/**
 * One Messages API call per region. The answer comes back as the input of a strict tool call; this model
 * rejects a forced `tool_choice`, so the prompt asks for the call and a missing call counts as a failure.
 */
export function createClaudeRecommender(
  apiKey: string,
  opts: { fetch?: ClientOptions["fetch"]; maxRetries?: number; budgetMs?: number } = {},
): RecommendationWriter {
  const client = new Anthropic({
    apiKey,
    fetch: opts.fetch,
    timeout: ATTEMPT_TIMEOUT_MS,
    maxRetries: opts.maxRetries ?? 1,
  });
  const budgetMs = opts.budgetMs ?? GENERATION_BUDGET_MS;
  return async (facts) => {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Content generation: low effort keeps any thinking short, so the answer fits in max_tokens.
        output_config: { effort: "low" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [TOOL],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: [{ role: "user", content: describeRegionFacts(facts) }],
      },
      { signal: AbortSignal.timeout(budgetMs) },
    );
    if (message.stop_reason !== "tool_use") {
      throw new Error(`Claude stopped with ${message.stop_reason ?? "no stop reason"} instead of calling ${TOOL_NAME}`);
    }
    const call = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
    );
    if (!call) throw new Error(`Claude made no ${TOOL_NAME} call`);
    const input = call.input;
    const items = parseRecommendationItems(
      typeof input === "object" && input !== null ? (input as { items?: unknown }).items : undefined,
    );
    if (!items) throw new Error("Claude's recommendations failed validation");
    return { items, model: message.model };
  };
}

// --- Read-through cache --------------------------------------------------------------------------

type Deps = Pick<AppDeps, "db" | "nasa" | "recommender">;

function warn(what: string, err: unknown): void {
  console.warn(`${what}:`, err instanceof Error ? err.message : "unknown error");
}

async function cachedRecommendations(deps: Deps, regionId: string): Promise<Recommendations | null> {
  try {
    const row = await deps.db.recommendationsGet(regionId);
    const items = row ? parseRecommendationItems(row.items) : null;
    if (row && items) return { regionId, items, model: row.model, generatedAt: row.generatedAt.toISOString() };
  } catch (err) {
    // A broken cache must not break the panel; fall through to a fresh answer.
    warn("recommendations cache read failed", err);
  }
  return null;
}

/**
 * Recommendations for a region: the cached copy, or new ones from Claude (and stored) on a miss or a
 * refresh. When Claude is unavailable or its answer is invalid, a refresh keeps the cached copy and
 * otherwise rule-based items come back with `model: null` (never stored, so the next request retries).
 * Null for an unknown region. Throws only when reading the region's data from the database fails.
 */
export async function recommendationsFor(
  deps: Deps,
  regionId: string,
  opts: { refresh?: boolean } = {},
): Promise<Recommendations | null> {
  const previous = await cachedRecommendations(deps, regionId);
  if (previous && !opts.refresh) return previous;

  const facts = await gatherRegionFacts(deps, regionId);
  if (!facts) return null;

  if (deps.recommender) {
    try {
      const { items, model } = await deps.recommender(facts);
      let generatedAt = new Date();
      // Written with the assumed peak sun hours: serve it, but let the next request retry with NASA data.
      if (!facts.climate.fallback) {
        try {
          generatedAt = await deps.db.recommendationsSet(regionId, items, model);
        } catch (err) {
          warn("recommendations cache write failed", err);
        }
      }
      return { regionId, items, model, generatedAt: generatedAt.toISOString() };
    } catch (err) {
      warn("claude recommendations failed", err);
    }
  }
  return previous ?? { regionId, items: ruleBasedRecommendations(facts), model: null, generatedAt: new Date().toISOString() };
}
