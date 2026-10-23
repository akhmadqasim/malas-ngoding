# Arsitektur dan teknologi Malas Ngoding

## Ringkasan

Malas Ngoding adalah satu aplikasi web dengan satu proses server. Server Bun melayani API JSON di bawah `/api/*` dan sekaligus aplikasi React (lewat HTML import milik Bun). Data wilayah, pembangkit, faktor emisi, dan hasil cache disimpan di PostgreSQL dengan ekstensi PostGIS. Layanan data luar (Mapbox Tilequery dan Search Box, NASA POWER, Open-Meteo) dipanggil oleh server, dan hasil yang mahal diambil disimpan di database supaya demo tetap lancar di jaringan lambat. Asisten AI dan rekomendasi untuk pemerintah memanggil Anthropic API dari server, jadi kunci Anthropic tidak pernah sampai ke browser. Ubin peta Mapbox dimuat langsung oleh browser.

Perhitungan (perkiraan gedung, emisi, padanan, simulasi surya, prakiraan panel surya) ada di modul murni `src/shared/`. Server dan tes memakai modul yang sama, jadi angka yang tampil di layar sama dengan angka yang diuji.

## Diagram arsitektur

```mermaid
flowchart LR
  subgraph Klien["Browser"]
    UI["Aplikasi React 19<br/>Zustand dan Motion"]
    GL["Mapbox GL JS v3<br/>peta 3D, medan, hujan"]
  end

  subgraph Server["Server Bun, satu proses"]
    API["Routes /api/*<br/>health, config, regions, plants, grid,<br/>buildings, solar, weather, recommendations"]
    CHAT["Route chat<br/>SSE, loop alat, aksi peta"]
    SVC["Services<br/>cache, tilequery, nasaPower, openMeteo,<br/>placeSearch, solarTariff, recommendations"]
    CALC["Modul hitung bersama<br/>src/shared"]
    DBM["db.ts<br/>Bun.sql"]
  end

  PG[("PostgreSQL 17 dan PostGIS 3.5<br/>Docker, port 5433")]

  subgraph Luar["Layanan luar"]
    MB["Mapbox<br/>gaya Standard, medan 3D,<br/>Tilequery, Search Box"]
    NASA["NASA POWER<br/>iradiasi matahari"]
    OM["Open-Meteo<br/>prakiraan cuaca"]
    AI["Anthropic API<br/>model Claude"]
  end

  UI --> GL
  GL -->|"ubin peta dan gaya"| MB
  UI -->|"fetch JSON"| API
  UI -->|"SSE"| CHAT
  API --> CALC
  API --> SVC
  API --> DBM
  CHAT --> SVC
  CHAT --> CALC
  CHAT --> DBM
  CHAT -->|"stream, alat"| AI
  SVC -->|"rekomendasi"| AI
  SVC --> DBM
  DBM --> PG
  SVC -->|"POI radius 25 m, pencarian tempat"| MB
  SVC -->|"klimatologi"| NASA
  SVC -->|"prakiraan 7 hari"| OM
```

Dua jalur memakai Anthropic API: chat (`POST /api/chat`, streaming, dengan loop alat) dan rekomendasi (satu panggilan per wilayah). Keduanya berjalan di server. Tanpa `ANTHROPIC_API_KEY` chat mati dengan pesan yang jelas, dan rekomendasi memakai aturan bawaan.

Alur satu permintaan: browser memanggil route, route memeriksa isi permintaan, membaca cache di database, memanggil layanan luar hanya bila cache kosong atau sudah lama, lalu menghitung hasil dengan modul `src/shared` dan menjawab dengan JSON. Flowchart tiap fitur ada di [flows.md](flows.md).

## Teknologi

| Lapisan | Teknologi | Versi | Peran di aplikasi |
|---|---|---|---|
| Runtime | Bun | 1.4.2 (minimal 1.4) | Server HTTP (`Bun.serve`), bundler aplikasi React (HTML import), test runner, driver Postgres (`Bun.sql`), dan skrip |
| Bahasa | TypeScript | 7.0.2 | Seluruh kode, mode `strict` |
| Basis data | PostgreSQL dan PostGIS | 17 dan 3.5 (image `postgis/postgis:17-3.5`) | Wilayah, pembangkit, faktor emisi, cache, kueri spasial |
| Antarmuka | React | 19.3.1 | Panel, legenda, intro |
| Komponen UI | HeroUI v3 (`@heroui/react`, `@heroui/styles`) | 3.2.6 | Kartu panel, tombol, saklar, pilihan tersegmen, tab panel gedung, daftar pilihan jenis gedung, kolom angka dan slider (simulasi surya), akordeon rekomendasi, lembar samping metodologi (Drawer), toolbar alat peta, tooltip, popover; tema lewat jembatan token `src/web/atlas-theme.css` |
| Peta | Mapbox GL JS | 3.33.0 | Gaya Standard, globe, medan 3D, kolom 3D (`fill-extrusion`), penanda pembangkit, gedung yang bisa diklik (Interactions API), efek hujan |
| Animasi | Motion (`motion/react`) | 14.4.0 | Transisi panel, angka berjalan, meter pada legenda |
| State | Zustand | 5.0.15 | Wilayah dan gedung terpilih, tab panel, metrik, lapisan, cahaya, hujan, status chat |
| Gaya | Tailwind CSS lewat `bun-plugin-tailwind` | 4.3.3 dan 0.1.2 | Semua nilai desain (warna, ukuran, gerak) ada di blok `@theme` pada `src/web/styles.css` |
| Font dan ikon | Font sistem bawaan HeroUI (SF, Segoe UI), ikon `@gravity-ui/icons` | 2.23.0 | Semua teks antarmuka dan angka (tanpa font web); ikon alat peta, chat, dan ikon langit di tab Cuaca |
| AI | Anthropic Claude API lewat `@anthropic-ai/sdk`, model `claude-sonnet-5-5` | SDK 0.137.0 | Chat yang mengendalikan peta (streaming, alat data dan alat peta) dan rekomendasi pemerintah |
| Pengujian | `bun test`, Playwright (hanya untuk skrip smoke dan kontras) | Playwright 1.64.1 | Tes unit dan API, pemeriksaan browser |
| Kontainer | Docker dan Docker Compose | | Database lokal (`docker-compose.yml`) dan image aplikasi (`Dockerfile`) |

