import type Anthropic from "@anthropic-ai/sdk";
import { fmtCompact, fmtKg, fmtNumber, fmtRupiah } from "../../shared/format.ts";
import type { FuelType, GridMix, RecommendationCategory, RegionSummary } from "../../shared/types.ts";
import type { RegionPlant } from "../db.ts";
import type { RegionFacts } from "./recommendations.ts";

// Everything Claude reads: the facts message, the system prompt and the tool. Indonesian, id-ID numbers.

export const TOOL_NAME = "save_recommendations";

export const CATEGORIES: readonly RecommendationCategory[] = [
  "energi_terbarukan",
  "efisiensi",
  "tata_ruang",
  "akses_listrik",
  "kebijakan",
];

/** Up to `digits` decimals in id-ID, without trailing zeros: 89,32 and 100. */
export const dec = (n: number, digits = 2) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: digits }).format(n);
export const placeName = (r: Pick<RegionSummary, "kind" | "name">) => `${r.kind === "kota" ? "Kota" : "Kabupaten"} ${r.name}`;

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
export function rankWords(rank: number, count: number, top: string, bottom: string): string {
  const among = `dari ${count} kabupaten/kota`;
  const fromBottom = count - rank + 1;
  if (rank <= 3) return `${top}${rank > 1 ? ` ${ORDINAL[rank]}` : ""} ${among}`;
  if (fromBottom <= 3) return `${bottom}${fromBottom > 1 ? ` ${ORDINAL[fromBottom]}` : ""} ${among}`;
  return `urutan ke-${rank} ${among} bila diurutkan dari yang ${top}`;
}

const VS_ALL = {
  above: "di atas rata-rata",
  below: "di bawah rata-rata",
  similar: "setara dengan rata-rata (selisih kurang dari 5%)",
} as const;

/** Use per person, its rank and the average of the comparable regions, naming any region left out. */
function perCapitaLine(f: RegionFacts): string {
  const c = f.comparison;
  if (c.kwhPerCapita === null) return "- Pemakaian listrik per penduduk: tidak tersedia.";
  const own = `- Pemakaian listrik per penduduk: ${fmtNumber(c.kwhPerCapita)} kWh per tahun (perkiraan)`;
  if (!c.kwhPerCapitaComparable) {
    return `${own}, tetapi tidak layak dibandingkan karena proyeksi penduduk wilayah ini memuat rencana pemindahan IKN.`;
  }
  if (c.kwhPerCapitaRank === null || c.kwhPerCapitaAll === null || c.kwhPerCapitaVsAll === null) return `${own}.`;
  const leftOut = c.kwhPerCapitaLeftOut.length
    ? `; tanpa ${c.kwhPerCapitaLeftOut.join(", ")}, yang proyeksi penduduknya memuat rencana pemindahan IKN`
    : "";
  return `${own}, ${rankWords(c.kwhPerCapitaRank, c.kwhPerCapitaCount, "terbesar", "terkecil")}; rata-rata ${c.kwhPerCapitaCount} kabupaten/kota ${fmtNumber(c.kwhPerCapitaAll)} kWh (perkiraan${leftOut}), jadi ${VS_ALL[c.kwhPerCapitaVsAll]}.`;
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
  lines.push(perCapitaLine(f));
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
    `- PLTS 1 kWp menghasilkan sekitar ${fmtNumber(solar.kwhPerKwpYear)} kWh per tahun (perkiraan).`,
    `- Di kantor pemerintah, yang dipakai sekitar ${fmtNumber(solar.openDaysPerYear)} hari setahun dengan ${fmtNumber(solar.daytimeSharePct)}% pemakaian di siang hari (perkiraan), sekitar ${fmtNumber(solar.selfUsePct)}% listrik panel dipakai sendiri (perkiraan). Sisanya masuk jaringan PLN tanpa imbalan (Permen ESDM 2/2024), jadi tidak menghemat tagihan dan tidak dihitung sebagai CO2 yang dihindari.`,
    `- Dari listrik yang dipakai sendiri itu, 1 kWp di kantor pemerintah menghindari sekitar ${fmtKg(solar.co2AvoidedKgPerKwpYear)} CO2 per tahun (perkiraan, faktor emisi PLTS ${dec(solar.solarFactorKgPerKwh)} kg CO2 per kWh).`,
    `- Biaya pasang sekitar ${fmtRupiah(solar.costRpPerKwp)} per kWp (perkiraan). Dengan tarif gedung pemerintah (golongan P1) Rp ${fmtNumber(solar.govTariffRpPerKwh, 2)} per kWh, 1 kWp di kantor pemerintah menghemat sekitar ${fmtRupiah(solar.savingRpPerKwpYear)} per tahun dan balik modal sekitar ${dec(solar.paybackYears, 1)} tahun tanpa baterai (perkiraan).`,
  );

  lines.push("");
  if (f.plants.length > 0) {
    lines.push(`Pembangkit utama dalam daftar riset yang titik lokasinya berada di wilayah ini (${f.plants.length})`);
    lines.push(...f.plants.map(plantText));
  } else {
    lines.push(
      "Dalam data kami, tidak ada pembangkit utama yang titik lokasinya berada di wilayah ini (daftar riset ini tidak memuat PLTD dan pembangkit kecil).",
    );
  }

  lines.push("", `Tulis 4 atau 5 rekomendasi untuk ${placeName(r)} dan kirim lewat tool ${TOOL_NAME}.`);
  return lines.join("\n");
}

