# Malas Ngoding

Peta 3D interaktif yang menunjukkan dari mana listrik Kalimantan Timur datang, berapa yang dipakai, dan berapa CO2 yang ikut terlepas. Karya tim Malas Ngoding untuk INSEVENT 2026 (Fullstack Web Development Competition, Sistem Informasi Universitas Mulawarman), subtema SDG 7: Integrated Clean Energy Ecosystem.

![Peta 3D Kalimantan Timur: sepuluh wilayah sebagai kolom, tinggi dan warnanya menurut emisi CO2](docs/technical/screens/map.png)

## Apa itu Malas Ngoding

Sebagian besar listrik di Kalimantan Timur berasal dari batu bara (perkiraan kami sekitar dua pertiganya). Warga sulit membayangkan berapa CO2 yang dihasilkan listrik yang mereka pakai, dan apa yang berubah bila gedung memakai panel surya. Malas Ngoding membuat hal itu terlihat: peta 3D yang bisa dijelajahi siapa saja, lengkap dengan sumber dan cara hitung setiap angka, dan dengan rekomendasi untuk pemerintah daerah.

Semua angka per gedung dan per wilayah adalah **perkiraan** hasil model, bukan data meteran. Antarmuka selalu menulis kata "perkiraan" di samping angka itu, dan bagian [Batasan](#batasan) menjelaskan apa yang tidak dilakukan aplikasi.

## Fitur

Fitur bertanda "(diverifikasi ulang di T11b)" bergantung pada bagian kode yang saat draf ini ditulis belum digabung.

- **Peta 3D Kalimantan Timur.** Peta Mapbox Standard dengan medan 3D. Sepuluh kabupaten dan kota berdiri sebagai kolom 3D; tinggi dan warnanya menurut emisi CO2 per tahun atau listrik terpakai (saklar "Tinggi kolom"). Arahkan penunjuk untuk melihat nilainya, klik untuk membuka rincian: penduduk, pelanggan PLN, rasio elektrifikasi, desa yang belum dilayani PLN, dan listrik per orang. Pembukanya animasi kamera dari globe ke Kalimantan Timur.
- **Pembangkit listrik.** Tiga belas pembangkit tampil sebagai titik berwarna menurut bahan bakar dan berukuran menurut MW; pembangkit yang berdekatan digabung menjadi satu penanda berangka. Arahkan penunjuk untuk melihat nama, bahan bakar, dan kapasitasnya; keterangan menampilkan status, dan "Lokasi perkiraan" bila koordinatnya belum pasti (9 dari 13).
- **Cahaya dan hujan.** Cahaya peta mengikuti jam di Kalimantan Timur (fajar, siang, senja, malam) atau dikunci lewat saklar "Cahaya". Saklar "Hujan" menyalakan efek hujan saat peta diperbesar sampai tingkat gedung.
- **Klik gedung mana pun.** Perkiraan listrik per tahun dan per bulan, bauran sumber listrik di baliknya, CO2 per tahun, dan padanan yang mudah dibayangkan (km naik mobil, pohon, charge HP, penerbangan). Jenis gedung dan jumlah lantai bisa diubah dan angkanya dihitung ulang (diverifikasi ulang di T11b).
- **Simulasi panel surya.** Dari luas atap: kapasitas, produksi per tahun, bagian kebutuhan yang tertutup, ukuran baterai, biaya, balik modal, dan CO2 yang dihindari (diverifikasi ulang di T11b).
- **Prakiraan cuaca dan produksi panel.** Prakiraan 7 hari dari Open-Meteo, produksi panel per jam dan per hari, dengan jam dan hari hujan ditandai. Hujan di peta bisa menyala otomatis saat turun hujan di tempat yang dilihat (diverifikasi ulang di T11b).
- **Rekomendasi untuk pemerintah.** Untuk tiap kabupaten dan kota, ditulis Claude dari data wilayahnya, disimpan di database, dan punya cadangan berbasis aturan bila AI tidak tersedia (diverifikasi ulang di T11b).
- **Chat AI yang menggerakkan peta.** Tanyakan sesuatu dalam bahasa Indonesia; jawabannya memakai alat yang membaca data aplikasi, dan peta ikut terbang, memilih gedung, atau mengganti lapisan (diverifikasi ulang di T11b).

Keputusan desain: angka hanya muncul bila punya sumber atau ditandai sebagai asumsi, dan chat tidak boleh mengarang angka (angkanya datang dari alat, bukan dari ingatan model).

![Efek hujan di tingkat gedung, Samarinda](docs/technical/screens/rain.png)

## Teknologi

| Lapisan | Teknologi |
|---|---|
| Runtime dan server | Bun 1.4 (`Bun.serve`, bundler, test runner, `Bun.sql`), TypeScript |
| Basis data | PostgreSQL 17 dan PostGIS 3.5 (Docker) |
| Antarmuka | React 19, HeroUI v3, Zustand, Motion, Tailwind CSS 4 |
| Peta | Mapbox GL JS v3 (gaya Standard, globe, medan 3D, kolom `fill-extrusion`) |
| Data luar | Mapbox Tilequery, NASA POWER, Open-Meteo |
| AI | Anthropic Claude, model `claude-sonnet-5-5` (diverifikasi ulang di T11b) |

Rincian versi, arsitektur, dan alasan pilihan ada di [docs/technical/architecture.md](docs/technical/architecture.md).

## Persyaratan

- [Bun](https://bun.sh) 1.4 atau lebih baru.
- [Docker](https://www.docker.com/) dengan Docker Compose v2 (Docker Desktop atau Docker Engine). Docker menjalankan database.
- Git.
- Peramban modern dengan WebGL aktif (pengujian otomatis memakai Chromium) dan koneksi internet: ubin peta dari Mapbox dan data cuaca dari Open-Meteo tidak tersedia secara luring.
- Port **3000** (aplikasi) dan **5433** (database) harus kosong.
- **Token publik Mapbox** (diawali `pk.`), gratis dari [account.mapbox.com](https://account.mapbox.com/). Tanpa token, peta tidak tampil.
- Kunci API Anthropic bersifat **opsional**: hanya untuk chat AI dan rekomendasi yang ditulis AI (diverifikasi ulang di T11b).

## Instalasi dan menjalankan

1. Ambil kode dan masuk ke foldernya.

   ```
   git clone <alamat-repositori>
   cd malas-ngoding
   ```

2. Buat berkas `.env` dari contohnya, lalu isi `MAPBOX_TOKEN`.

   ```
   cp .env.example .env
   ```

   Di PowerShell: `Copy-Item .env.example .env`. Isi berkas itu:

   | Kunci | Wajib | Keterangan |
   |---|---|---|
   | `MAPBOX_TOKEN` | Ya | Token publik Mapbox (`pk....`). Dikirim ke peramban lewat `/api/config`, jadi **jangan** memakai token rahasia (`sk....`). |
   | `ANTHROPIC_API_KEY` | Tidak | Hanya untuk fitur AI. Tidak pernah dikirim ke peramban. |
   | `DATABASE_URL` | Tidak | Bawaannya sudah cocok dengan Docker Compose di bawah (`postgres://malas:malas@localhost:5433/malas_ngoding`). |
   | `PORT` | Tidak | Port aplikasi, bawaan 3000. |

3. Nyalakan database (PostgreSQL dengan PostGIS di port 5433).

   ```
   docker compose up -d
   ```

4. Pasang dependensi.

   ```
   bun install
   ```

5. Siapkan data: `bun run setup` menunggu database siap, menerapkan migrasi, mengisi data awal (seed), lalu memanaskan cache. Aman dijalankan berulang.

   ```
   bun run setup
   ```

   Keluarannya kira-kira begini:

   ```
   Malas Ngoding: menyiapkan database di localhost:5433
   Database siap.
   [1/3] Migrasi skema database ...
         1 migrasi diterapkan: 001_init.sql
   [2/3] Mengisi data awal (seed) ...
         10 wilayah, 13 pembangkit, 7 baris bauran listrik, 12 jenis bangunan, 5 faktor padanan
   [3/3] Memanaskan cache ...
   Setup selesai dalam 3,6 detik. Berikutnya: jalankan `bun dev`, lalu buka http://localhost:3000
   ```

6. Jalankan aplikasi, lalu buka <http://localhost:3000>.

   ```
   bun dev
   ```

   Intro kamera berjalan sekitar 6 detik dan bisa dilewati dengan tombol "Lewati intro" atau tombol Esc.

### Bila ada masalah

| Gejala | Penyebab dan perbaikan |
|---|---|
| `bun run setup` berhenti dengan "database tidak menjawab" | Docker belum jalan atau database belum siap. Jalankan `docker compose up -d`, tunggu `docker compose ps` menampilkan status healthy, lalu ulangi `bun run setup`. |
| Port 5433 atau 3000 sudah terpakai | Hentikan program yang memakainya, atau ubah `PORT` di `.env`. Untuk 5433, ubah juga pemetaan port di `docker-compose.yml` dan `DATABASE_URL`. |
| Layar menampilkan "Peta belum bisa ditampilkan" | Periksa `MAPBOX_TOKEN` (harus token publik yang valid), koneksi internet, dan WebGL di peramban. Mulai ulang `bun dev` setelah mengubah `.env`, lalu klik "Coba lagi". |
| `setup` mencetak catatan tentang `MAPBOX_TOKEN` | Token kosong, masih contoh dari `.env.example`, atau bukan token publik. |

### Menjalankan sebagai image Docker (opsional)

`Dockerfile` membuat image aplikasi. Caranya ada di [docs/technical/architecture.md](docs/technical/architecture.md#image-docker-aplikasi).

## Menjalankan tes

```
bun test              # tes unit dan API (lebih dari 200 tes)
bun run typecheck     # pemeriksaan tipe TypeScript
bun run smoke         # pemeriksaan peramban otomatis, server harus sudah jalan (bun dev)
```

`bun test` tidak butuh internet. Tes yang membutuhkan database (`tests/server/db.test.ts`) dilewati otomatis bila database belum menyala. `bun run smoke` membuka aplikasi di Chromium milik Playwright (pasang dengan `bunx playwright install chromium` bila belum ada), memeriksa intro, wilayah, pembangkit, hover, klik, saklar, dan hujan, lalu gagal bila ada galat konsol.

## Sumber data dan lisensi

Catatan riset lengkap, termasuk status verifikasi setiap angka, ada di [docs/research/](docs/research/). Data di `data/seed/` ikut repositori, jadi pemasangan tidak mengunduh apa pun selain dependensi.

| Sumber | Dipakai untuk | Lisensi dan atribusi |
|---|---|---|
| [geoBoundaries](https://www.geoboundaries.org/) gbOpen IDN ADM2 (sumber asli: BPS, World Food Programme, OCHA ROAP) | Batas 10 kabupaten dan kota | CC BY 3.0 IGO. Atribusi: geoBoundaries (www.geoboundaries.org); Runfola, D., et al. (2020). geoBoundaries: A global database of political administrative boundaries. *PLoS ONE* 15(4): e0231866. https://doi.org/10.1371/journal.pone.0231866 |
| BPS Kalimantan Timur: *Provinsi Kalimantan Timur Dalam Angka 2025* (tabel 6.1, 6.2, 6.6) dan proyeksi penduduk 2020-2035 | Penjualan listrik PLN per cabang, pelanggan, rasio elektrifikasi, penduduk | Data publik BPS, dikutip dengan menyebut BPS sebagai sumber |
| Kementerian ESDM: Kepmen 163.K/HK.02/MEM.S/2021 (faktor emisi Sistem Mahakam 1,14 t CO2/MWh, data 2019); Laporan Akhir SEC 2021 (intensitas energi gedung); Dinas ESDM Kaltim lewat Satu Data Kaltim (kapasitas pembangkit) | Faktor emisi, intensitas energi, bauran listrik | Dokumen dan data pemerintah, dikutip dengan menyebut sumber |
| IPCC 2006 Guidelines dan kalkulator ICAO (ICEC) | Faktor emisi bahan bakar, padanan penerbangan | Dikutip dengan menyebut sumber |
| [NASA POWER](https://power.larc.nasa.gov/) (Climatology API v2.10.1, diakses 21/10/2026) | Radiasi matahari untuk simulasi surya | Data terbuka. Acknowledgement: "The data was obtained from National Aeronautics and Space Administration (NASA) Langley Research Center's Prediction Of Worldwide Energy Resources (POWER) project funded through the NASA Earth Science Division." |
| [Open-Meteo](https://open-meteo.com/) | Prakiraan cuaca per jam | Data CC BY 4.0. API gratis hanya untuk penggunaan non-komersial. Atribusi: "Weather data by Open-Meteo.com" |
| Mapbox (gaya Standard, medan, Tilequery, dan Mapbox GL JS v3) | Peta dasar, gedung 3D, dan pencarian POI gedung | Syarat layanan Mapbox (Mapbox Terms of Service). Peta menampilkan atribusi Mapbox dan OpenStreetMap |
| [Global Energy Monitor (gem.wiki)](https://www.gem.wiki/) dan sumber berita dan perusahaan | Kapasitas, status, dan koordinat pembangkit | gem.wiki berlisensi CC BY-NC-SA, dan aplikasi ini non-komersial. 9 dari 13 koordinat adalah perkiraan tim dan ditandai `approx` |
| Berita dan blog vendor 2026 (tarif PLN, harga panel dan baterai) | Asumsi biaya dan tarif di simulasi surya | Belum diverifikasi, dicatat sebagai asumsi dan diberi label "perkiraan" |

Perangkat lunak pihak ketiga: Bun, React, HeroUI, Motion, Zustand, dan Tailwind CSS berlisensi MIT; TypeScript dan Playwright berlisensi Apache-2.0; font IBM Plex berlisensi SIL OFL 1.1; Mapbox GL JS v3 berlisensi Mapbox Terms of Service; PostgreSQL dan PostGIS berjalan sebagai layanan Docker terpisah dari image resmi `postgis/postgis`.

## Metodologi singkat

- **Listrik per wilayah** adalah perkiraan: penjualan PLN per cabang (BPS 2024) dibagi ke wilayah menurut jumlah pelanggan, dengan beberapa asumsi yang tertulis di dokumen metodologi. Ketidakpastiannya sekitar 30% untuk wilayah dengan banyak industri.
- **CO2** = kWh × faktor emisi resmi Sistem Mahakam, **1,14 kg CO2/kWh** (data 2019, lebih tinggi dari rata-rata bauran karena berupa *combined margin*). Rincian per sumber memakai bauran listrik 2024 perkiraan kami (batu bara 66%, gas 25%, diesel 7%, surya 1%, biomassa 1%).
- **Gedung:** kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi per jenis gedung. Jenis gedung ditebak dari POI terdekat, atau dari luas bila tidak ada POI.
- **Panel surya:** hasil per kWp = jam puncak matahari (NASA POWER) × 365 × 0,78. Biaya dan tarif memakai asumsi 2026.

Rumus lengkap, tabel konstanta, dan sumbernya ada di bagian *Metodologi perhitungan* pada [docs/technical/architecture.md](docs/technical/architecture.md#metodologi-perhitungan).

## Batasan

- Tidak ada data meteran, IoT, atau sensor. Semua angka per gedung adalah hasil model.
- Angka listrik per wilayah adalah perkiraan hasil pembagian data cabang PLN. Bauran listrik adalah perkiraan dari kapasitas (plus minus sekitar 8 poin persentase).
- Faktor emisi 1,14 adalah angka resmi dari data 2019 dan belum ada edisi yang lebih baru.
- Intensitas energi rumah, ruko, sekolah, kampus, rumah ibadah, gudang, dan industri adalah asumsi. Industri berat tidak terwakili.
- Simulasi surya memakai neraca tahunan dan balik modal sederhana. Harga dan tarif belum diverifikasi.
- Tidak ada akun pengguna dan tidak ada pembatasan laju. Aplikasi ini dirancang untuk demo dan penilaian, bukan layanan publik.

## Dokumentasi teknis

Dokumen berikut menjadi bahan PDF lomba.

| Isi | Lokasi |
|---|---|
| Judul, anggota tim | Bagian Tim di bawah |
| Tech stack, arsitektur, metodologi | [docs/technical/architecture.md](docs/technical/architecture.md) |
| ERD | [docs/technical/erd.md](docs/technical/erd.md) |
| Flowchart dan alur aplikasi | [docs/technical/flows.md](docs/technical/flows.md) |
| Panduan instalasi lokal | Bagian Instalasi di atas |
| Skrip demo langsung | docs/technical/demo-script.md (diverifikasi ulang di T11b) |
| Spesifikasi dan catatan keputusan | [docs/specs/malas-ngoding.md](docs/specs/malas-ngoding.md) |
| Arah visual "Atlas malam" | [docs/research/design/00-direction.md](docs/research/design/00-direction.md) |

## Struktur repositori

```
db/migrations/     skema PostgreSQL dan PostGIS
data/seed/         data awal (JSON dan GeoJSON)
scripts/           setup, migrate, seed, smoke, dan lain-lain
src/shared/        perhitungan murni dan tipe bersama
src/server/        Bun.serve, routes, services, akses database
src/web/           React, peta, panel, gaya
tests/             tes shared, server, web, dan scripts
docs/              spesifikasi, riset, dokumentasi teknis
```

## Tim

<!-- Ganti "Nama Anggota 1..3" dan "Asal Instansi" sebelum dikirim. -->

Tim **Malas Ngoding**, asal instansi: **Asal Instansi**.

| No | Nama | Peran |
|---|---|---|
| 1 | Nama Anggota 1 | (isi peran) |
| 2 | Nama Anggota 2 | (isi peran) |
| 3 | Nama Anggota 3 | (isi peran) |
