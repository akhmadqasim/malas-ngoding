<!-- Penanda "(diverifikasi ulang di T11b)" menandai bagian yang bergantung pada kode yang belum digabung saat draf ini ditulis (chat AI, rekomendasi, panel gedung, tab surya dan cuaca). Hapus penandanya setelah bagian itu diperiksa terhadap kode akhir. -->

# Arsitektur dan teknologi Malas Ngoding

## Ringkasan

Malas Ngoding adalah satu aplikasi web dengan satu proses server. Server Bun melayani API JSON di bawah `/api/*` dan sekaligus aplikasi React (lewat HTML import milik Bun). Data wilayah, pembangkit, faktor emisi, dan hasil cache disimpan di PostgreSQL dengan ekstensi PostGIS. Layanan luar (Mapbox Tilequery, NASA POWER, Open-Meteo) dipanggil oleh server, lalu hasilnya disimpan di database supaya demo tetap lancar di jaringan lambat. Ubin peta Mapbox dimuat langsung oleh peramban.

Perhitungan (perkiraan gedung, emisi, simulasi surya, prakiraan panel surya) ada di modul murni `src/shared/`. Server dan tes memakai modul yang sama, jadi angka yang tampil di layar sama dengan angka yang diuji.

## Diagram arsitektur

```mermaid
flowchart LR
  subgraph Klien["Peramban"]
    UI["Aplikasi React 19<br/>Zustand dan Motion"]
    GL["Mapbox GL JS v3<br/>peta 3D, medan, hujan"]
  end

  subgraph Server["Server Bun, satu proses"]
    API["Routes /api/*<br/>health, config, regions, plants,<br/>grid, buildings, solar, weather"]
    CHAT["Chat dan rekomendasi<br/>Task 8 dan 10"]
    SVC["Services<br/>cache, tilequery, nasaPower, openMeteo"]
    CALC["Modul hitung bersama<br/>src/shared"]
    DBM["db.ts<br/>Bun.sql"]
  end

  PG[("PostgreSQL 17 dan PostGIS 3.5<br/>Docker, port 5433")]

  subgraph Luar["Layanan luar"]
    MB["Mapbox<br/>gaya Standard, medan 3D, Tilequery"]
    NASA["NASA POWER<br/>iradiasi matahari"]
    OM["Open-Meteo<br/>prakiraan cuaca"]
    AI["Anthropic API<br/>model Claude"]
  end

  UI --> GL
  GL -->|"ubin peta dan gaya"| MB
  UI -->|"fetch JSON"| API
  UI -.->|"SSE"| CHAT
  API --> CALC
  API --> SVC
  API --> DBM
  CHAT -.-> SVC
  CHAT -.-> AI
  SVC --> DBM
  DBM --> PG
  SVC -->|"POI radius 25 m"| MB
  SVC -->|"klimatologi"| NASA
  SVC -->|"prakiraan 7 hari"| OM

  classDef pending stroke-dasharray: 5 4
  class CHAT,AI pending
```

Garis dan kotak putus-putus adalah bagian Task 8 dan 10 (chat AI dan rekomendasi) yang dibangun paralel (diverifikasi ulang di T11b).

Alur satu permintaan: peramban memanggil route, route memeriksa isi permintaan, membaca cache di database, memanggil layanan luar hanya bila cache kosong atau sudah lama, lalu menghitung hasil dengan modul `src/shared` dan menjawab dengan JSON. Flowchart tiap fitur ada di [flows.md](flows.md).

## Teknologi

| Lapisan | Teknologi | Versi | Peran di aplikasi |
|---|---|---|---|
| Runtime | Bun | 1.4.2 (minimal 1.4) | Server HTTP (`Bun.serve`), bundler aplikasi React (HTML import), test runner, driver Postgres (`Bun.sql`), dan skrip |
| Bahasa | TypeScript | 7.0.2 | Seluruh kode, mode `strict` |
| Basis data | PostgreSQL dan PostGIS | 17 dan 3.5 (image `postgis/postgis:17-3.5`) | Wilayah, pembangkit, faktor emisi, cache, kueri spasial |
| Antarmuka | React | 19.3.1 | Panel, legenda, intro |
| Komponen UI | HeroUI v3 (`@heroui/react`, `@heroui/styles`) | 3.2.6 | Kartu panel, tombol, saklar, pilihan tersegmen, toolbar alat peta, tooltip, popover; tema lewat jembatan token `src/web/atlas-theme.css` |
| Peta | Mapbox GL JS | 3.33.0 | Gaya Standard, globe, medan 3D, kolom 3D (`fill-extrusion`), penanda pembangkit, efek hujan, Interactions API |
| Animasi | Motion (`motion/react`) | 14.4.0 | Transisi panel, angka berjalan, meter pada legenda |
| State | Zustand | 5.0.15 | Wilayah terpilih, metrik, lapisan, cahaya, hujan |
| Gaya | Tailwind CSS lewat `bun-plugin-tailwind` | 4.3.3 dan 0.1.2 | Semua nilai desain (warna, ukuran, gerak) ada di blok `@theme` pada `src/web/styles.css` |
| Font | IBM Plex Sans Variable dan IBM Plex Serif (Fontsource) | 5.3.0 | Antarmuka dan angka (Sans), nama tempat (Serif) |
| AI | Anthropic Claude API, model `claude-sonnet-5-5` | belum ada di `package.json` saat draf ini (diverifikasi ulang di T11b) | Chat yang mengendalikan peta dan rekomendasi pemerintah |
| Pengujian | `bun test`, Playwright (hanya untuk skrip smoke dan kontras) | Playwright 1.64.1 | Tes unit dan API, pemeriksaan peramban |
| Kontainer | Docker dan Docker Compose | | Database lokal (`docker-compose.yml`) dan image aplikasi (`Dockerfile`) |