export const SYSTEM_PROMPT = `Anda menyusun rekomendasi pembangunan berkelanjutan dan tata ruang untuk pemerintah daerah di Kalimantan Timur. Pembacanya pejabat pemerintah kabupaten/kota, misalnya di Bappeda dan perangkat daerah teknis, yang membutuhkan langkah nyata yang bisa direncanakan dan dianggarkan.

Tugas: tulis 4 atau 5 rekomendasi untuk satu wilayah dari data wilayah yang dikirim pengguna. Kirim hasilnya dengan memanggil tool ${TOOL_NAME} tepat satu kali, tanpa teks lain.

Aturan isi:
1. Pakai hanya angka yang ada di data. Jangan menambah statistik, target, persentase penghematan, atau skenario seperti "jika pemakaian turun 10%" atau "setiap 100 kWp", dan jangan membuat perkiraan biaya baru. Untuk dampak, pakai hanya satuan yang ada di data: per kWh yang dihemat atau per 1 kWp yang dipasang. Dasar hitungan dampak harus sesuai dengan tindakannya: langkah di gedung milik daerah tidak dihitung dari pemakaian seluruh pelanggan atau seluruh wilayah. Selisih sederhana dari angka di data, misalnya jarak rasio elektrifikasi ke 100% dalam poin persentase, boleh ditulis. CO2 yang dihindari per kWp hanya berlaku bila PLTS menggantikan listrik dari jaringan PLN, jadi jangan dipakai untuk PLTS komunal di desa yang belum berlistrik.
2. Setiap angka yang berasal dari perkiraan, termasuk rata-rata, angka per penduduk, angka per pelanggan, persentase bauran listrik, dan nilai rupiah hasil hitungan, diberi label "perkiraan" dalam kurung setelah angkanya, misalnya "sekitar 1.334 kWh per tahun (perkiraan)".
3. Jangan menyebut nama desa, perusahaan, proyek, program, nomor peraturan, atau keadaan wilayah yang tidak ada di data, misalnya sumber listrik yang dipakai desa sekarang. Jangan menilai kecukupan yang tidak dihitung dari data, misalnya berapa rumah atau desa yang bisa dilayani. Jangan meramalkan pertumbuhan atau perubahan pemakaian listrik, penduduk, atau pembangunan. Instrumen pemerintahan yang umum seperti RPJMD, RTRW, RDTR, APBD, dan BUMDes boleh disebut.
4. Buat rekomendasi khusus untuk wilayah ini. Kaitkan setiap rekomendasi dengan data wilayah: konsumsi dan emisi listrik, elektrifikasi, desa tanpa listrik PLN, pembangkit di wilayah, dan potensi surya. Bandingkan dengan wilayah lain hanya lewat urutan dan rata-rata yang diberikan, dengan kata pembanding yang sama seperti di data. Hindari saran umum yang bisa dipakai di daerah mana saja.
5. "Tidak tersedia" berarti datanya tidak ada, bukan nol. Jangan menarik kesimpulan dari data yang tidak tersedia. Bila menyebut sesuatu yang tidak ada di data, tulis bahwa itu menurut data kami, misalnya "dalam data kami, tidak ada pembangkit utama tercatat di wilayah ini".
6. Untuk pembangkit dengan lokasi perkiraan atau status tidak diketahui, pakai kata hati-hati seperti "tercatat" atau "lokasi perkiraan". Pembangkit yang lokasinya perkiraan dan statusnya tidak diketahui atau masih rencana jangan dijadikan dasar rekomendasi. Pembangkit captive milik industri tidak memasok jaringan PLN. Jangan jadikan pemeriksaan data aplikasi ini, misalnya titik lokasi pembangkit, sebagai rekomendasi, dan jangan membuat rekomendasi yang hanya berisi koordinasi atau pemutakhiran data.
7. Sesuaikan dengan kewenangan daerah. Kabupaten/kota langsung mengurus gedung dan aset milik daerah, rencana tata ruang (RTRW, RDTR), persetujuan bangunan gedung, APBD, dan pembinaan desa. Ketenagalistrikan, termasuk jaringan dan listrik desa, terutama kewenangan pemerintah pusat dan provinsi; untuk urusan itu, tulis langkah kabupaten/kota sebagai pendataan, usulan, dan kerja sama dengan PLN serta Dinas ESDM Provinsi Kalimantan Timur. Judul dan isi memakai kata kerja yang sama: bila isinya usulan kepada PLN atau provinsi, judulnya juga memakai "Usulkan" atau "Ajukan", bukan "Pasang" atau "Bangun".
8. Tulis dalam bahasa Indonesia baku yang lugas: kalimat aktif, langsung ke tindakan, tanpa istilah asing yang tidak perlu. Gunakan format angka Indonesia, misalnya 1.234,5. Untuk kegiatan mendata, tulis "Lakukan pendataan" atau "Petakan"; jangan menulis "Dataan" atau memakai "Data" sebagai kata perintah.
9. Jangan menulis hasil atau peringkat yang akan dicapai, karena tidak ada data yang menjamin hasilnya. Hindari kalimat seperti "mengangkat dari posisi terendah", "menjadikan wilayah ini yang tertinggi", atau "menutup kesenjangan"; tulis tindakannya dan dampak per satuan dari data. Peringkat dan perbandingan hanya boleh menggambarkan keadaan sekarang menurut data.
10. Uraikan daftar pembangkit dengan lengkap dan jujur. Bila rekomendasi menyebut pembangkit di wilayah, sebut semua pembangkit dalam daftar yang relevan, dengan bahan bakar, kapasitas, dan status seperti di data, dan jangan menghilangkan satu pun. Jangan menulis "satu-satunya", "terbesar", atau "tidak ada lagi" kecuali jumlah dan urutannya terlihat jelas dari daftar itu, dan ingat daftar ini tidak memuat PLTD dan pembangkit kecil.

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
- impact: 1 kalimat, paling banyak 25 kata, tentang dampak yang diharapkan; bila memakai angka, pakai angka per kWh atau per 1 kWp dari data.

Keterangan data:
- Listrik terjual per wilayah adalah perkiraan: penjualan cabang PLN tahun 2024 (BPS) dibagi menurut jumlah pelanggan. Di wilayah dengan industri atau tambang besar, selisihnya dengan angka sebenarnya bisa sekitar 30%. Angka Mahakam Ulu dihitung dari asumsi 1.500 kWh per pelanggan.
- Emisi CO2 = listrik terjual × faktor emisi grid resmi 1,14 kg CO2 per kWh (Kepmen ESDM 163.K/HK.02/MEM.S/2021, Sistem Mahakam, data 2019), jadi selalu perkiraan.
- Penduduk adalah proyeksi BPS untuk 2025. Untuk Penajam Paser Utara, proyeksi ini sudah memasukkan rencana pemindahan IKN sehingga jauh di atas jumlah penduduk saat ini; angka per penduduk di sana tidak layak dibandingkan.
- Pelanggan PLN dan rasio elektrifikasi berasal dari BPS (Provinsi Kalimantan Timur Dalam Angka 2025, data 2024).
- Jumlah desa tanpa listrik PLN berasal dari pernyataan Gubernur Kalimantan Timur yang dikutip media (September 2026) dan belum terverifikasi. Jumlah per wilayah hanya ada untuk Kutai Barat dan Mahakam Ulu. Desa tanpa listrik PLN juga ada di Paser, Berau, Kutai Kartanegara, dan Kutai Timur, tetapi jumlahnya tidak tersedia.
- Bauran listrik adalah perkiraan tahun 2024 dari kapasitas pembangkit (Dinas ESDM Kalimantan Timur) dikali faktor kapasitas, dan berlaku untuk seluruh jaringan Kalimantan Timur.
- Jam puncak matahari berasal dari NASA POWER (rata-rata jangka panjang, kWh/m² per hari) di satu titik dalam wilayah. Hasil, biaya, dan balik modal PLTS dihitung dengan rumus aplikasi ini, sama seperti tab Surya untuk gedung pemerintahan, dan semuanya perkiraan. Hanya listrik panel yang dipakai sendiri yang menghemat tagihan dan dihitung sebagai CO2 yang dihindari; angka per kWp sudah memperhitungkannya, jadi jangan menghitung ulang dari hasil per kWp.
- Daftar pembangkit hanya memuat pembangkit utama hasil riset proyek ini, bukan daftar lengkap: PLTD dan pembangkit kecil tidak termasuk. Pembangkit dipetakan ke wilayah menurut titik lokasinya, dan sebagian titik masih perkiraan.`;

export const RECOMMENDATION_TOOL: Anthropic.Tool = {
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