Tidak ada Vite, Express, atau alat khusus Node: Bun menangani semuanya.

## Lapisan dan modul

### Server (`src/server/`)

| Berkas | Tugas |
|---|---|
| `index.ts` | `createServer({ port, deps })` menyusun `Bun.serve`: route API, jawaban 404 JSON untuk `/api/*` yang tidak dikenal, dan aplikasi React untuk semua jalur lain. Dependensi (database, pencarian POI, NASA, Open-Meteo, pencarian tempat, model chat, penulis rekomendasi) disuntikkan lewat `AppDeps`, sehingga tes memakai tiruan tanpa jaringan. Server produksi (`bun start`, `NODE_ENV=production`) mematikan hot reload dan gema konsol browser. |
| `routes/*.ts` | Satu berkas per kelompok endpoint: `config`, `regions`, `plants`, `grid`, `buildings`, `solar`, `weather`, `chat`, `recommendations`. Tugasnya memeriksa isi permintaan dan merangkai service dan modul hitung. `chat.ts` juga membuka aliran SSE dan menyimpan riwayat. |
| `services/tilequery.ts` | Mencari POI terdekat (radius 25 m) di Mapbox Tilequery, batas waktu 4 detik. |
| `services/nasaPower.ts` | Mengambil klimatologi radiasi matahari dari NASA POWER, batas waktu 6 detik. |
| `services/openMeteo.ts` | Mengambil prakiraan per jam 7 hari dari Open-Meteo, batas waktu 6 detik. |
| `services/cache.ts` | Membaca dan menulis cache untuk ketiganya, termasuk aturan cadangan saat layanan luar gagal. |
| `services/solarTariff.ts` | Memilih golongan tarif PLN, porsi pemakaian siang, dan hari pakai per tahun menurut jenis gedung, beserta kalimat asumsinya. Nilainya dari `data/seed/solar-costs.json`. |
| `services/claude.ts` | Chat: prompt sistem, keadaan aplikasi, loop alat (paling banyak 8 panggilan model), pesan galat berbahasa Indonesia. Tanpa kunci API, model chat dibuat dalam keadaan mati. |
| `services/chatTools.ts`, `services/chatTools/` | Delapan alat data (`list_regions`, `get_region_stats`, `get_grid_mix`, `get_recommendations`, `estimate_building_at`, `simulate_solar`, `get_weather`, `find_places`) dan delapan aksi peta (`fly_to_region`, `show_all_regions`, `fly_to`, `select_building_at`, `toggle_layer`, `set_metric`, `set_rain`, `open_tab`) beserta pemeriksaan isinya. `placeSearch.ts` memanggil Mapbox Search Box. |
| `services/recommendations.ts`, `recommendationPrompt.ts`, `recommendationRules.ts` | Fakta wilayah, satu panggilan Claude per wilayah, pemeriksaan hasil, cache baca-tulis, dan cadangan berbasis aturan. |
| `db.ts` | Semua kueri SQL dan PostGIS (`Bun.sql`): wilayah, titik ke wilayah, pembangkit, bauran listrik, jenis bangunan, faktor padanan, dan cache. |
| `http.ts` | `json()`, `error()`, dan `safe()`, pembungkus yang mengubah galat tak terduga menjadi jawaban 500 yang ramah. |
| `env.ts` | Membaca `MAPBOX_TOKEN`, `ANTHROPIC_API_KEY` (kosong bila tidak diisi), `DATABASE_URL`, dan `PORT`. |

### Modul hitung bersama (`src/shared/`)

| Berkas | Tugas |
|---|---|
| `estimate.ts` | Menebak jenis gedung (dari POI atau luas), jumlah lantai, listrik per tahun, dan CO2. Membatasi luas dan lantai ke rentang wajar. |
| `emissions.ts` | Memecah CO2 per sumber energi (`co2BySource`) dan menyamakan totalnya dengan faktor emisi resmi. |
| `equivalents.ts` | Mengubah kg CO2 menjadi padanan (km mobil, pohon, dan lain-lain). |
| `solar.ts` | Simulasi panel surya: jumlah panel utuh, produksi, pemakaian langsung dan ke jaringan, cakupan, baterai, biaya, balik modal, CO2 yang dihindari. Menghitung per jenis hari (hari pakai dan hari libur). |
| `pvForecast.ts` | Mengubah prakiraan cuaca per jam menjadi produksi panel dan ringkasan harian, menandai jam hujan, dan membandingkan tiap hari dengan produksi di bawah langit cerah (model Haurwitz). Dipakai tab Cuaca dan chat. |
| `regionAlias.ts` | Mengenali nama wilayah yang ditulis longgar ("Kukar", "kota Samarinda", "balikpapan") menjadi id wilayah. |
| `format.ts` | Format angka Indonesia (`id-ID`): `12.345 kWh`, `Rp 23,7 jt`, `1,38 miliar`. |
| `types.ts` | Tipe yang dipakai server dan klien. |

### Klien (`src/web/`)

