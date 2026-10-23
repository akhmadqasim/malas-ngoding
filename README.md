# Malas Ngoding

Peta 3D interaktif yang menunjukkan dari mana listrik Kalimantan Timur datang, berapa yang dipakai, dan berapa CO2 yang ikut terlepas. Karya tim Malas Ngoding untuk INSEVENT 2026 (Fullstack Web Development Competition, Sistem Informasi Universitas Mulawarman), subtema SDG 7: Integrated Clean Energy Ecosystem.

![Peta 3D Kalimantan Timur: sepuluh wilayah sebagai kolom, tinggi dan warnanya menurut emisi CO2](docs/technical/screens/map.png)

## Apa itu Malas Ngoding

Sebagian besar listrik di Kalimantan Timur berasal dari batu bara (perkiraan kami sekitar dua pertiganya). Warga sulit membayangkan berapa CO2 yang dihasilkan listrik yang mereka pakai, dan apa yang berubah bila gedung memakai panel surya. Malas Ngoding membuat hal itu terlihat: peta 3D yang bisa dijelajahi siapa saja, lengkap dengan sumber dan cara hitung setiap angka, dan dengan rekomendasi untuk pemerintah daerah.

Semua angka per gedung dan per wilayah adalah **perkiraan** hasil model, bukan data meteran. Antarmuka selalu menulis kata "perkiraan" di samping angka itu, dan bagian [Batasan](#batasan) menjelaskan apa yang tidak dilakukan aplikasi.

## Fitur

- **Surya warga, pembangkit pemkot.** Dashboard warga hanya memuat panel surya rumah, baterai, cuaca, dan manfaat energi; kontrol angin tidak tampil pada lab warga. Desktop langsung membingkai rumah menurut luas tersimpan, dengan informasi di sampingnya. Ponsel menampilkan peta rumah 3D di atas informasi energi. Terrain dimatikan pada skala bangunan agar tidak menutup rumah; perubahan medan dikelola MapView meskipun panel inspeksi tidak terpasang. Perencanaan PLTB tetap di dashboard pemda.
- **Refresh langsung ke rumah.** Aplikasi menunggu sesi dan rumah selesai dimuat sebelum membuat peta. Akun tersimpan langsung memakai kamera rumah; globe hanya untuk kunjungan awal publik. Kegagalan memuat akun/rumah memiliki tombol coba lagi dan tidak dianggap rumah kosong. Titik bawaan Warga Demo dikoreksi ke pusat footprint Mapbox 575625507; skrip `repair-demo-home.ts` hanya memperbaiki placeholder demo asli dengan backup, tanpa memindahkan rumah akun lain.
- **Panduan visual warga.** Tombol tugas memakai ikon Lucide dan label singkat: Hemat listrik, Kondisi panel, Data rumah, dan Tanya pendamping. Karakter warga/teknisi/pemda menjelaskan konteks dengan kalimat pendek. Manfaat tampil sebagai ringkasan ikon; cuaca serta pertanyaan publik memakai pilihan bergambar. Label sensor rumah mengikuti tinggi bangunan tersimpan, tanpa geseran layar ponsel; label rumah ganda disembunyikan saat monitor aktif.
- **Pratinjau pemasangan 3D.** Coba panel membuka kontrol jumlah modul 550 Wp, animasi pemasangan berurutan, dan pembanding sebelum/sesudah di atap rumah tersimpan. Modul 1,12 × 2,22 m ditata dalam area konservatif di dalam footprint; jika atap tidak cocok, model tidak diletakkan. Atap datar dan susunan adalah ilustrasi yang perlu survei. Endpoint simulasi menerima jumlah panel pilihan dan tetap membatasi ukuran atap serta kredit pemakaian sendiri. Model sementara dibersihkan saat ditutup atau pindah ke pemantauan; status pemasangan/database tidak berubah. Reduced motion dihormati.
- **UI laporan pemasangan terhubung backend.** Menu Laporan panel warga berisi formulir tiga langkah, unggahan foto, nomor referensi, timeline, perbaikan/kirim ulang, dan pembatalan. Menu Laporan PLTS pemda berisi antrean, pencarian/filter, pemeriksaan, jadwal/penjadwalan ulang survei, permintaan perbaikan, penolakan, dan verifikasi sesuai `allowedActions`. Ini pendataan panel yang sudah terpasang, bukan permohonan pemasangan baru. Detail memperbarui status tiap 20 detik saat tab terlihat dan tidak sedang mengisi tindakan; konflik versi memuat data terbaru. Retry pengiriman ambigu mempertahankan payload dan Idempotency-Key. Data foto/kontak berasal dari server, tanpa penyimpanan kontak di localStorage. Kontrak: `src/shared/applications.ts` dan `docs/plans/2026-10-23-solar-verification-api.md`. Uji browser nyata: `bun scripts/check-applications.ts` memakai akun uji terisolasi dan membersihkannya setelah selesai.
- **Warga fokus satu rumah.** Setelah login atau memuat ulang halaman, rumah dari `/api/me/home` menjadi dashboard pribadi. Tidak ada navigasi wilayah/pembangkit, pencarian bangunan lain, atau interaksi peta untuk akun yang sudah memiliki rumah. Peta dekoratif berpusat pada koordinat tersimpan; eksperimen panel tetap di halaman rumah itu. Akun tanpa rumah menjalani penautan sekali melalui peta. Tagihan, laporan pemasangan, dan izin berbagi tetap dapat diperbarui tanpa mengganti lokasi rumah. Penautan saat ini laporan pengguna, bukan verifikasi kepemilikan oleh admin.
- **Alur sesuai kebutuhan pengguna.** Warga tanpa pemasangan langsung melihat perkiraan penghematan bulanan dan tombol mencoba atap; warga dengan pemasangan langsung masuk pemantauan. Uji cuaca, rincian tahunan, tagihan, dan izin berada di bagian lanjutan. Pemda masuk ke Prioritas transisi: membandingkan dampak per anggaran sama atau dampak total pada skenario PLTS atap 10%, melihat tiga kandidat pertama, dan mencatat empat pemeriksaan kesiapan pilot selama sesi. Urutan adalah potensi teknis, bukan janji kecepatan pembangunan; data iklim fallback tidak diberi peringkat, dan data warga/demo tidak menaikkan peringkat. Checklist sesi tidak disimpan ke server atau dianggap verifikasi lapangan.
- **Efek energi dan dampak yang dapat ditelusuri.** Beacon pada gedung menunjukkan paket virtual serta emisi jaringan; lingkaran jingga menandai ketergantungan pada jaringan dan toska menandai beban yang dipasok surya. Efek berhenti saat koneksi virtual putus dan menghormati reduced motion. Ini simbol emisi listrik jaringan, bukan asap lokal. Ringkasan CO₂ mengikuti gedung aktif dalam kg/jam atau wilayah dalam ton/jam. Pembanding tanpa/dengan PLTS memakai beban dan waktu yang sama, menghitung hanya penggunaan surya di gedung, serta dapat diekspor sebagai CSV riwayat sintetis dengan waktu UTC, kapasitas, dan faktor emisi.
- **Lab energi tanpa akun.** Tombol Coba tanpa akun membuka pertanyaan umum warga, pencarian atap, dan eksperimen cerah/mendung/hujan ringan/hujan lebat/malam. Ilustrasi hujan mengikuti angin uji dan menghormati reduced motion. Produksi bertransisi delapan detik; tabel membandingkan jaringan dan CO₂ dengan kondisi cerah tanpa baterai pada beban sama. Baterai mulai kosong, diisi dari surplus surya selama 30 menit sebelum perubahan cuaca, daya maksimum 2 kW dan efisiensi 95% per arah. Input hanya sesi halaman, bukan pemasangan. Akun diperlukan untuk menyimpan rumah. Monitor rumah menyediakan lab terpisah dan saran jam dari prakiraan segar 24 jam, tanpa mengubah data pemasangan.
- **Draf kajian pilot pemda.** Checklist kesiapan dilengkapi isian lokasi dan referensi audit atap, jaringan, izin/pengelola, serta pendanaan. Draf dapat diunduh sebagai JSON, ditandai belum diverifikasi; dokumen bukti belum diunggah dan tidak ada penyimpanan server untuk catatan ini.
- **Sensor IoT simulasi per gedung.** Rumah saya dan tab Sensor IoT menghasilkan paket virtual setiap dua detik: produksi PV, beban, impor/ekspor jaringan, radiasi, hujan, suhu modul, tegangan, dan CO₂. Cuaca lokasi menjadi dasar jika tersedia; cerah, berawan, hujan, malam, dan koneksi putus dapat diuji tanpa mengubah database pemasangan. Riwayat satu menit adalah kurva sintetis. Mode Simulasi langsung pada Digital twin menganimasikan emisi wilayah setiap dua detik, terpisah dari Prakiraan 24 jam.
- **Lucide dan karakter siap pakai.** Semua ikon aplikasi berasal dari Lucide. Karakter warga, pemda, dan teknisi tersedia sebagai ilustrasi transparan yang dapat dipakai ulang di dashboard dan sebagai orang 3D yang berjalan di dekat gedung pada zoom dekat. Tombol Lihat karakter 3D mendekatkan kamera. Model orang diperbesar untuk keterbacaan dan bukan pelacakan warga; jalur diperiksa terhadap tapak gedung yang sudah dimuat. Aset dan prompt: `public/characters/README.md`; model dapat dibangun ulang lewat `bun scripts/build-characters.ts`.
- **Dashboard warga dan pemda.** Navigasi mengambang, panel bersudut lembut, dan ringkasan terbuka menyisakan ruang bagi peta. Warga memusatkan Rumah saya dan Simulasi atap. Pemda mendapat Adopsi PLTS, Rencana pembangkit, Skenario wilayah, serta **Digital twin**, simulasi energi 24 jam dengan tombol putar dan penggeser jam. Panel dan kamera menyesuaikan ruang peta pada desktop maupun ponsel.
- **Pemantauan otomatis.** Angin lokasi dari endpoint `/api/wind` menggunakan model cuaca current Open-Meteo pada ketinggian 10 m, diperiksa setiap 60 detik dengan cache server satu menit. Waktu model dan status data lama ditampilkan; pembaruan otomatis bukan telemetri sensor. CO₂ jam berjalan merupakan estimasi profil beban dan faktor jaringan dari digital twin, diperiksa setiap lima menit. Buka "Tentang data" untuk melihat metode dan sumber.
- **Perencanaan PLTS dan PLTB.** Pilih teknologi, lokasi, periksa lahan, lalu ubah kapasitas dan lihat model 3D serta estimasinya. Arah turbin dan panah mengikuti model angin lokasi; rotor berhenti saat data tidak tersedia atau kedaluwarsa. Angin ini untuk animasi, sedangkan estimasi produksi tahunan tetap menggunakan data historis NASA POWER. Pemeriksaan lahan merupakan penyaringan awal, bukan izin pembangunan.
- **Desain bangunan ilustratif.** Variasi atap pada kawasan kota; gedung besar mendapatkan baris jendela mengikuti dinding dan tinggi aslinya tanpa harus dipilih. Gudang dan bangunan umum memakai atap bawaan sesuai jenis, tanpa menumpuk model bangunan tambahan di atasnya. Kubah masjid dan panel surya memakai penempatan yang tetap di dalam tapak, menghindari halaman tengah dan bagian cekung; satu tapak mendapat paling banyak satu susunan panel. Model ini bukan hasil survei arsitektur.
- **PLTS terpasang di dasbor pemda.** Warga dapat melaporkan pemasangan dan kapasitas PLTS di Rumah saya. Pemda melihat jumlah per wilayah serta filter terpasang, berminat, dan seluruh rumah terdaftar. Lokasi hanya ditampilkan atas izin pemilik, tanpa identitas; status merupakan laporan pemilik, belum diverifikasi. Panel 3D muncul hanya pada pemasangan tercatat yang titiknya cocok dengan tapak gedung peta. Jalankan `bun run migrate` untuk kolom baru. Untuk contoh sintetis pada rumah demo yang sudah ada, jalankan `bun scripts/seed-installed-demo.ts`; skrip tidak mengubah warga nyata.

- **Peta 3D Kalimantan Timur.** Peta Mapbox Standard dengan medan 3D. Sepuluh kabupaten dan kota berdiri sebagai kolom 3D; tinggi dan warnanya menurut emisi CO2 per tahun atau listrik terpakai (saklar "Tinggi kolom"). Arahkan penunjuk untuk melihat nilainya, klik untuk membuka rincian: penduduk, pelanggan PLN, rasio elektrifikasi, desa yang belum dilayani PLN, listrik per orang, dan asal listrik Kaltim. Pembukanya animasi kamera dari globe ke Kalimantan Timur.
- **Pembangkit listrik.** Tiga belas pembangkit tampil sebagai pin yang berdiri di puncak kolom wilayahnya, kepalanya berwarna menurut bahan bakar dan berukuran menurut MW; pembangkit yang berdekatan digabung menjadi satu pin berangka. Arahkan penunjuk untuk melihat nama, bahan bakar, dan kapasitasnya; keterangan menampilkan status, dan "Lokasi perkiraan" bila koordinatnya belum pasti (9 dari 13).
- **Legenda dan "Lapisan dan tampilan".** Kartu legenda di bawah selalu tampil: saklar "Tinggi kolom" dan meter dengan jarumnya. Saklar lapisan (Wilayah, Pembangkit, dengan kunci warna bahan bakar di bawahnya), Cahaya, dan Hujan ada di balik tombol teks "Lapisan dan tampilan" di ujung kanan legenda. Tombol itu tertutup di awal sesi dan keadaannya diingat selama sesi.
- **Cahaya dan hujan.** Cahaya peta mengikuti jam di Kalimantan Timur (fajar, siang, senja, malam) atau dikunci lewat saklar "Cahaya". Saklar "Hujan" bawaannya otomatis: peta ikut hujan bila prakiraan Open-Meteo di pusat peta mengatakan sedang hujan, dan efeknya terlihat saat peta diperbesar sampai tingkat gedung. Saklar itu juga bisa menyalakan atau mematikan hujan secara manual.
- **Klik gedung mana pun.** Panel gedung menampilkan perkiraan listrik per tahun dan per bulan (tab Energi), bauran sumber listrik di baliknya, CO2 per tahun, dan padanan yang mudah dibayangkan: km naik mobil, pohon, charge HP, penerbangan (tab Emisi). Jenis gedung (12 pilihan) dan jumlah lantai bisa diubah dan angkanya dihitung ulang. Jenis gedung ditebak dari tempat terdekat di peta, atau dari luas bila tidak ada.
- **Tab Surya.** Simulasi panel surya dari luas atap dan jam cadangan baterai: jumlah dan kapasitas panel, produksi per tahun, bagian yang dipakai langsung di gedung lawan yang masuk jaringan tanpa imbalan, ukuran baterai, biaya, penghematan, balik modal, dan CO2 yang dihindari. Tarif PLN dan jam pemakaian mengikuti jenis gedung (contohnya kantor pemerintah memakai tarif P-1 dan dihitung dipakai sekitar 250 hari setahun, sedangkan sekolah sekitar 200 hari). Grafik jam matahari per bulan dari NASA POWER dan daftar asumsi ikut tampil.
- **Tab Cuaca.** Prakiraan 7 hari dari Open-Meteo untuk panel yang sama dengan tab Surya: grafik produksi per jam selama 72 jam dengan jam hujan diarsir, dan daftar produksi per hari yang menulis seberapa jauh tiap hari turun dari langit cerah dan sebabnya (hujan atau awan).
- **Rekomendasi untuk pemerintah.** Di rincian tiap kabupaten dan kota ada kartu "Rekomendasi untuk Pemkab" atau "Pemkot": tiga sampai enam saran berprioritas, ditulis Claude dari data wilayah itu dan disimpan di database. Tombol "Perbarui" di samping judul meminta Claude menulis ulang. Angka PLTS atap di kartu dihitung dengan model yang sama dengan tab Surya untuk kantor pemerintah, jadi balik modalnya sama. Bila AI tidak tersedia, kartu memakai saran berbasis aturan dan menulis itu dengan jelas.
- **Lembar "Cara menghitung dan sumber data".** Dibuka dari tombol "Tentang peta ini": rumus, tabel faktor (baris asumsi bertanda), dan semua sumber data dengan lisensinya.
- **Chat AI yang menggerakkan peta.** Tanyakan sesuatu dalam bahasa Indonesia, misalnya "Tunjukkan gedung sekolah di Samarinda" atau "Wilayah mana emisinya paling tinggi?". Claude memakai alat yang membaca data aplikasi (statistik wilayah, bauran listrik, perkiraan gedung, simulasi surya, cuaca, `get_recommendations`, dan pencarian tempat `find_places`), lalu menggerakkan peta: terbang ke wilayah, menandai tempat hasil pencarian, memilih gedung, membuka tab Surya atau Cuaca, mengganti metrik, lapisan, atau hujan. Di bawah jawaban muncul tombol untuk tiap aksi yang bisa dijalankan lagi.

Keputusan desain: angka hanya muncul bila punya sumber atau ditandai sebagai asumsi, dan chat tidak boleh mengarang angka: angkanya datang dari alat yang memakai data dan rumus aplikasi, bukan dari ingatan model. Chat dan rekomendasi AI memerlukan kunci API Anthropic; tanpa kunci, bagian lain aplikasi tetap berjalan penuh (lihat [Tanpa kunci Anthropic](#tanpa-kunci-anthropic)).

![Panel gedung di Samarinda: listrik per tahun, jenis dan lantai yang bisa diubah, empat tab](docs/technical/screens/building.png)

![Tab Surya: luas atap, cadangan baterai, cakupan kebutuhan listrik, dan produksi panel lawan kebutuhan gedung](docs/technical/screens/solar.png)

![Chat AI: lima sekolah di Samarinda ditandai di peta dan satu gedung dipilih](docs/technical/screens/chat.png)

![Efek hujan di tingkat gedung, Samarinda](docs/technical/screens/rain.png)

## Teknologi

| Lapisan | Teknologi |
|---|---|
| Runtime dan server | Bun 1.4 (`Bun.serve`, bundler, test runner, `Bun.sql`), TypeScript |
| Basis data | PostgreSQL 17 dan PostGIS 3.5 (Docker) |
| Antarmuka | React 19, HeroUI v3 (komponen), `lucide-react` (ikon), Zustand, Motion, Tailwind CSS 4 |
| Peta | Mapbox GL JS v3 (gaya Standard, globe, medan 3D, kolom `fill-extrusion`) |
| Data luar | Mapbox Tilequery dan Search Box, NASA POWER, Open-Meteo |
| AI | Anthropic Claude (`@anthropic-ai/sdk`), model `claude-sonnet-5-5`: chat dengan alat dan rekomendasi pemerintah |

Rincian versi, arsitektur, dan alasan pilihan ada di [docs/technical/architecture.md](docs/technical/architecture.md).

## Persyaratan

- [Bun](https://bun.sh) 1.4 atau lebih baru.
- [Docker](https://www.docker.com/) dengan Docker Compose v2 (Docker Desktop atau Docker Engine). Docker menjalankan database.
- Git.
- Browser modern dengan WebGL aktif (pengujian otomatis memakai Chromium) dan koneksi internet: ubin peta dari Mapbox dan data cuaca dari Open-Meteo tidak tersedia secara luring.
- Port **3000** (aplikasi) dan **5433** (database) harus kosong.
- **Token publik Mapbox** (diawali `pk.`), gratis dari [account.mapbox.com](https://account.mapbox.com/). Tanpa token, peta tidak tampil.
- Kunci API Anthropic bersifat **opsional**: hanya untuk chat AI dan rekomendasi yang ditulis AI. Tanpa kunci, semua fitur lain tetap berjalan (lihat [Tanpa kunci Anthropic](#tanpa-kunci-anthropic)).

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
   | `MAPBOX_TOKEN` | Ya | Token publik Mapbox (`pk....`). Dikirim ke browser lewat `/api/config`, jadi **jangan** memakai token rahasia (`sk....`). |
   | `ANTHROPIC_API_KEY` | Tidak | Hanya untuk fitur AI. Tidak pernah dikirim ke browser. **Kosong** di `.env.example`; biarkan kosong untuk menjalankan tanpa AI, atau isi dengan kunci asli. Jangan menyisakan nilai contoh. |
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

   Keluarannya kira-kira begini (dengan kunci Anthropic, langkah ke-3 juga membuat rekomendasi AI untuk 10 wilayah; di pemasangan baru langkah itu lebih lama: rekomendasi dibuat sekitar 10 detik per wilayah, tiga wilayah sekaligus):

   ```
   Malas Ngoding: menyiapkan database di localhost:5433
   Database siap.
   [1/3] Migrasi skema database ...
         1 migrasi diterapkan: 001_init.sql
   [2/3] Mengisi data awal (seed) ...
         10 wilayah, 13 pembangkit, 7 baris bauran listrik, 12 jenis bangunan, 5 faktor padanan
   [3/3] Memanaskan cache ...
   Memanaskan cache untuk 10 wilayah...
   - Berau: data surya 4,75 jam puncak per hari; rekomendasi AI sudah ada
   - Bontang: data surya 4,94 jam puncak per hari; rekomendasi AI sudah ada
   ...
   Selesai: data surya 10/10 wilayah, rekomendasi AI 10/10 wilayah.
   Setup selesai dalam 0,4 detik. Berikutnya: jalankan `bun dev`, lalu buka http://localhost:3000
   ```

6. Jalankan aplikasi, lalu buka <http://localhost:3000>.

   ```
   bun dev
   ```

   Intro kamera berjalan sekitar 6 detik dan bisa dilewati dengan tombol "Lewati intro" atau tombol Esc.

### Tanpa kunci Anthropic

`.env.example` membiarkan `ANTHROPIC_API_KEY` kosong. Dengan nilai kosong, server tidak membuat penulis rekomendasi dan menandai chat sebagai mati. Yang terjadi:

| Fitur | Tanpa kunci |
|---|---|
| Peta, kolom wilayah, pembangkit, hujan, gedung, tab Energi, Emisi, Surya, Cuaca, lembar metodologi | Berjalan penuh. Tidak memakai Anthropic. |
| Rekomendasi untuk pemerintah | Kartu menampilkan saran **berbasis aturan** (3 sampai 6 butir dari data wilayah) dan menulis "Berbasis aturan: AI sedang tidak tersedia". Saran itu tidak disimpan. Bila database sudah punya rekomendasi tulisan AI dari pemasangan sebelumnya, salinan itu tetap dipakai. |
| Chat AI | Panel chat menulis "Asisten AI belum aktif" dan "Kunci API Anthropic belum diatur di server", dan kotak pertanyaannya dimatikan. Peta dan semua panel tetap bisa dipakai. |
| `bun run setup` | Berjalan sampai selesai. Langkah pemanasan mencetak "ANTHROPIC_API_KEY kosong: rekomendasi AI dilewati". |

Isi kunci hanya bila ingin menyalakan AI. Nilai contoh seperti `sk-ant-...` **tidak** sama dengan kosong: server menganggapnya kunci, lalu Anthropic menolaknya dan chat menjawab "kunci API Anthropic ditolak". Setelah mengisi kunci, mulai ulang `bun dev` dan jalankan `bun run warm` supaya rekomendasi 10 wilayah dibuat di muka (sekitar 10 detik per wilayah) dan tidak ditunggu saat demo.

### Bila ada masalah

| Gejala | Penyebab dan perbaikan |
|---|---|
| `bun run setup` berhenti dengan "database tidak menjawab" | Docker belum jalan atau database belum siap. Jalankan `docker compose up -d`, tunggu `docker compose ps` menampilkan status healthy, lalu ulangi `bun run setup`. |
| Port 5433 atau 3000 sudah terpakai | Hentikan program yang memakainya, atau ubah `PORT` di `.env`. Untuk 5433, ubah juga pemetaan port di `docker-compose.yml` dan `DATABASE_URL`. |
| Layar menampilkan "Peta belum bisa ditampilkan" | Periksa `MAPBOX_TOKEN` (harus token publik yang valid), koneksi internet, dan WebGL di browser. Mulai ulang `bun dev` setelah mengubah `.env`, lalu klik "Coba lagi". |
| `setup` mencetak catatan tentang `MAPBOX_TOKEN` | Token kosong, masih contoh dari `.env.example`, atau bukan token publik. |
| Chat menulis "Asisten AI belum aktif" | `ANTHROPIC_API_KEY` kosong. Itu wajar tanpa kunci; isi kunci di `.env` dan mulai ulang `bun dev` bila ingin chat. |
| Chat menjawab "kunci API Anthropic ditolak" | `ANTHROPIC_API_KEY` berisi nilai yang bukan kunci asli (misalnya nilai contoh). Isi kunci yang benar, atau kosongkan. |

### Menjalankan sebagai image Docker (opsional)

`Dockerfile` membuat image aplikasi. Caranya ada di [docs/technical/architecture.md](docs/technical/architecture.md#image-docker-aplikasi).

## Menjalankan tes

```
bun test              # tes unit, API, dan komponen (lebih dari 700 tes)
bun run typecheck     # pemeriksaan tipe TypeScript
bun run smoke         # pemeriksaan browser otomatis, server harus sudah jalan (bun dev)
```

`bun test` tidak butuh internet. Tes yang membutuhkan database (`tests/server/db.test.ts`) dilewati otomatis bila database belum menyala. `bun run smoke` membuka aplikasi di Chromium milik Playwright (pasang dengan `bunx playwright install chromium` bila belum ada), memeriksa intro, wilayah, pembangkit, hover, klik, saklar, hujan (termasuk hujan otomatis), panel gedung dengan tab Surya dan Cuaca, rekomendasi dan lembar metodologi, serta chat dengan aksi petanya, lalu gagal bila ada galat konsol. Jawaban chat di pemeriksaan ini tiruan (tidak memanggil Anthropic), tetapi server harus melaporkan chat aktif, jadi isi `ANTHROPIC_API_KEY` (nilai apa pun yang berbentuk kunci cukup) sebelum menjalankannya.

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
| Mapbox (gaya Standard, medan, Tilequery, Search Box, dan Mapbox GL JS v3) | Peta dasar, gedung 3D, pencarian POI gedung, dan pencarian tempat untuk chat | Syarat layanan Mapbox (Mapbox Terms of Service). Peta menampilkan atribusi Mapbox dan OpenStreetMap |
| [Global Energy Monitor (gem.wiki)](https://www.gem.wiki/) dan sumber berita dan perusahaan | Kapasitas, status, dan koordinat pembangkit | gem.wiki berlisensi CC BY-NC-SA, dan aplikasi ini non-komersial. 9 dari 13 koordinat adalah perkiraan tim dan ditandai `approx` |
| [Anthropic API](https://www.anthropic.com/) (Claude, `claude-sonnet-5-5`) | Chat AI dan rekomendasi pemerintah. Yang dikirim hanya pertanyaan pengguna, keadaan peta, dan angka dari aplikasi | Syarat layanan Anthropic. Tidak ada data pribadi yang dikirim, dan kunci API hanya ada di server |
| Berita dan blog vendor 2026 (tarif PLN, harga panel dan baterai) | Asumsi biaya dan tarif di simulasi surya | Belum diverifikasi, dicatat sebagai asumsi dan diberi label "perkiraan" |

Perangkat lunak pihak ketiga: Bun, React, HeroUI, Motion, Zustand, dan Tailwind CSS berlisensi MIT; TypeScript dan Playwright berlisensi Apache-2.0; ikon Gravity UI berlisensi MIT; Mapbox GL JS v3 berlisensi Mapbox Terms of Service; PostgreSQL dan PostGIS berjalan sebagai layanan Docker terpisah dari image resmi `postgis/postgis`.

## Metodologi singkat

- **Listrik per wilayah** adalah perkiraan: penjualan PLN per cabang (BPS 2024) dibagi ke wilayah menurut jumlah pelanggan, dengan beberapa asumsi yang tertulis di dokumen metodologi. Ketidakpastiannya sekitar 30% untuk wilayah dengan banyak industri.
- **CO2** = kWh × faktor emisi resmi Sistem Mahakam, **1,14 kg CO2/kWh** (data 2019, lebih tinggi dari rata-rata bauran karena berupa *combined margin*). Rincian per sumber memakai bauran listrik 2024 perkiraan kami (batu bara 66%, gas 25%, diesel 7%, surya 1%, biomassa 1%).
- **Gedung:** kWh per tahun = luas lantai dasar × jumlah lantai × intensitas energi per jenis gedung. Jenis gedung ditebak dari POI terdekat, atau dari luas bila tidak ada POI, dan bisa diubah pengguna.
- **Panel surya:** hasil per kWp = jam puncak matahari (NASA POWER) × 365 × 0,78. Panel hanya menghemat listrik yang dipakai langsung di gedung (kelebihan ke jaringan tidak dibayar, Permen ESDM 2/2024), jadi ukuran dan penghematan mengikuti porsi pemakaian siang, hari pakai per tahun, dan golongan tarif PLN menurut jenis gedung. CO2 yang dihindari dihitung dari listrik yang dipakai sendiri (yang masuk jaringan tidak dihitung) dengan faktor PLTS 1,13 kg CO2/kWh. Jumlah panel dibulatkan turun, paling sedikit satu panel. Biaya dan tarif memakai asumsi 2026.
- **Cuaca:** produksi per jam = kWp × radiasi Open-Meteo × 0,78, dibandingkan dengan produksi panel yang sama di bawah langit cerah (model Haurwitz).
- **Rekomendasi dan chat:** ditulis Claude hanya dari angka aplikasi. Chat mengambil angka lewat alat yang memakai rumus di atas, jadi angka di chat sama dengan angka di panel.

Rumus lengkap, tabel konstanta, dan sumbernya ada di bagian *Metodologi perhitungan* pada [docs/technical/architecture.md](docs/technical/architecture.md#metodologi-perhitungan).

## Batasan

- Tidak ada data meteran, IoT, atau sensor. Semua angka per gedung adalah hasil model.
- Angka listrik per wilayah adalah perkiraan hasil pembagian data cabang PLN. Bauran listrik adalah perkiraan dari kapasitas (plus minus sekitar 8 poin persentase).
- Faktor emisi 1,14 adalah angka resmi dari data 2019 dan belum ada edisi yang lebih baru.
- Intensitas energi rumah, ruko, sekolah, kampus, rumah ibadah, gudang, dan industri adalah asumsi. Industri berat tidak terwakili.
- Simulasi surya memakai neraca per jenis hari dengan balik modal sederhana. Porsi pemakaian siang, hari pakai, harga, dan tarif belum diverifikasi; tarif sosial untuk sekolah, kampus, rumah ibadah, dan rumah sakit belum dimodelkan.
- Rekomendasi dan jawaban chat ditulis AI dari angka aplikasi. Angkanya dari data, tetapi kalimat dan pertimbangannya perlu diperiksa manusia sebelum dipakai untuk keputusan. Pencarian tempat di chat memakai data Mapbox yang bisa belum lengkap.
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
| Skrip demo langsung | [docs/technical/demo-script.md](docs/technical/demo-script.md) |
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

> **TODO (tim): isi bagian ini sebelum berkas dikirim.** Ganti "Nama Anggota 1" sampai "Nama Anggota 3", "Asal Instansi", dan kolom "Peran" dengan data yang sebenarnya. Teks di bawah ini hanya pengisi sementara.

Tim **Malas Ngoding**, asal instansi: **Asal Instansi**.

| No | Nama | Peran |
|---|---|---|
| 1 | Nama Anggota 1 | (isi peran) |
| 2 | Nama Anggota 2 | (isi peran) |
| 3 | Nama Anggota 3 | (isi peran) |

### Prototipe pengajuan pemasangan baru

Menu warga **Pasang panel** dan pemda **Laporan PLTS → Pengajuan pemasangan baru** membuka alur demonstrasi terpisah dari laporan panel terpasang. Jalankan bergantian dengan akun warga dan pemda pada browser/origin yang sama: ajukan survei, jadwalkan survei (WITA), terbitkan rancangan contoh, setujui dari akun warga, jadwalkan pemasangan, mulai pemasangan, lalu selesaikan dan buka pemantauan simulasi.

Implementasi UI: `src/web/panels/InstallationJourney.tsx`. State demo disimpan di localStorage `solar-installation-prototype-v1`, dibatasi akun/rumah pada tampilan warga. Tidak ada kontak pribadi, pesanan nyata, pembayaran, atau perubahan status pemasangan di database. Akun pemda melihat antrean demo lokal. Ini bukan kontrol akses server; data browser hanya untuk presentasi. Timeline dapat dibuka, dan pengajuan rumah bisa direset dari **Ulangi presentasi**. Setelah pemasangan demo, model panel sementara ditampilkan pada atap yang ditemukan dan muat; model dibersihkan saat keluar. Anggaran memakai asumsi contoh Rp5,5 juta per panel termasuk komponen sistem, terpisah dari kalkulasi kelayakan backend.

QA alur lintas peran, refresh, model atap, tampilan ponsel, dan tanpa mutasi API rumah/laporan: `bun scripts/check-installation-journey.ts`. Backend produksi untuk pengajuan pemasangan baru tetap memerlukan kontrak terpisah; endpoint laporan terpasang tetap memakai kontrak verifikasi yang sudah ada.