Tidak ada Vite, Express, atau alat khusus Node: Bun menangani semuanya.

## Lapisan dan modul

### Server (`src/server/`)

| Berkas | Tugas |
|---|---|
| `index.ts` | `createServer({ port, deps })` menyusun `Bun.serve`: route API, jawaban 404 JSON untuk `/api/*` yang tidak dikenal, dan aplikasi React untuk semua jalur lain. Dependensi (database, pencarian POI, NASA, Open-Meteo) disuntikkan lewat `AppDeps`, sehingga tes memakai tiruan tanpa jaringan. |
| `routes/*.ts` | Satu berkas per kelompok endpoint: `config`, `regions`, `plants`, `grid`, `buildings`, `solar`, `weather`. Tugasnya memeriksa isi permintaan dan merangkai service dan modul hitung. |
| `services/tilequery.ts` | Mencari POI terdekat (radius 25 m) di Mapbox Tilequery, batas waktu 4 detik. |
| `services/nasaPower.ts` | Mengambil klimatologi radiasi matahari dari NASA POWER, batas waktu 6 detik. |
| `services/openMeteo.ts` | Mengambil prakiraan per jam 7 hari dari Open-Meteo, batas waktu 6 detik. |
| `services/cache.ts` | Membaca dan menulis cache untuk ketiganya, termasuk aturan cadangan saat layanan luar gagal. |
| `db.ts` | Semua kueri SQL dan PostGIS (`Bun.sql`): wilayah, titik ke wilayah, pembangkit, bauran listrik, jenis bangunan, faktor padanan, dan cache. |
| `http.ts` | `json()`, `error()`, dan `safe()`, pembungkus yang mengubah galat tak terduga menjadi jawaban 500 yang ramah. |
| `env.ts` | Membaca `MAPBOX_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, dan `PORT`. |

### Modul hitung bersama (`src/shared/`)

| Berkas | Tugas |
|---|---|
| `estimate.ts` | Menebak jenis gedung (dari POI atau luas), jumlah lantai, listrik per tahun, dan CO2. Membatasi luas dan lantai ke rentang wajar. |
| `emissions.ts` | Memecah CO2 per sumber energi (`co2BySource`) dan menyamakan totalnya dengan faktor emisi resmi. |
| `equivalents.ts` | Mengubah kg CO2 menjadi padanan (km mobil, pohon, dan lain-lain). |
| `solar.ts` | Simulasi panel surya: kWp, produksi, cakupan, baterai, biaya, balik modal, CO2 yang dihindari. |
| `pvForecast.ts` | Mengubah prakiraan cuaca per jam menjadi produksi panel dan ringkasan harian, serta menandai jam dan hari hujan. |
| `regionAlias.ts` | Mengenali nama wilayah yang ditulis longgar ("Kukar", "kota Samarinda", "balikpapan") menjadi id wilayah. |
| `format.ts` | Format angka Indonesia (`id-ID`): `12.345 kWh`, `Rp 23,7 jt`, `1,38 miliar`. |
| `types.ts` | Tipe yang dipakai server dan klien. |

### Klien (`src/web/`)

| Bagian | Tugas |
|---|---|
| `map/MapView.tsx` | Membuat peta Mapbox, memasang medan dan lapisan data, memutar intro, dan menangani kegagalan (token ditolak, WebGL mati, gaya peta gagal, terlalu lama). |
| `map/regionsLayer.ts`, `columns.ts`, `regionLabels.ts` | Kolom 3D per wilayah, animasi tinggi, hover dan klik, dan nama wilayah di atas kolom. |
| `map/plantsLayer.ts`, `fuels.ts` | Titik pembangkit, penanda gabungan untuk pembangkit yang berdekatan, dan keterangannya. |
| `map/effects.ts`, `camera.ts` | Cahaya mengikuti jam WITA, efek hujan, serta gerak kamera (intro, terbang ke wilayah, orbit saat diam). |
| `panels/RegionPanel.tsx` | Panel wilayah di kiri: ringkasan provinsi dengan daftar peringkat, atau rincian satu wilayah. |
| `panels/Legend.tsx`, `MapControls.tsx` | Dua kartu di bawah: legenda (saklar metrik, meter, kunci pembangkit) dan kontrol peta (lapisan, cahaya, hujan). |
| `panels/MapTools.tsx` | Alat peta di kanan bawah: perbesar, perkecil, hadap utara, kembali ke seluruh provinsi, dan "Tentang peta ini". |
| `components/` | Komponen kecil yang dipakai ulang: pilihan tersegmen dan saklar (di atas HeroUI), angka berjalan, CO2 dengan subskrip, intro. |
| `store.ts`, `api.ts` | State aplikasi (Zustand) dan fungsi `fetch` bertipe ke semua endpoint. |
| `theme.ts`, `styles.css`, `atlas-theme.css`, `motion.ts` | Token desain, gaya, jembatan tema HeroUI (`data-theme` siang dan malam), dan nilai gerak. |

## Endpoint API

Semua jalur di bawah `/api/`, tanpa nomor versi. Galat selalu berbentuk `{ "error": "pesan dalam bahasa Indonesia" }` dengan kode status yang sesuai.

| Metode dan jalur | Fungsi | Isi permintaan | Jawaban | Galat |
|---|---|---|---|---|
| `GET /api/health` | Cek server hidup | | `{ ok: true, name: "Malas Ngoding" }` | |
| `GET /api/config` | Token Mapbox publik untuk peta | | `{ mapboxToken }` | |
| `GET /api/regions` | Batas 10 wilayah dan angkanya | | GeoJSON `FeatureCollection`; tiap fitur berisi ringkasan wilayah dan titik label | 500 |
| `GET /api/regions/:id` | Satu wilayah | | Ringkasan wilayah dan `centroid` | 404 bila id tidak dikenal |
| `GET /api/plants` | Pembangkit | | GeoJSON titik: nama, bahan bakar, MW, status, `approx` | 500 |
| `GET /api/grid` | Bauran listrik dan faktor emisi tahun terbaru | | `GridMix` | 500 |
| `POST /api/buildings/estimate` | Perkiraan satu gedung | `featureId`, `lng`, `lat`, `footprintM2`, `heightM`, opsional `poiClass`, `poiType`, `typeOverride`, `floorsOverride` | `BuildingEstimate` | 400 bila isian tidak valid |
| `POST /api/solar/simulate` | Simulasi panel surya | `lat`, `lng`, `roofAreaM2`, `kwhYear`, `backupHours` | Hasil simulasi, `peakSunHours`, `pshByMonth`, `assumptions` | 400 bila isian tidak valid |
| `GET /api/weather?lat=&lng=&kWp=` | Prakiraan 7 hari dan produksi panel | | `{ hours, days, current, stale }` | 400 bila isian tidak valid; 503 bila tidak ada prakiraan sama sekali |
| `/api/*` lainnya | | | | 404 "Endpoint tidak ditemukan" |
| `POST /api/chat` | Chat AI dengan streaming SSE (diverifikasi ulang di T11b) | `sessionId`, `message`, `context` | Peristiwa `text`, `action`, `done`, `error` | 400 bila isian tidak valid |
| `GET /api/recommendations/:regionId` | Rekomendasi untuk pemerintah daerah (diverifikasi ulang di T11b) | | Daftar rekomendasi, `model`, `generatedAt` | 404 bila id tidak dikenal |
| `POST /api/recommendations/:regionId/refresh` | Membuat ulang rekomendasi (diverifikasi ulang di T11b) | | Sama seperti di atas | 404 bila id tidak dikenal |

Batas isian yang diperiksa server: `lat` -90 sampai 90 dan `lng` -180 sampai 180; `featureId` teks 1 sampai 200 karakter; `poiClass` dan `poiType` paling panjang 100 karakter; `typeOverride` salah satu dari 12 jenis; `roofAreaM2` dan `kwhYear` harus lebih dari 0 (atap dibatasi 50.000 m²); `backupHours` 0 atau lebih (dibatasi 72 jam); `kWp` 0 atau lebih.

## Layanan luar, cache, dan cadangan

Panggilan data ke layanan luar (Tilequery, NASA POWER, Open-Meteo) dilakukan oleh server, dengan batas waktu, dan hasilnya disimpan di PostgreSQL. Hanya ubin, gaya, dan medan peta yang dimuat langsung oleh peramban dari Mapbox. Pesan galat dari layanan luar tidak pernah memuat alamat permintaan, jadi token tidak bocor ke log.

| Data | Sumber | Tabel cache | Kunci | Masa berlaku | Bila sumber gagal |
|---|---|---|---|---|---|
| POI terdekat gedung | Mapbox Tilequery, radius 25 m, lapisan `poi_label` | `poi_cache` | `lng,lat` 5 desimal (sekitar 1 m) | Tidak kedaluwarsa. Hasil "tidak ada POI" juga disimpan. | Perkiraan tetap dibuat dengan jenis tebakan dari luas lantai dasar. Hasil itu tidak disimpan, jadi pencarian diulang pada permintaan berikutnya. |
| Radiasi matahari | NASA POWER, klimatologi 25 tahun (`ALLSKY_SFC_SW_DWN`) | `solar_climatology` | `lat,lng` dibulatkan 0,1 derajat | Tidak kedaluwarsa | Dipakai nilai cadangan 4,2 jam puncak matahari per hari, dengan catatan "perkiraan" di daftar asumsi. Nilai ini tidak disimpan. |
| Prakiraan cuaca | Open-Meteo, per jam, 7 hari, zona Asia/Makassar | `weather_cache` | `lat,lng` dibulatkan 0,05 derajat (sekitar 5 km) | Segar 1 jam | Prakiraan lama tetap dipakai dan ditandai `stale: true`. Tanpa cache sama sekali: jawaban 503 dengan pesan ramah. |
| Perkiraan gedung | Hasil hitungan | `building_estimates` | id gedung, pilihan pengguna, luas dasar (dibulatkan), kelas POI | Tidak kedaluwarsa | Tidak disimpan bila pencarian POI gagal. |

Bila cache di database sendiri gagal dibaca atau ditulis, server mencatat peringatan di log dan tetap menjawab permintaan.

### Ketahanan: skenario dan perilaku

| Skenario | Perilaku |
|---|---|
| Gedung tanpa POI di dekatnya, atau Tilequery gagal | Jenis ditebak dari luas lantai dasar: di bawah 250 m² rumah, di bawah 2.000 m² ruko, selebihnya gudang. Daftar asumsi mencatatnya. |
| NASA POWER atau Open-Meteo lambat atau mati | Cache dipakai bila ada. Bila tidak, nilai cadangan atau pesan ramah (lihat tabel di atas). Panel tidak pernah kosong dan tidak ada promise yang tidak tertangani. |
| Titik yang diklik di luar Kalimantan Timur | `region` bernilai `null`, daftar asumsi menulis "Lokasi di luar Kalimantan Timur, dipakai faktor emisi jaringan listrik Kalimantan Timur.", dan perkiraan tetap dibuat. Panel gedung yang menampilkannya dibangun di Task 7 (diverifikasi ulang di T11b). |
| Luas lantai dasar ekstrem | Dijepit ke 10 sampai 50.000 m² dan lantai ke 1 sampai 40. Tidak ada `NaN` atau angka tak masuk akal. |
| Nama wilayah ditulis longgar | `resolveRegion` mengenali "Kukar", "kubar", "kutim", "ppu", "mahulu", "kota Samarinda", "balikpapan", dan sejenisnya. |
| Token Mapbox salah, WebGL mati, gaya peta gagal, atau peta lebih dari 15 detik tidak siap | Kartu "Peta belum bisa ditampilkan" dengan pesan yang menjelaskan sebabnya dan tombol "Coba lagi". |
| Permintaan ke server gagal atau jawabannya bukan JSON | Klien melempar `ApiError` dengan pesan bahasa Indonesia, bukan layar kosong. |

## Keamanan

- **Rahasia.** `.env` tidak ikut git (`.gitignore`) dan tidak ikut image Docker (`.dockerignore`). `.env.example` hanya berisi nama kunci dan nilai contoh.
- **Token Mapbox.** `/api/config` mengirim token Mapbox ke peramban. Token itu harus token publik (diawali `pk.`), yang memang dirancang untuk dipakai di peramban dan bisa dibatasi per alamat situs di dashboard Mapbox. `bun run setup` memperingatkan bila token kosong atau bukan `pk.`.
- **Kunci Anthropic.** Hanya dipakai di server dan tidak pernah dikirim ke peramban (diverifikasi ulang di T11b).
- **SQL.** Semua nilai masuk lewat parameter `Bun.sql` (tagged template), tidak lewat penyambungan teks. Nama tabel cache berasal dari daftar tetap di `db.ts`, bukan dari masukan pengguna.
- **Validasi.** Setiap isi permintaan diperiksa tipe dan rentangnya sebelum dipakai (lihat batas di bagian endpoint). Isi yang tidak valid dijawab 400, bukan diproses.
- **Galat server.** `safe()` mencatat jalur dan pesan singkat di log server, lalu menjawab 500 dengan kalimat umum. Rincian galat tidak dikirim ke klien.
- **Tanpa akun.** Aplikasi tidak punya login dan tidak meminta data pribadi. Riwayat chat disimpan per sesi anonim (UUID acak di `localStorage`) (diverifikasi ulang di T11b).
- **Yang belum ada.** Tidak ada pembatasan laju (rate limit) dan tidak ada login. Aplikasi ini dirancang untuk demo dan penilaian lokal, bukan layanan publik dengan banyak pengguna.

## Peta 3D: cara kerjanya

- **Gaya dasar.** `mapbox://styles/mapbox/standard` dengan proyeksi globe, label berbahasa Indonesia, dan medan 3D dari `mapbox.mapbox-terrain-dem-v1` (pembesaran 1,4 kali). Basemap memakai tema `monochrome` pada siang, fajar, dan senja, dan `faded` pada malam.
- **Kolom wilayah.** `/api/regions` dimuat sebagai sumber GeoJSON dan digambar sebagai lapisan `fill-extrusion`. Tinggi kolom adalah akar kuadrat dari nilai terhadap nilai terbesar (antara 4 km dan 75 km di tampilan provinsi), supaya wilayah kecil seperti Mahakam Ulu tetap terlihat dan Samarinda tidak menenggelamkan yang lain. Tinggi dan warna disimpan di `feature-state`, jadi animasi hanya mengubah buffer cat dan tidak membuat ulang ubin.
- **Warna.** Satu rona per metrik dalam enam tingkat: amber (kuning kecokelatan, warna pembakaran) untuk emisi CO2 dan teal (hijau kebiruan) untuk listrik. Dua deret warna dipilih menurut warna tanah peta (terang atau gelap), supaya nilai tertinggi selalu paling kontras. Kontras kolom terhadap tanah diukur dari hasil render dengan `bun run contrast` dan nilai terendahnya 3,2:1.
- **Interaksi.** Memakai `map.addInteraction`. Hover mengangkat kolom 12 persen dan meredupkan kolom lain, meter di legenda berayun ke nilai wilayah itu, dan tooltip mengikuti penunjuk. Klik memilih wilayah: kolom lain meredup dan memendek, kamera terbang 2 detik, dan panel kiri berganti ke rincian wilayah.
- **Dari kolom ke gedung.** Kolom memendek mulai pembesaran 6,6 dan hilang di pembesaran 12, saat gedung Mapbox Standard mengambil alih.
- **Pembangkit.** Lapisan simbol dengan ikon kanvas diam: titik berwarna bahan bakar dengan tepi kertas dan tepi tinta tipis. Ukuran mengikuti akar kuadrat MW. Pembangkit yang berjarak kurang dari 18 piksel di layar digabung menjadi satu penanda berangka (clustering sumber GeoJSON), berukuran menurut jumlah MW-nya; tooltip-nya mendaftar semua pembangkit di dalamnya, dan klik memperbesar peta. Tooltip satu pembangkit menampilkan nama, bahan bakar, kapasitas, status, serta "Lokasi perkiraan" bila `approx`.
- **Cahaya.** Preset cahaya Standard mengikuti jam WITA (UTC+8, tanpa waktu musim panas): fajar 05.00 sampai 07.00, siang 07.00 sampai 17.00, senja 17.00 sampai 19.00, selebihnya malam. Saklar "Cahaya" (Otomatis, Siang, Malam) dan parameter `?cahaya=day|dawn|dusk|night` bisa mengunci cahaya.
- **Hujan.** Saklar "Hujan" menyalakan `map.setRain` dengan garis hujan tipis. Efek baru terlihat mulai pembesaran 15 (tingkat gedung) dan penuh di 16,5. Pada peta terang, kabut tipis di dalam peta ikut menyala supaya garis hujan terlihat. Hujan otomatis dari prakiraan cuaca dibangun di Task 9 (diverifikasi ulang di T11b).
- **Intro.** Kamera terbang 6 detik dari globe ke Kalimantan Timur, dan kolom tumbuh dari barat ke timur saat kamera mendekat. Intro bisa dilewati (tombol, Esc, spasi, Enter, atau gerakan apa pun di peta). Setelah 20 detik tanpa masukan, kamera berputar pelan, hanya di tampilan provinsi (di bawah pembesaran 11).
- **Aksesibilitas gerak.** Bila sistem meminta gerak dikurangi (`prefers-reduced-motion`), kamera melompat, angka langsung menampilkan nilai akhir, dan denyut serta orbit mati.
- **Arah visual.** "Atlas malam": panel padat bertepi garis tipis tanpa kaca atau cahaya, warna hanya untuk data. Aturan lengkapnya ada di `docs/research/design/00-direction.md`, dan `tests/web/tokens.test.ts` memastikan tidak ada nilai desain di luar blok `@theme`.

## Metodologi perhitungan

Prinsipnya: setiap angka punya sumber atau ditandai sebagai asumsi, dan setiap angka perkiraan diberi kata "perkiraan" di antarmuka. Catatan riset beserta status verifikasinya ada di `docs/research/` (berkas `gaps-filled.md` adalah yang paling lengkap). Setiap baris data seed punya kolom `source`, dan nilai tanpa sumber ditulis `asumsi`.

### 1. Listrik terpakai per wilayah

Tidak ada tabel resmi listrik per kabupaten. BPS hanya menerbitkan penjualan PLN per cabang (Tabel 6.1, *Provinsi Kalimantan Timur Dalam Angka 2025*, data 2024), dan cabang tidak sama dengan batas kabupaten. Karena itu angka wilayah adalah perkiraan hasil pembagian:

1. Total tiap cabang PLN (Samarinda, Balikpapan, Berau, Bontang) dibagi ke wilayah yang dilayaninya menurut jumlah pelanggan PLN 2024 (BPS Tabel 6.2).
2. Samarinda memakai angka tabel BPS Kota Samarinda, 1.380,7 juta kWh. Tahunnya diasumsikan 2024 dan angkanya baru terlihat sebagai cuplikan pencarian, jadi belum diverifikasi penuh.
3. Kutai Kartanegara dilayani tiga cabang. Pelanggannya dibagi 60% ke cabang Samarinda, 25% ke Balikpapan, dan 15% ke Bontang (asumsi, tidak ada data).
4. Mahakam Ulu memakai 7.071 pelanggan dikali 1.500 kWh per pelanggan per tahun (asumsi: pedalaman, rumah kecil).
5. Cabang Berau juga melayani Malinau di Kalimantan Utara. Dengan asumsi 25.000 pelanggan Malinau, Berau mendapat 78% dari cabang itu.

Hasilnya (kolom CO2 memakai faktor 1,14 kg/kWh):

| Wilayah | Listrik (juta kWh per tahun) | CO2 (ribu ton per tahun) |
|---|---|---|
| Samarinda | 1.380,7 | 1.574 |
| Kutai Kartanegara | 1.195,5 | 1.363 |
| Balikpapan | 967,8 | 1.103 |
| Kutai Timur | 460,1 | 525 |
| Paser | 346,4 | 395 |
| Kutai Barat | 330,8 | 377 |
| Bontang | 256,0 | 292 |
| Penajam Paser Utara | 236,2 | 269 |
| Berau | 209,5 | 239 |
| Mahakam Ulu | 10,6 | 12 |
| **Jumlah** | **5.393,6** | **6.149** |

Jumlahnya sama dengan total empat cabang (5.452,2 juta kWh) dikurangi bagian Malinau. Pembagian menurut pelanggan mengabaikan industri, jadi wilayah dengan tambang dan pabrik (Bontang, Kutai Timur, Kutai Barat) paling tidak pasti, kira-kira plus minus 30%. Semua baris `regions` bertanda `estimated = true`. Jumlah pelanggan dan rasio elektrifikasi diambil langsung dari tabel BPS, dan jumlah penduduk dari proyeksi penduduk BPS 2025 (angka proyeksi, bukan hasil sensus).

### 2. Faktor emisi dan CO2

- **Faktor emisi jaringan: 1,14 kg CO2 per kWh.** Ini faktor resmi Sistem Mahakam (Kalimantan Timur) dari lampiran Kepmen ESDM 163.K/HK.02/MEM.S/2021, baris 73, nilai *combined margin* (bobot 0,5 operating margin dan 0,5 build margin). Datanya tahun 2019 dan kami belum menemukan edisi yang lebih baru.
- **Kenapa lebih tinggi dari rata-rata bauran.** *Combined margin* mengukur emisi pembangkit yang berubah ketika listrik dihemat atau digantikan, dan dipakai untuk menghitung pengurangan emisi. Rata-rata tertimbang bauran kami lebih rendah, sekitar 0,87 kg per kWh dibangkitkan (sekitar 0,94 per kWh terjual setelah pemakaian sendiri dan susut). Aplikasi memakai angka resmi 1,14 dan menyebutnya "faktor emisi resmi".
- **CO2 wilayah** = `kwh_year` × 1,14. Tidak disimpan, dihitung saat dibaca (`src/server/db.ts`).
- **CO2 gedung** = kWh per tahun × 1,14.

### 3. Bauran listrik dan rincian per sumber

Tidak ada bauran pembangkitan per bahan bakar yang dipublikasikan untuk Kalimantan Timur 2024, jadi bauran dalam seed adalah perkiraan:

- Dasarnya kapasitas terpasang 2024 (Dinas ESDM Kaltim, Satu Data Kaltim): PLTU 833 MW, PLTG 430 MW, PLTD 203 MW, PLTS komunal 4 MW, ditambah PLTS IKN 50 MWp.
- Kapasitas dikali faktor kapasitas asumsi (batubara 0,70, gas 0,50, diesel 0,30, surya 0,15), lalu satu poin batubara dipindahkan ke biomassa (ko-firing 5% di PLTU Teluk Balikpapan) dan hasilnya dibulatkan.
- Hasil: batubara 66%, gas 25%, diesel 7%, surya 1%, biomassa 1%, air 0%. Anggap plus minus 8 poin persentase; bagian batubara kemungkinan sedikit lebih tinggi dari angka ini.

Faktor emisi per bahan bakar (kg CO2 per kWh listrik): batubara 1,04, gas 0,53, diesel 0,75, surya, air, dan biomassa 0. Nilainya dari faktor bawaan IPCC 2006 (batubara sub-bituminus, gas alam, minyak diesel) dibagi asumsi efisiensi pembangkit (sekitar 33% batubara, 38% gas, 36% diesel) dan dibulatkan. CO2 biogenik biomassa dihitung 0 sesuai aturan inventaris IPCC.

Rincian per sumber pada satu gedung (`co2BySource`): kWh × porsi × faktor bahan bakar, lalu seluruhnya diskalakan supaya jumlahnya tepat sama dengan kWh × 1,14. Jadi **porsinya** berasal dari bauran dan faktor bahan bakar (di data ini sekitar 79% batubara, 15% gas, 6% diesel), sedangkan **totalnya** berasal dari angka resmi. Listrik jaringan bercampur, jadi aplikasi menunjukkan bauran di balik listrik gedung dan tidak menunjuk satu pembangkit tertentu.

### 4. Perkiraan satu gedung

`kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi jenis gedung`

- **Luas lantai dasar** dihitung di klien dari poligon gedung di peta (luas geodesik) (diverifikasi ulang di T11b), lalu server menjepitnya ke 10 sampai 50.000 m².
- **Jenis gedung.** Data gedung Mapbox hanya berisi tipe `building` dan tinggi bawaan 3 m, jadi jenis ditentukan dari POI terdekat (radius 25 m) di lapisan `poi_label`. Pemetaannya:

| Kelas POI (tipe) | Jenis gedung |
|---|---|
| `education` (`school`) | sekolah |
| `education` (`college`, `university`) | kampus |
| `medical` (`hospital`, `clinic`) | rumah_sakit |
| `lodging` | hotel |
| `store_like` (`mall`, `department store`) | mal |
| `store_like` (lainnya), `food_and_drink` | ruko |
| `commercial_services` (`office`) | kantor |
| `commercial_services` (lainnya) | ruko |
| `general` (`government`) | pemerintahan |
| `general` (`office`) | kantor |
| `religion` | ibadah |
| `industrial` | industri |
| tidak ada POI yang cocok | dari luas lantai dasar: di bawah 250 m² rumah, di bawah 2.000 m² ruko, selebihnya gudang |

- **Jumlah lantai.** Bila peta punya tinggi nyata (lebih dari 3 m): tinggi ÷ 3,5 m dibulatkan. Bila tidak: jumlah lantai umum untuk jenis itu. Hasilnya dijepit ke 1 sampai 40 lantai. Tinggi lantai 3,5 m adalah asumsi kerja.
- **Pilihan pengguna.** Jenis dan jumlah lantai bisa diubah pengguna di panel gedung, dan angkanya dihitung ulang (diverifikasi ulang di T11b).
- **Intensitas energi** (kWh per m² lantai per tahun):

| Jenis | Intensitas | Lantai umum | Dasar |
|---|---|---|---|
| rumah | 35 | 1 | Perkiraan dari konsumsi rumah tangga 900 sampai 1.300 VA |
| ruko | 110 | 3 | Perkiraan: sekitar setengah rata-rata bangunan komersial |
| kantor | 181 | 4 | Survei ESDM SEC 2021, rata-rata kantor 180,95 |
| pemerintahan | 130 | 2 | Perkiraan: sekitar 70% kantor swasta |
| sekolah | 35 | 2 | Perkiraan: kipas dan lampu, sedikit ruang ber-AC |
| kampus | 85 | 3 | Perkiraan dari pengukuran fakultas teknik Undip (84,71) |
| rumah_sakit | 181 | 4 | Survei ESDM SEC 2021, rata-rata 180,81 |
| hotel | 208 | 6 | Survei ESDM SEC 2021, rata-rata 208,15 |
| mal | 287 | 3 | Survei ESDM SEC 2021, rata-rata 286,54 |
| ibadah | 30 | 1 | Perkiraan: lampu, kipas, pengeras suara |
| gudang | 25 | 1 | Perkiraan: lampu dan kipas |
| industri | 120 | 1 | Perkiraan: industri ringan saja |

  Jumlah lantai umum dan semua baris "Perkiraan" adalah asumsi tim (`source` berisi "Estimate"). Industri berat butuh data meteran sendiri, dan angka di atas tidak mewakilinya.

### 5. Padanan CO2

Padanan adalah kg CO2 dibagi faktor per satuan, supaya angka kilogram mudah dibayangkan:

| Padanan | kg CO2 per satuan | Keterangan |
|---|---|---|
| km naik mobil | 0,19 | Rata-rata mobil baru 190 g/km (sumber sekunder, belum diverifikasi) |
| km naik motor | 0,05 | Perkiraan: 2,31 kg CO2 per liter ÷ 45 km per liter |
| pohon menyerap setahun | 22 | Angka yang sering dikutip, dengan rentang 10 sampai 40 (diperdebatkan) |
| kali charge HP | 0,017 | Perkiraan: 15 Wh × 1,14 kg/kWh |
| penerbangan Jakarta ke Balikpapan | 111,1 | Kalkulator ICAO ICEC (ekonomi, sekali jalan, 1.255 km), dicek 21 Oktober 2026 |

### 6. Simulasi panel surya

Masukan API: luas atap, konsumsi listrik gedung per tahun, jam cadangan baterai, dan lokasi. Di panel gedung, luas atap diisi awal dengan luas lantai dasar (diverifikasi ulang di T11b). Konstanta di `src/shared/solar.ts` adalah asumsi teknis umum untuk PLTS atap, bukan hasil pengukuran gedung ini.

| Langkah | Rumus |
|---|---|
| Jam puncak matahari (PSH) | Rata-rata tahunan `ALLSKY_SFC_SW_DWN` dari NASA POWER di titik gedung (kWh/m²/hari) |
| Hasil per kWp per tahun | PSH × 365 × 0,78 (rasio kinerja 0,78) |
| Kapasitas maksimum atap | luas atap × 0,6 (bagian atap yang bisa dipakai) ÷ 5,5 m² per kWp |
| Kapasitas yang dipasang (kWp) | yang terkecil antara kebutuhan (konsumsi ÷ hasil per kWp, dibulatkan naik ke 0,5) dan maksimum atap (dibulatkan turun ke 0,5) |
| Jumlah panel | kWp ÷ 0,55 kWp per panel, dibulatkan naik |
| Produksi per tahun | kWp × hasil per kWp |
| Cakupan kebutuhan | min(produksi, konsumsi) ÷ konsumsi |
| Baterai (kWh) | konsumsi ÷ 365 ÷ 24 × jam cadangan ÷ 0,9 (efisiensi baterai) |
| Biaya | kWp × Rp 15.000.000 + baterai × Rp 2.500.000 |
| Penghematan per tahun | min(produksi, konsumsi) × Rp 1.444,70 per kWh (tarif R-1 1300 VA) |
| Balik modal | biaya ÷ penghematan per tahun |
| CO2 dihindari | min(produksi, konsumsi) × 1,14 |

Harga panel, baterai, dan tarif berasal dari berita dan blog vendor 2026 yang belum diverifikasi, jadi hasilnya berlabel "perkiraan" dan API ikut mengirim daftar asumsinya (tarif, harga, dan catatan cadangan). Batasan yang perlu diketahui:

- Perhitungan memakai neraca tahunan: seluruh energi surya dianggap menggantikan listrik jaringan sampai sebesar konsumsi. Perbedaan jam produksi dan jam pemakaian tidak dimodelkan.
- Balik modal adalah balik modal sederhana, tanpa penurunan kinerja panel, bunga, kenaikan tarif, atau penggantian baterai.
- Bila NASA POWER tidak terjangkau dan belum ada cache, PSH diganti 4,2 jam per hari dan hal itu dicatat di daftar asumsi.

### 7. Prakiraan produksi panel dan hujan

- Open-Meteo memberi radiasi (`shortwave_radiation`, W/m²), tutupan awan, curah hujan, dan kode cuaca WMO per jam selama 7 hari dalam waktu Asia/Makassar.
- Produksi per jam = kWp × radiasi ÷ 1.000 × 0,78. Radiasi horizontal dipakai sebagai pendekatan, tanpa kemiringan panel dan tanpa pengaruh suhu. Mendung dan hujan menurunkan hasilnya lewat nilai radiasi itu sendiri.
- Satu jam dianggap hujan bila curahnya 0,1 mm atau lebih, atau kode cuacanya hujan (51 sampai 67, 80 sampai 82, 95 sampai 99). Satu hari dianggap hujan bila ada jam dengan 0,5 mm atau lebih, atau kode hujan.
- Kondisi saat ini diambil dari jam prakiraan terdekat dengan waktu sekarang. Dianggap siang bila radiasi jam itu lebih dari 0.

### 8. Batas yang perlu diketahui pembaca

- Tidak ada data meteran. Semua angka per gedung adalah hasil model dan diberi kata "perkiraan".
- Angka wilayah adalah perkiraan hasil pembagian data cabang PLN, dengan ketidakpastian sekitar 30% untuk wilayah industri.
- Bauran listrik adalah perkiraan dari kapasitas, plus minus 8 poin persentase. Faktor emisi 1,14 adalah angka resmi tahun 2019.
- Sembilan dari 13 pembangkit punya koordinat perkiraan (ditandai di peta). Pembangkit captive (AlamTri, NALCO) dan beberapa lainnya belum terverifikasi dan ditandai statusnya.
- Intensitas energi untuk rumah, ruko, sekolah, kampus, rumah ibadah, gudang, dan industri adalah asumsi.

## Konfigurasi dan menjalankan

### Variabel lingkungan (`.env`)

| Kunci | Wajib | Fungsi |
|---|---|---|
| `MAPBOX_TOKEN` | Ya, untuk peta | Token publik Mapbox (diawali `pk.`). Dikirim ke peramban lewat `/api/config`. |
| `ANTHROPIC_API_KEY` | Tidak | Kunci Anthropic untuk chat AI dan rekomendasi. Tanpa kunci, fitur itu tidak aktif dan rekomendasi memakai aturan bawaan (diverifikasi ulang di T11b). |
| `DATABASE_URL` | Tidak | Bawaan `postgres://malas:malas@localhost:5433/malas_ngoding`. |
| `PORT` | Tidak | Port server, bawaan 3000. |

### Perintah

| Perintah | Fungsi |
|---|---|
| `docker compose up -d` | Menyalakan PostgreSQL dan PostGIS di port 5433 |
| `bun install` | Memasang dependensi |
| `bun run setup` | Menunggu database siap, lalu migrasi, seed, dan pemanasan cache. Aman diulang. |
| `bun run migrate`, `bun run seed`, `bun run warm` | Tiap langkah setup secara terpisah (`warm` diverifikasi ulang di T11b) |
| `bun dev` | Server dengan hot reload di `http://localhost:3000` |
| `bun start` | Server tanpa hot reload |
| `bun test` | Seluruh tes |
| `bun run typecheck` | Pemeriksaan tipe TypeScript |
| `bun run smoke` | Pemeriksaan peramban otomatis (server harus sudah jalan) |
| `bun run contrast` | Mengukur kontras warna kolom dari hasil render |
| `bun scripts/build-boundaries.ts` | Membangun ulang `data/seed/regions.geojson` dari geoBoundaries |

Database memakai port 5433 di komputer Anda supaya tidak bentrok dengan PostgreSQL lain yang biasanya memakai 5432. Data tersimpan di volume Docker `malas_ngoding_pg`.

### Image Docker aplikasi

`Dockerfile` membuat image dari `oven/bun:1.4.2`: memasang dependensi produksi (`bun install --production`), menyalin kode, menetapkan `NODE_ENV=production`, dan menjalankan `bun run start` sebagai pengguna `bun` (bukan root). Image tidak berisi rahasia dan tidak berisi database: berikan isi `.env` saat menjalankannya, dan arahkan `DATABASE_URL` ke host database (di dalam kontainer, `localhost` adalah kontainer itu sendiri).

```
docker build -t malas-ngoding .
docker run --rm -p 3000:3000 --env-file .env -e PORT=3000 -e DATABASE_URL=postgres://malas:malas@host.docker.internal:5433/malas_ngoding malas-ngoding
```

Nilai `-e` menimpa nilai yang sama dari `--env-file`. `host.docker.internal` dikenali oleh Docker Desktop (Windows dan macOS). Di Linux, tambahkan `--add-host=host.docker.internal:host-gateway` pada perintah `docker run`.

Image ini disiapkan agar aplikasi siap di-deploy. Belum ada deploy.

## Pengujian

- **`bun test`** menjalankan tes unit dan API. Tes modul hitung (`tests/shared/`) memeriksa rumus dan batas ekstrem. Tes API (`tests/server/`) memakai dependensi tiruan (`tests/server/fakes.ts`), jadi tidak butuh internet. `tests/server/db.test.ts` berjalan terhadap PostGIS sungguhan dan dilewati dengan peringatan bila database belum menyala. Tes klien (`tests/web/`) memeriksa logika peta, cahaya, hujan, label wilayah, dan token desain.
- **`bun run smoke`** membuka aplikasi di Chromium (Playwright), memutar intro, lalu memeriksa kolom wilayah, penanda pembangkit dan tooltip-nya, tata letak panel, nama wilayah selama ayunan kamera, hover, klik, saklar metrik, pilihan dari daftar (tetikus dan papan ketik), alat peta, atribusi Mapbox, hujan di pembesaran gedung, saklar cahaya, dan kartu "Coba lagi". Skrip gagal bila ada pemeriksaan yang tidak lolos, galat konsol, atau peringatan konsol (peringatan dari Mapbox sendiri didaftar, tidak disembunyikan).
- **`bun run contrast`** mengukur rasio kontras WCAG tiap warna kolom terhadap tanah peta dari piksel hasil render (garis tepi, penanda pembangkit, dan nama wilayah disembunyikan saat mengukur).
- **`bun run typecheck`** menjalankan `tsc --noEmit` pada `src`, `tests`, dan `scripts`.

## Struktur direktori

```
.
|-- Dockerfile, .dockerignore, docker-compose.yml
|-- package.json, bun.lock, bunfig.toml, tsconfig.json
|-- .env.example
|-- db/migrations/001_init.sql          skema PostgreSQL dan PostGIS
|-- data/seed/                          data awal (JSON dan GeoJSON), ikut repositori
|-- scripts/                            setup, migrate, seed, build-boundaries, smoke, contrast
|-- src/
|   |-- shared/                         perhitungan murni dan tipe bersama
|   |-- server/                         Bun.serve, routes, services, db
|   `-- web/                            React, peta, panel, gaya
|-- tests/                              shared, server, web, scripts
`-- docs/
    |-- specs/                          spesifikasi dan catatan keputusan
    |-- research/                       catatan riset dan sumber, arah visual
    `-- technical/                      dokumen ini, erd.md, flows.md, tangkapan layar
```