| Bagian | Tugas |
|---|---|
| `map/MapView.tsx` | Membuat peta Mapbox, memasang medan dan lapisan data, memutar intro, dan menangani kegagalan (token ditolak, WebGL mati, gaya peta gagal, terlalu lama). |
| `map/regionsLayer.ts`, `columns.ts`, `regionLabels.ts` | Kolom 3D per wilayah, animasi tinggi, hover dan klik, dan nama wilayah di atas kolom. |
| `map/plantsLayer.ts`, `plantGroups.ts`, `fuels.ts` | Pin pembangkit yang berdiri di puncak kolom wilayahnya (satu lapisan pin per kolom, ikut naik turun bersama kolom), pin berangka untuk pembangkit yang berdekatan, dan keterangannya. |
| `map/effects.ts`, `camera.ts` | Cahaya mengikuti jam WITA, efek hujan, serta gerak kamera (intro, terbang ke wilayah, orbit saat diam). |
| `map/buildings.ts` | Gedung yang bisa diklik lewat `map.addInteraction`: luas dasar dari poligon, titik tengah, pilihan dan sorotan gedung, medan dimatikan di pembesaran tinggi, dan pemilihan gedung di satu titik untuk chat. |
| `map/autoRain.ts` | Hujan otomatis: membaca cuaca di pusat peta (saat mulai, setelah kamera pindah jauh, tiap 10 menit) dan menyalakan efek hujan bila sedang hujan. |
| `map/actions.ts` | Menjalankan aksi peta dari chat (terbang, pilih gedung, ganti lapisan, metrik, hujan, tab) lewat store dan kamera, dan melaporkan hasilnya (berhasil, gagal, dilewati). |
| `panels/RegionPanel.tsx` | Panel wilayah di kiri: ringkasan provinsi dengan daftar peringkat, atau rincian satu wilayah, dengan kartu rekomendasi di bawahnya. |
| `panels/BuildingPanel.tsx`, `EnergyTab.tsx`, `EmissionTab.tsx`, `SolarTab.tsx`, `WeatherTab.tsx` | Panel gedung di kanan: jenis gedung dan jumlah lantai yang bisa diubah, angka listrik, dan empat tab (Energi, Emisi, Surya, Cuaca). `solarWeather.ts` dan `tabParts.tsx` memuat pembantu murni dan bagian bersama tab Surya dan Cuaca. |
| `panels/RecommendationPanel.tsx` | Kartu "Rekomendasi untuk Pemkab atau Pemkot": daftar bertingkat prioritas, asal teks (AI atau aturan), pemuatan dan galat. |
| `panels/MethodologyPanel.tsx` | Lembar samping "Cara menghitung dan sumber data" (dibuka dari "Tentang peta ini"): rumus, tabel faktor dengan baris asumsi bertanda, dan semua sumber dengan lisensinya. |
| `chat/` | Panel chat: `useChat.ts` (percakapan di `localStorage`, kirim pertanyaan, hentikan, ulangi), `sse.ts` (membaca aliran), `ChatPanel.tsx`, `actionLabels.ts` (tombol aksi di bawah jawaban), `placesLayer.ts` (penanda tempat hasil `find_places`), dan `markdown.tsx` (Markdown ringan). |
| `panels/Dock.tsx`, `Legend.tsx`, `MapControls.tsx` | Dok di bawah. Selalu tampil: kartu legenda (saklar "Tinggi kolom" dan meter). Di balik tombol "Lapisan dan tampilan" (HeroUI Disclosure, tertutup di awal sesi, keadaannya diingat selama sesi): kartu kontrol peta (lapisan Wilayah dan Pembangkit dengan kunci bahan bakar di bawahnya, Cahaya, Hujan), yang terbuka di samping legenda. |
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
| `GET /api/equivalents` | Faktor padanan CO2 (km mobil, km motor, pohon, charge HP, penerbangan) | | Daftar `EquivalentFactor`: `key`, `label`, `kgCo2PerUnit`, `unit` | 500 |
| `POST /api/buildings/estimate` | Perkiraan satu gedung | `featureId`, `lng`, `lat`, `footprintM2`, `heightM`, opsional `poiClass`, `poiType`, `typeOverride`, `floorsOverride`, `typeHint` | `BuildingEstimate` | 400 bila isian tidak valid |
| `POST /api/solar/simulate` | Simulasi panel surya | `lat`, `lng`, `roofAreaM2`, `kwhYear`, `backupHours`, opsional `buildingType` | Hasil simulasi, `peakSunHours`, `pshByMonth`, `assumptions` | 400 bila isian tidak valid |
| `GET /api/weather?lat=&lng=&kWp=` | Prakiraan 7 hari dan produksi panel | | `{ hours, days, current, stale }` | 400 bila isian tidak valid; 503 bila tidak ada prakiraan sama sekali |
| `GET /api/chat/status` | Apakah asisten AI aktif (ada kunci yang sah) | | `{ enabled: boolean }` | |
| `POST /api/chat` | Chat AI dengan streaming SSE | `sessionId` (UUID), `message` (1 sampai 2.000 karakter), `context` (`selectedRegionId`, `selectedBuilding`, `selectedBuildingAt`, `view`) | Peristiwa `text`, `action`, `done`, `error` | 400 bila isian tidak valid |
| `GET /api/recommendations/:regionId` | Rekomendasi untuk pemerintah daerah | | `{ regionId, items, model, generatedAt }`; `model` kosong untuk rekomendasi berbasis aturan | 404 bila id tidak dikenal |
| `POST /api/recommendations/:regionId/refresh` | Membuat ulang rekomendasi dengan Claude (salinan lama tetap dipakai bila gagal) | | Sama seperti di atas | 404 bila id tidak dikenal |
| `/api/*` lainnya | | | | 404 "Endpoint tidak ditemukan" |

Batas isian yang diperiksa server: `lat` -90 sampai 90 dan `lng` -180 sampai 180; `featureId` teks 1 sampai 200 karakter; `poiClass` dan `poiType` paling panjang 100 karakter; `typeOverride`, `typeHint`, dan `buildingType` salah satu dari 12 jenis; `roofAreaM2` dan `kwhYear` harus lebih dari 0 (atap dibatasi 50.000 m²); `backupHours` 0 atau lebih (dibatasi 72 jam); `kWp` 0 atau lebih. Untuk chat: `sessionId` harus UUID, `message` 1 sampai 2.000 karakter, dan `context.view` berisi `center` dan `zoom` yang valid.

## Layanan luar, cache, dan cadangan

Panggilan data ke layanan luar (Tilequery, Search Box, NASA POWER, Open-Meteo, Anthropic) dilakukan oleh server, dengan batas waktu. Hasil NASA POWER, Open-Meteo, dan Tilequery disimpan di PostgreSQL. Hanya ubin, gaya, dan medan peta yang dimuat langsung oleh browser dari Mapbox. Pesan galat dari layanan luar tidak pernah memuat alamat permintaan, jadi token tidak bocor ke log.

| Data | Sumber | Tabel cache | Kunci | Masa berlaku | Bila sumber gagal |
|---|---|---|---|---|---|
| POI terdekat gedung | Mapbox Tilequery, radius 25 m, lapisan `poi_label` | `poi_cache` | `lng,lat` 5 desimal (sekitar 1 m) | Tidak kedaluwarsa. Hasil "tidak ada POI" juga disimpan. | Perkiraan tetap dibuat dengan jenis tebakan dari luas lantai dasar. Hasil itu tidak disimpan, jadi pencarian diulang pada permintaan berikutnya. |
| Radiasi matahari | NASA POWER, klimatologi 25 tahun (`ALLSKY_SFC_SW_DWN`) | `solar_climatology` | `lat,lng` dibulatkan 0,1 derajat | Tidak kedaluwarsa | Dipakai nilai cadangan 4,2 jam puncak matahari per hari, dengan catatan "perkiraan" di daftar asumsi. Nilai ini tidak disimpan. |
| Prakiraan cuaca | Open-Meteo, per jam, 7 hari, zona Asia/Makassar | `weather_cache` | `lat,lng` dibulatkan 0,05 derajat (sekitar 5 km) | Segar 1 jam | Prakiraan lama tetap dipakai dan ditandai `stale: true`. Tanpa cache sama sekali: jawaban 503 dengan pesan ramah. |
| Perkiraan gedung | Hasil hitungan | `building_estimates` | versi, id gedung, pilihan pengguna, luas dasar (dibulatkan), kelas POI, petunjuk jenis | Tidak kedaluwarsa | Tidak disimpan bila pencarian POI gagal. |
| Rekomendasi pemerintah | Claude, dari data wilayah | `recommendations` | id wilayah | Tidak kedaluwarsa; `bun run warm -- --refresh` menulis ulang | Rekomendasi berbasis aturan (`model` kosong), tidak disimpan. Salinan lama dipertahankan saat pembaruan gagal. Hasil yang ditulis dengan jam matahari cadangan juga tidak disimpan. |
| Pencarian tempat (chat) | Mapbox Search Box, kategori, hanya Kalimantan Timur | Memori server, bukan database | kategori dan titik (dibulatkan sekitar 100 m) | 1 jam, paling banyak 200 entri | Alat memberi tahu Claude bahwa pencarian sedang tidak bisa dipakai, dan chat menyampaikannya. |
| Riwayat chat | Percakapan pengguna | `chat_sessions`, `chat_messages` | id sesi (UUID) | Tidak kedaluwarsa | Bila database gagal, chat tetap menjawab tanpa riwayat. |

Bila cache di database sendiri gagal dibaca atau ditulis, server mencatat peringatan di log dan tetap menjawab permintaan.

### Ketahanan: skenario dan perilaku

| Skenario | Perilaku |
|---|---|
| Gedung tanpa POI di dekatnya, atau Tilequery gagal | Jenis ditebak dari luas lantai dasar: di bawah 250 m² rumah, di bawah 2.000 m² ruko, selebihnya gudang. Daftar asumsi mencatatnya. |
| NASA POWER atau Open-Meteo lambat atau mati | Cache dipakai bila ada. Bila tidak, nilai cadangan atau pesan ramah (lihat tabel di atas). Panel tidak pernah kosong dan tidak ada promise yang tidak tertangani. |
| Titik yang diklik di luar Kalimantan Timur | `region` bernilai `null`, daftar asumsi menulis "Lokasi di luar Kalimantan Timur, dipakai faktor emisi jaringan listrik Kalimantan Timur.", dan perkiraan tetap dibuat. Panel gedung menulis "Di luar Kalimantan Timur". |
| Luas lantai dasar ekstrem | Dijepit ke 10 sampai 50.000 m² dan lantai ke 1 sampai 40. Tidak ada `NaN` atau angka tak masuk akal. |
| Nama wilayah ditulis longgar | `resolveRegion` mengenali "Kukar", "kubar", "kutim", "ppu", "mahulu", "kota Samarinda", "balikpapan", dan sejenisnya. |
| Token Mapbox salah, WebGL mati, gaya peta gagal, atau peta lebih dari 15 detik tidak siap | Kartu "Peta belum bisa ditampilkan" dengan pesan yang menjelaskan sebabnya dan tombol "Coba lagi". |
| Permintaan ke server gagal atau jawabannya bukan JSON | Klien melempar `ApiError` dengan pesan bahasa Indonesia, bukan layar kosong. |
| Tanpa `ANTHROPIC_API_KEY` | `GET /api/chat/status` menjawab `enabled: false`. Panel chat menulis "Asisten AI belum aktif" dan mematikan kotak teksnya. Rekomendasi memakai aturan bawaan, dan `bun run warm` melewati langkah AI. Semua fitur lain berjalan. |
| Anthropic lambat, sibuk, atau menolak kunci | Chat mengirim peristiwa `error` dengan pesan yang sesuai (terlalu lama, sibuk, tidak terhubung, kunci ditolak) dan panel menawarkan mencoba lagi. Rekomendasi jatuh ke aturan bawaan, atau ke salinan lama bila ada. |
| Pencarian tempat atau alat data gagal di tengah jawaban | Claude menerima hasil galat dan diminta menyampaikan terus terang bahwa datanya belum bisa diambil, bukan mengarang. |
| Gedung di titik pilihan chat tidak ditemukan | Panel gedung menulis "Gedung tidak ditemukan" dan tombol aksi di jawaban menulis bahwa gedung tidak ditemukan. |
| Jawaban chat terlalu panjang atau butuh terlalu banyak langkah | Jawaban dipotong dengan catatan, atau di putaran ke-8 Claude diminta menjawab dengan data yang sudah ada. |

## Keamanan

- **Rahasia.** `.env` tidak ikut git (`.gitignore`) dan tidak ikut image Docker (`.dockerignore`). `.env.example` hanya berisi nama kunci dan nilai contoh; `ANTHROPIC_API_KEY` di sana sengaja kosong.
- **Token Mapbox.** `/api/config` mengirim token Mapbox ke browser. Token itu harus token publik (diawali `pk.`), yang memang dirancang untuk dipakai di browser dan bisa dibatasi per alamat situs di dashboard Mapbox. `bun run setup` memperingatkan bila token kosong atau bukan `pk.`.
- **Kunci Anthropic.** Hanya dipakai di server (`env.ts`, `services/claude.ts`, `services/recommendations.ts`) dan tidak pernah dikirim ke browser. `/api/chat/status` hanya mengirim `enabled: true` atau `false`. Kunci tidak dicatat di log: pesan galat dari SDK dan dari layanan lain tidak memuat header atau alamat permintaan.
- **Masukan chat.** Pesan dibatasi 2.000 karakter, `sessionId` harus UUID, dan konteks peta diperiksa tipe dan rentangnya. Teks asumsi gedung dari klien dipotong (5 butir, 200 karakter) sebelum masuk prompt. Keadaan aplikasi dikirim ke Claude sebagai data, dan prompt sistem menyebutnya bukan perintah. Alat peta hanya menjalankan aksi yang daftarnya tetap, dengan isi yang diperiksa.
- **SQL.** Semua nilai masuk lewat parameter `Bun.sql` (tagged template), tidak lewat penyambungan teks. Nama tabel cache berasal dari daftar tetap di `db.ts`, bukan dari masukan pengguna.
- **Validasi.** Setiap isi permintaan diperiksa tipe dan rentangnya sebelum dipakai (lihat batas di bagian endpoint). Isi yang tidak valid dijawab 400, bukan diproses.
- **Galat server.** `safe()` mencatat jalur dan pesan singkat di log server, lalu menjawab 500 dengan kalimat umum. Rincian galat tidak dikirim ke klien.
- **Tanpa akun.** Aplikasi tidak punya login dan tidak meminta data pribadi. Riwayat chat disimpan per sesi anonim: id sesi berupa UUID acak yang disimpan browser di `localStorage`.
- **Yang belum ada.** Tidak ada pembatasan laju (rate limit) dan tidak ada login. Aplikasi ini dirancang untuk demo dan penilaian lokal, bukan layanan publik dengan banyak pengguna.

## Peta 3D: cara kerjanya

- **Gaya dasar.** `mapbox://styles/mapbox/standard` dengan proyeksi globe, label berbahasa Indonesia, dan medan 3D dari `mapbox.mapbox-terrain-dem-v1` (pembesaran 1,4 kali). Basemap memakai tema `faded` di semua cahaya, dengan cahaya siang Standard untuk siang dan fajar, dan cahaya malamnya untuk senja dan malam.
- **Kolom wilayah.** `/api/regions` dimuat sebagai sumber GeoJSON dan digambar sebagai lapisan `fill-extrusion`. Tinggi kolom adalah akar kuadrat dari nilai terhadap nilai terbesar (antara 4 km dan 75 km di tampilan provinsi), supaya wilayah kecil seperti Mahakam Ulu tetap terlihat dan Samarinda tidak menenggelamkan yang lain. Tinggi dan warna disimpan di `feature-state`, jadi animasi hanya mengubah buffer cat dan tidak membuat ulang ubin.
- **Warna.** Satu rona per metrik dalam enam tingkat: amber (kuning kecokelatan, warna pembakaran) untuk emisi CO2 dan teal (hijau kebiruan) untuk listrik. Dua deret warna dipilih menurut warna tanah peta (terang atau gelap), supaya nilai tertinggi selalu paling kontras. Kontras kolom terhadap tanah diukur dari hasil render dengan `bun run contrast` dan nilai terendahnya 3,2:1.
- **Interaksi.** Memakai `map.addInteraction`. Hover mengangkat kolom 12 persen dan meredupkan kolom lain, meter di legenda berayun ke nilai wilayah itu, dan tooltip mengikuti penunjuk. Klik memilih wilayah: kolom lain meredup dan memendek, kamera terbang 2 detik, dan panel kiri berganti ke rincian wilayah.
- **Dari kolom ke gedung.** Kolom memendek mulai pembesaran 6,6 dan hilang di pembesaran 12, saat gedung Mapbox Standard mengambil alih. Medan 3D dimatikan di atas pembesaran 13,2 dan dinyalakan lagi di bawah 12,8, karena di kota dengan medan menyala halaman memakai memori terlalu besar.
- **Gedung yang bisa diklik.** Gedung Standard (featureset `buildings`) dipilih lewat `map.addInteraction`. Klik memilih gedung, menyorotnya sesuai cahaya, dan membuka panel gedung; klik di tanah kosong pada pembesaran 14 atau lebih menutupnya. Kamera menggeser gedung keluar dari bawah panel.
- **Tempat hasil chat.** Tempat yang ditemukan `find_places` ditandai dengan penanda bernomor (`chat/placesLayer.ts`). Klik pada penanda memilih gedung di tempat itu, dan kamera dipaskan supaya semua penanda terlihat di luar panel yang terbuka.
- **Pembangkit.** Lapisan simbol dengan ikon kanvas diam: pin tetes berwarna bahan bakar dengan tepi kertas dan tepi tinta tipis, ujungnya menunjuk lokasi pembangkit dan berdiri di puncak kolom wilayahnya. Ukuran mengikuti akar kuadrat MW. Pembangkit yang berjarak kurang dari 18 piksel di layar digabung menjadi satu pin berangka (pohon kelompok di `plantGroups.ts`, dengan opasitas per pin lewat feature-state sehingga kelompok berganti menjadi pin-pin anggotanya dengan mulus), berukuran menurut jumlah MW-nya; tooltip-nya mendaftar semua pembangkit di dalamnya, dan klik memperbesar peta. Tooltip satu pembangkit menampilkan nama, bahan bakar, kapasitas, status, serta "Lokasi perkiraan" bila `approx`.
- **Cahaya.** Preset cahaya Standard mengikuti jam WITA (UTC+8, tanpa waktu musim panas): fajar 05.00 sampai 07.00, siang 07.00 sampai 17.00, senja 17.00 sampai 19.00, selebihnya malam. Saklar "Cahaya" (Otomatis, Siang, Malam) dan parameter `?cahaya=day|dawn|dusk|night` bisa mengunci cahaya.
- **Hujan.** Saklar "Hujan" menyalakan `map.setRain` dengan garis hujan tipis. Efek baru terlihat mulai pembesaran 15 (tingkat gedung) dan penuh di 16,5. Pada peta terang, kabut tipis di dalam peta ikut menyala supaya garis hujan terlihat. Mode otomatis (bawaan) menyalakan hujan bila prakiraan Open-Meteo di pusat peta mengatakan sedang hujan (`map/autoRain.ts`; dicek di pembesaran 12 atau lebih, saat kamera pindah lebih dari 2 km, dan tiap 10 menit). Di bawah saklar ada keterangan singkat: "Sedang hujan di sini menurut prakiraan Open-Meteo" atau petunjuk memperbesar sampai tingkat gedung.
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
- Kapasitas dikali faktor kapasitas asumsi (batu bara 0,70, gas 0,50, diesel 0,30, surya 0,15), lalu satu poin batu bara dipindahkan ke biomassa (ko-firing 5% di PLTU Teluk Balikpapan) dan hasilnya dibulatkan.
- Hasil: batu bara 66%, gas 25%, diesel 7%, surya 1%, biomassa 1%, air 0%. Anggap plus minus 8 poin persentase; bagian batu bara kemungkinan sedikit lebih tinggi dari angka ini.

Faktor emisi per bahan bakar (kg CO2 per kWh listrik): batu bara 1,04, gas 0,53, diesel 0,75, surya, air, dan biomassa 0. Nilainya dari faktor bawaan IPCC 2006 (batu bara sub-bituminus, gas alam, minyak diesel) dibagi asumsi efisiensi pembangkit (sekitar 33% batu bara, 38% gas, 36% diesel) dan dibulatkan. CO2 biogenik biomassa dihitung 0 sesuai aturan inventaris IPCC.

Rincian per sumber pada satu gedung (`co2BySource`): kWh × porsi × faktor bahan bakar, lalu seluruhnya diskalakan supaya jumlahnya tepat sama dengan kWh × 1,14. Jadi **porsinya** berasal dari bauran dan faktor bahan bakar (di data ini sekitar 79% batu bara, 15% gas, 6% diesel), sedangkan **totalnya** berasal dari angka resmi. Listrik jaringan bercampur, jadi aplikasi menunjukkan bauran di balik listrik gedung dan tidak menunjuk satu pembangkit tertentu.

### 4. Perkiraan satu gedung

`kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi jenis gedung`

- **Luas lantai dasar** dihitung di klien dari poligon gedung di peta (luas bola, `polygonAreaM2` di `src/shared/estimate.ts`), lalu server menjepitnya ke 10 sampai 50.000 m².
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
| tidak ada POI yang cocok | jenis dari hasil pencarian tempat chat bila ada (`typeHint`), selain itu dari luas lantai dasar: di bawah 250 m² rumah, di bawah 2.000 m² ruko, selebihnya gudang |

- **Jumlah lantai.** Bila peta punya tinggi nyata (lebih dari 3 m): tinggi ÷ 3,5 m dibulatkan. Bila tidak: jumlah lantai umum untuk jenis itu. Hasilnya dijepit ke 1 sampai 40 lantai. Tinggi lantai 3,5 m adalah asumsi kerja.
- **Pilihan pengguna.** Jenis dan jumlah lantai bisa diubah pengguna di panel gedung, dan angkanya dihitung ulang. Jenis pilihan pengguna mengalahkan POI dan petunjuk dari pencarian tempat.
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
| penumpang terbang Jakarta–Balikpapan | 111,1 | Satu penumpang, kelas ekonomi, sekali jalan, 1.255 km (Kalkulator ICAO ICEC, dicek 21 Oktober 2026) |

### 6. Simulasi panel surya

Masukan API: luas atap, konsumsi listrik gedung per tahun, jam cadangan baterai, lokasi, dan jenis gedung. Di panel gedung, luas atap diisi awal dengan luas lantai dasar, dan baterai diisi awal 4 jam (slider 0 sampai 12 jam). Jenis gedung menentukan tarif listrik, porsi pemakaian siang, dan hari pakai per tahun. Konstanta di `src/shared/solar.ts` dan `data/seed/solar-costs.json` adalah asumsi teknis umum untuk PLTS atap, bukan hasil pengukuran gedung ini.

| Langkah | Rumus |
|---|---|
| Jam puncak matahari (PSH) | Rata-rata tahunan `ALLSKY_SFC_SW_DWN` dari NASA POWER di titik gedung (kWh/m²/hari) |
| Hasil per kWp per tahun | PSH × 365 × 0,78 (rasio kinerja 0,78) |
| Pemakaian siang | konsumsi setahun × porsi siang jenis gedung (tabel di bawah) |
| Jumlah panel | pemakaian siang ÷ hasil per kWp ÷ 0,55 kWp per panel, dibulatkan turun (paling sedikit 1 panel, karena listrik ke jaringan tidak dibayar), tetapi tidak lebih dari muatan atap |
| Muatan atap | luas atap × 0,6 (bagian atap yang bisa dipakai) ÷ 5,5 m² per kWp ÷ 0,55, dibulatkan turun |
| Kapasitas yang dipasang (kWp) | jumlah panel × 0,55 |
| Produksi per tahun | kWp × hasil per kWp |
| Pemakaian langsung | dihitung per jenis hari, produksi dibagi rata ke 365 hari: di hari pakai paling banyak sebesar pemakaian siang hari itu, di hari libur paling banyak sebesar bagian siang beban dasar (15% beban hari biasa, setengahnya di siang hari) |
| Ke jaringan | produksi dikurangi pemakaian langsung; tidak mengurangi tagihan (Permen ESDM 2/2024) |
| Cakupan kebutuhan | pemakaian langsung ÷ konsumsi setahun |
| Baterai (kWh) | konsumsi ÷ 365 ÷ 24 × jam cadangan ÷ 0,9 (efisiensi baterai); hanya cadangan saat listrik padam, tidak menambah penghematan |
| Biaya | kWp × Rp 15.000.000 + baterai × Rp 2.500.000 |
| Penghematan per tahun | pemakaian langsung × tarif jenis gedung |
| Balik modal | biaya ÷ penghematan per tahun; balik modal tanpa baterai ditampilkan terpisah |
| CO2 dihindari | pemakaian langsung × 1,13 kg CO2 per kWh |

Faktor 1,13 adalah faktor emisi khusus PLTS dan PLTB di Sistem Mahakam dari Kepmen ESDM yang sama dengan faktor 1,14 untuk jaringan (data 2019). Faktor ini dipakai untuk CO2 yang dihindari panel, sedangkan CO2 gedung memakai 1,14.

Tarif per jenis gedung (`src/server/services/solarTariff.ts`, nilai di `solar-costs.json`):

| Jenis gedung | Golongan dan tarif | Catatan |
|---|---|---|
| rumah, dan jenis yang tidak diketahui | R-1/TR 1.300 VA, Rp 1.444,70 per kWh | |
| pemerintahan | P-1, Rp 1.699,53; P-2, Rp 1.522,88 bila di atas 600 MWh per tahun | Di atas 600 MWh gedung dianggap butuh lebih dari 200 kVA (asumsi) |
| ruko, kantor, hotel, mal, gudang | B-2, Rp 1.444,70; B-3, Rp 1.114,74 bila di atas 600 MWh per tahun | B-3 memakai harga di luar beban puncak (LWBP), jam kerja panel |
| industri | I-3, Rp 1.114,74 | Gedung industri dianggap industri menengah |
| sekolah, kampus, rumah ibadah, rumah sakit | Tarif R-1 sebagai pendekatan, Rp 1.444,70 | Biasanya memakai tarif sosial (golongan S) yang belum dimodelkan, jadi penghematan sebenarnya bisa lebih kecil. Asumsinya mengatakan itu. |

Porsi pemakaian siang dan hari pakai per tahun (semuanya asumsi tim, berlabel "perkiraan"):

| Jenis | Porsi siang | Hari pakai |
|---|---|---|
| rumah | 40% | 365 |
| ruko | 60% | 330 |
| kantor, pemerintahan | 85% | 250 |
| sekolah | 85% | 200 |
| kampus | 80% | 220 |
| rumah sakit | 60% | 365 |
| hotel, mal | 70% | 365 |
| rumah ibadah | 50% | 365 |
| gudang | 70% | 300 |
| industri | 60% | 300 |
| tidak diketahui | 60% | 365 |

Tarif berasal dari berita keputusan ESDM (tarif triwulan IV 2026 tidak naik) dan daftar tarif, bukan dari tabel resmi. Harga panel dan baterai berasal dari berita dan blog vendor 2026 yang belum diverifikasi. Hasilnya berlabel "perkiraan", dan API ikut mengirim daftar asumsinya (golongan tarif, porsi siang, hari pakai, catatan ekspor, harga, catatan baterai, faktor CO2). Batasan yang perlu diketahui:

- Pemakaian langsung dihitung per jenis hari dengan produksi yang dibagi rata sepanjang tahun. Perbedaan musim, jam produksi, dan jam pemakaian di dalam satu hari tidak dimodelkan selain lewat porsi siang.
- Balik modal adalah balik modal sederhana, tanpa penurunan kinerja panel, bunga, kenaikan tarif, atau penggantian baterai.
- Bila NASA POWER tidak terjangkau dan belum ada cache, PSH diganti 4,2 jam per hari dan hal itu dicatat di daftar asumsi.
- Chat memakai fungsi server yang sama (`simulateSolarAt`) dengan jenis gedung yang sama, jadi angka di chat dan di tab Surya sama.

### 7. Prakiraan produksi panel dan hujan

- Open-Meteo memberi radiasi (`shortwave_radiation`, W/m²), tutupan awan, curah hujan, dan kode cuaca WMO per jam selama 7 hari dalam waktu Asia/Makassar.
- Produksi per jam = kWp × radiasi ÷ 1.000 × 0,78. Radiasi horizontal dipakai sebagai pendekatan, tanpa kemiringan panel dan tanpa pengaruh suhu. Mendung dan hujan menurunkan hasilnya lewat nilai radiasi itu sendiri. Ukuran panel di tab Cuaca sama dengan hasil tab Surya untuk gedung itu.
- Satu jam dianggap hujan bila curahnya 0,1 mm atau lebih, atau kode cuacanya hujan (51 sampai 67, 80 sampai 82, 95 sampai 99). Aturan ini dipakai untuk "sedang hujan sekarang", jam hujan yang diarsir di grafik, dan hujan otomatis di peta.
- Label hari di tab Cuaca membandingkan hari itu dengan produksi panel yang sama di bawah langit cerah. Langit cerah dihitung dari posisi matahari di titik gedung dengan model Haurwitz (1945). Hujan dan awan dihitung hanya pada jam siang. Hari berlabel "Hujan" bila ada 2 jam hujan di siang hari atau curah 1 mm atau lebih, "Berawan" bila hari kering dengan rata-rata awan siang 60% atau lebih, selain itu "Cerah". Bila produksi turun 10% atau lebih dari langit cerah, tab menulis persen dan sebabnya (hujan, awan, atau awan dan hujan). Di bawah 10% tab menulis "hampir sama dengan langit cerah (model)", karena model itu tidak punya kabut dan kelembapan.
- Ringkasan harian sederhana (`summariseDays`, dipakai alat chat `get_weather` untuk kolom `rain`) menandai hari hujan bila ada jam dengan 0,5 mm atau lebih, atau kode hujan. Perbandingan dengan langit cerah di chat memakai fungsi yang sama dengan tab Cuaca.
- Kondisi saat ini diambil dari jam prakiraan terdekat dengan waktu sekarang. Dianggap siang bila radiasi jam itu lebih dari 0. Prakiraan lama (Open-Meteo gagal) hanya dianggap berbicara tentang saat ini bila ada jamnya dalam 2 jam dari sekarang.

### 8. Batas yang perlu diketahui pembaca

- Tidak ada data meteran. Semua angka per gedung adalah hasil model dan diberi kata "perkiraan".
- Angka wilayah adalah perkiraan hasil pembagian data cabang PLN, dengan ketidakpastian sekitar 30% untuk wilayah industri.
- Bauran listrik adalah perkiraan dari kapasitas, plus minus 8 poin persentase. Faktor emisi 1,14 adalah angka resmi tahun 2019.
- Sembilan dari 13 pembangkit punya koordinat perkiraan (ditandai di peta). Pembangkit captive (AlamTri, NALCO) dan beberapa lainnya belum terverifikasi dan ditandai statusnya.
- Intensitas energi untuk rumah, ruko, sekolah, kampus, rumah ibadah, gudang, dan industri adalah asumsi.
- Di simulasi surya, porsi pemakaian siang, hari pakai, ambang 600 MWh untuk golongan besar, dan harga panel serta baterai adalah asumsi. Tarif sosial untuk sekolah, kampus, rumah ibadah, dan rumah sakit belum dimodelkan.
- Rekomendasi dan jawaban chat ditulis AI dari angka aplikasi. Angkanya dari data, tetapi kalimat dan pertimbangannya tidak dijamin benar, jadi kartu rekomendasi menyarankan memeriksa lagi sebelum dipakai untuk keputusan.
- Pencarian tempat di chat memakai data Mapbox yang bisa belum lengkap.

## Konfigurasi dan menjalankan

### Variabel lingkungan (`.env`)

| Kunci | Wajib | Fungsi |
|---|---|---|
| `MAPBOX_TOKEN` | Ya, untuk peta | Token publik Mapbox (diawali `pk.`). Dikirim ke browser lewat `/api/config`. |
| `ANTHROPIC_API_KEY` | Tidak | Kunci Anthropic untuk chat AI dan rekomendasi. Kosongkan (nilai bawaan `.env.example`) untuk menjalankan tanpa AI: chat menjelaskan bahwa ia butuh kunci, dan rekomendasi memakai aturan bawaan. Jangan memakai nilai contoh seperti `sk-ant-...`: nilai itu dianggap kunci dan Anthropic menolaknya. |
| `DATABASE_URL` | Tidak | Bawaan `postgres://malas:malas@localhost:5433/malas_ngoding`. |
| `PORT` | Tidak | Port server, bawaan 3000. |

### Perintah

| Perintah | Fungsi |
|---|---|
| `docker compose up -d` | Menyalakan PostgreSQL dan PostGIS di port 5433 |
| `bun install` | Memasang dependensi |
| `bun run setup` | Menunggu database siap, lalu migrasi, seed, dan pemanasan cache. Aman diulang. |
| `bun run migrate`, `bun run seed`, `bun run warm` | Tiap langkah setup secara terpisah. `warm` mengisi klimatologi NASA dan (dengan kunci Anthropic) rekomendasi 10 wilayah; `bun run warm -- --refresh` menulis ulang rekomendasi. |
| `bun dev` | Server dengan hot reload di `http://localhost:3000` |
| `bun start` | Server mode produksi (`NODE_ENV=production`): tanpa hot reload dan tanpa log konsol browser |
| `bun test` | Seluruh tes |
| `bun run typecheck` | Pemeriksaan tipe TypeScript |
| `bun run smoke` | Pemeriksaan browser otomatis (server harus sudah jalan) |
| `bun run contrast` | Mengukur kontras warna kolom dari hasil render |
| `bun scripts/build-boundaries.ts` | Membangun ulang `data/seed/regions.geojson` dari geoBoundaries |

Database memakai port 5433 di komputer Anda supaya tidak bentrok dengan PostgreSQL lain yang biasanya memakai 5432. Port itu hanya terbuka di alamat lokal (`127.0.0.1`), jadi komputer lain di jaringan tidak bisa menjangkaunya. Data tersimpan di volume Docker `malas_ngoding_pg`.

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
