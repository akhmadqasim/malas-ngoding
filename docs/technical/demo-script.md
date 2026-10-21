# Skrip demo langsung (5 sampai 7 menit)

Skrip ini untuk demo di depan juri. Waktu total sekitar 6 menit 45 detik bila semuanya lancar, dan ada ruang sekitar 15 detik untuk jawaban AI yang lambat. Kalimat bercetak miring adalah contoh ucapan; sesuaikan dengan gaya presenter. Angka di layar adalah perkiraan model, jadi ucapkan "perkiraan" saat menyebutnya.

Skrip ini hanya memakai fitur yang ada di aplikasi. Urutannya: globe pembuka, ringkasan provinsi, rincian wilayah dengan rekomendasi, klik gedung (Energi, Emisi, Surya, Cuaca), hujan, chat yang menggerakkan peta, lalu metodologi.

## Sebelum demo

Lakukan 15 menit sebelum mulai, bukan di depan juri.

1. **Layanan.** `docker compose up -d`, lalu `bun run setup` (aman diulang). Pastikan baris terakhirnya "rekomendasi AI 10/10 wilayah". Itu membuat rekomendasi 10 wilayah di muka, jadi kartu rekomendasi langsung muncul dan tidak menunggu model 8 sampai 10 detik.
2. **Server.** `bun start` (mode produksi, lebih ringan) atau `bun dev`. Buka `http://localhost:3000` di Chrome atau Edge terbaru dengan WebGL aktif, layar penuh (F11), zoom browser 100%.
3. **Kunci AI.** `.env` harus berisi `MAPBOX_TOKEN` publik dan `ANTHROPIC_API_KEY` asli. Buka panel chat sekali: bila tertulis "Asisten AI belum aktif", kunci belum terbaca dan chat tidak akan menjawab (lihat bagian Cadangan).
4. **Pemanasan cache gedung.** Cari gedung demo (lihat langkah 4 di bawah), klik, dan buka keempat tabnya sekali, termasuk Cuaca. Itu mengisi cache POI, klimatologi NASA, dan prakiraan Open-Meteo (segar 1 jam; bila sumbernya mati, prakiraan lama tetap dipakai). Tutup panel lalu muat ulang halaman.
5. **Cahaya.** Untuk tampilan paling dramatis pakai malam: buka `http://localhost:3000/?cahaya=night`. Saklar "Cahaya" tetap bisa diubah di tengah demo. Garis hujan terlihat di semua cahaya (di cahaya terang peta menambah kabut tipis supaya garisnya tampak).
6. **Cadangan visual.** Buka `docs/technical/screens/` di tab lain (map, building, solar, chat, rain) dan siapkan PDF dokumentasi. Itu bahan bila peta tidak bisa dimuat.
7. **Tutup** semua notifikasi dan tab lain. Matikan jeda layar.

## Alur demo

| Waktu | Bagian | Aksi di layar |
|---|---|---|
| 0:00 | 1. Intro globe | Biarkan intro berjalan |
| 0:45 | 2. Ringkasan provinsi | Daftar peringkat, saklar Tinggi kolom, pembangkit |
| 1:45 | 3. Rincian wilayah | Klik Samarinda, lalu Kutai Barat, buka rekomendasi |
| 2:45 | 4. Klik gedung | Energi, Emisi, ganti jenis, Surya, Cuaca |
| 4:30 | 5. Hujan | Saklar Hujan di tingkat gedung |
| 5:00 | 6. Chat | Tiga sampai empat pertanyaan yang menggerakkan peta |
| 6:15 | 7. Metodologi dan penutup | Tentang peta ini, Cara menghitung dan sumber data |

### 1. Intro globe (0:00 sampai 0:45)

- **Aksi.** Muat halaman. Kamera terbang sekitar 6 detik dari globe ke Kalimantan Timur, dan sepuluh kolom wilayah tumbuh dari barat ke timur.
- **Ucapan.** *"Ini Malas Ngoding, kembar digital energi Kalimantan Timur. Peta ini menjawab tiga pertanyaan: dari mana listrik kita, berapa yang kita pakai, dan berapa CO2 yang ikut terlepas. Subtema kami SDG 7."*
- **Catatan.** Bila waktu mepet, tombol "Lewati intro" atau Esc langsung mendarat di tampilan provinsi.

### 2. Ringkasan provinsi (0:45 sampai 1:45)

- **Aksi.**
  1. Tunjuk angka besar di panel kiri: total emisi sekitar 6,1 juta ton CO2 per tahun, perkiraan.
  2. Arahkan penunjuk ke kolom Samarinda, lalu ke deretan di daftar peringkat. Kolom terangkat, tooltip muncul, dan jarum meter di legenda berayun.
  3. Di kartu legenda, ganti "Tinggi kolom" dari Emisi CO2 ke Listrik dan kembali. Tinggi dan warna kolom bergerak.
  4. Arahkan penunjuk ke satu titik pembangkit untuk memperlihatkan nama, bahan bakar, kapasitas, dan "Lokasi perkiraan".
- **Ucapan.** *"Tinggi kolom adalah emisi per tahun. Samarinda, Kutai Kartanegara, dan Balikpapan paling tinggi. Titik berwarna adalah 13 pembangkit, abu-abu untuk batu bara. Sebagian besar listrik kita berasal dari batu bara. Semua angka ini perkiraan, kami tulis sumbernya."*

### 3. Rincian wilayah dan rekomendasi (1:45 sampai 2:45)

- **Aksi.**
  1. Klik Samarinda (kolom atau baris daftar). Kamera terbang dan panel kiri berganti ke rincian: emisi, bagian dari listrik Kaltim, listrik per orang, penduduk, pelanggan PLN, rasio elektrifikasi, dan asal listrik Kaltim.
  2. Gulir panel ke kartu **Rekomendasi untuk Pemkot Samarinda**. Buka satu butir (butir pertama sudah terbuka): prioritas, kategori, isi, dampak yang diharapkan.
  3. Klik "Semua wilayah", lalu klik **Kutai Barat**. Tunjuk "Desa belum dilayani PLN" (21 desa) dan buka rekomendasi pertamanya, yang pada salinan tersimpan saat ini berjudul "Usulkan listrik PLN untuk 21 desa belum berlistrik". Samarinda, yang listriknya sudah merata, mendapat saran pertama tentang PLTS atap di gedung pemerintah.
- **Ucapan.** *"Untuk tiap kabupaten dan kota ada rekomendasi bagi pemerintah daerah. Claude menulisnya dari data wilayah itu saja, jadi Kutai Barat yang punya desa belum berlistrik mendapat saran yang berbeda dari Samarinda. Tulisan di kartu menyebut bahwa ini ditulis AI dan perlu diperiksa."*
- **Catatan.** Kartu menulis "Ditulis AI (model) pada ..." bila rekomendasi dari Claude, dan "Berbasis aturan" bila AI tidak ada. Keduanya sah untuk demo.

### 4. Klik gedung (2:45 sampai 4:30)

- **Aksi.**
  1. Kembali ke Samarinda lalu perbesar sampai tingkat kota (kolom memudar, gedung 3D tampil). Mulai dekat pusat kota, sekitar koordinat 117,1475 BT, 0,4955 LS, pembesaran 16 sampai 17. Klik satu gedung besar. Panel gedung terbuka di kanan.
  2. **Energi.** Tunjuk "Listrik terpakai ... kWh per tahun, perkiraan", per bulan, intensitas, dan luas lantai (luas dasar × lantai). Tunjuk asumsinya: jenis gedung dari data peta atau ditebak dari luas.
  3. Ganti **jenis gedung** (misalnya dari Rumah ke Sekolah) dan naikkan **jumlah lantai**. Angka dihitung ulang dalam sekejap.
  4. **Emisi.** CO2 per tahun, "Asal listrik gedung ini" (bauran batu bara, gas, diesel), dan padanan: km naik mobil, pohon, charge HP, penerbangan.
  5. **Surya.** Cincin cakupan kebutuhan, produksi panel lawan kebutuhan (bagian yang dipakai di gedung dan bagian ke jaringan tanpa imbalan), biaya, hemat listrik, balik modal, CO2 dihindari. Geser slider cadangan baterai: angka berjalan.
  6. **Cuaca.** Baris "Sekarang ...", grafik produksi 72 jam dengan jam hujan diarsir, dan daftar per hari yang menulis turunnya produksi karena hujan atau awan.
- **Ucapan.** *"Gedung ini tidak punya meteran. Kami menghitungnya dari luas dasar di peta, jumlah lantai, dan intensitas energi menurut jenis gedung, yang ditebak dari tempat terdekat di peta. Panel surya tidak hanya menjumlah atap: tarif PLN dan jam pakai mengikuti jenis gedung, dan listrik yang dikirim ke PLN tidak dihargai, sesuai Permen ESDM 2 tahun 2024. Prakiraan cuaca dari Open-Meteo menunjukkan hari mana yang produksinya turun karena hujan."*
- **Catatan.** Bila gedung yang diklik punya tinggi tidak dikenal, asumsi menulis jumlah lantai umum; itu wajar. Untuk jenis kantor pemerintah, sekolah, atau rumah, tarif dan hari pakai berbeda, dan itu menarik untuk ditunjukkan sekali.

### 5. Hujan (4:30 sampai 5:00)

- **Aksi.** Pada pembesaran gedung (15 atau lebih), nyalakan saklar **Hujan** di kartu "Lapisan dan suasana peta". Garis hujan turun di atas gedung. Bila saat demo memang sedang hujan di Samarinda, hujan menyala sendiri (mode otomatis) dan keterangan di bawah saklar menulis "Sedang hujan di sini menurut prakiraan Open-Meteo".
- **Ucapan.** *"Saklar hujan bawaannya otomatis: peta ikut hujan bila prakiraan di pusat peta mengatakan sedang hujan. Di tampilan provinsi efeknya sengaja tidak tampak, supaya tidak menutupi kolom."*
- **Catatan.** Matikan lagi saklarnya sebelum ke bagian chat.

### 6. Chat yang menggerakkan peta (5:00 sampai 6:15)

Buka tombol chat di pojok kanan bawah. Pakai pertanyaan di bawah, berurutan. Jawaban datang bertahap, dan tombol aksi muncul di bawah jawaban. Selama jawaban berjalan, jelaskan apa yang terjadi.

| Pertanyaan | Yang terjadi kira-kira | Yang ditunjukkan |
|---|---|---|
| "Wilayah mana emisinya paling tinggi?" | Claude memanggil `list_regions`, lalu aksi `show_all_regions` dan `set_metric`. Peta kembali ke seluruh Kaltim dan mengurutkan menurut emisi. | Angka datang dari alat, bukan ingatan |
| "Tunjukkan gedung sekolah di Samarinda" | `find_places` mencari sekolah, lima tempat ditandai di peta, lalu aksi `select_building_at` memilih satu gedung dan panel gedung terbuka dengan jenis Sekolah. | Chat menggerakkan peta dan membuka panel |
| "Kalau gedung ini pakai panel surya?" | `simulate_solar` dengan data gedung terpilih, lalu aksi `open_tab` membuka tab Surya. | Angka chat sama dengan angka tab Surya |
| "Besok hujan? Berapa listrik suryanya?" | `get_weather`, lalu tab Cuaca terbuka. | Prakiraan dan produksi panel |
| (opsional) "Apa saran untuk pemerintah Kutai Barat?" | `get_recommendations` dan `fly_to_region` ke Kutai Barat; chat meringkas dua atau tiga saran. | Rekomendasi yang sama dengan kartu wilayah |

- **Ucapan.** *"Chat ini tidak mengarang angka. Setiap angka datang dari alat yang membaca data dan rumus aplikasi, sama dengan yang di panel. Dan chat ikut menggerakkan peta: terbang, menandai sekolah, memilih gedung, membuka tab."*
- **Catatan.** Empat pertanyaan pertama persis seperti tombol saran di panel chat, jadi bisa diklik. Tiap jawaban memakan beberapa detik sampai belasan detik, dan jawaban yang memanggil beberapa alat lebih lama. Bila waktu mepet, lewati pertanyaan opsional.

### 7. Metodologi dan penutup (6:15 sampai 6:45)

- **Aksi.** Klik ikon info (Tentang peta ini) di alat peta kanan bawah, lalu **Cara menghitung dan sumber data**. Gulir cepat: listrik per wilayah, emisi (faktor resmi 1,14 kg CO2/kWh), bauran listrik dengan baris bertanda *asumsi*, panel surya, dan sumber data dengan lisensinya.
- **Ucapan.** *"Kami tidak menyembunyikan asumsi. Baris bertanda asumsi belum punya sumber terverifikasi, dan semua sumber tertulis lengkap dengan lisensinya. Intinya: listrik Kaltim sebagian besar dari batu bara, tiap gedung bisa melihat dampaknya dan apa yang berubah dengan panel surya, dan pemerintah daerah mendapat saran yang berdasar data. Terima kasih."*

## Cadangan bila ada yang gagal

| Masalah | Tanda | Yang dilakukan |
|---|---|---|
| **Peta tidak mau dimuat** (internet atau Mapbox mati, token ditolak, WebGL mati) | Kartu "Peta belum bisa ditampilkan" dengan tombol "Coba lagi" | Klik "Coba lagi" satu kali. Bila tetap gagal, beralih ke tangkapan layar di `docs/technical/screens/` dan PDF dokumentasi, dan ceritakan alurnya. Peta tidak punya mode luring karena ubin dan gedung 3D datang dari Mapbox. |
| **Internet putus di tengah demo** | Ubin peta berhenti memuat; panel yang datanya sudah ada tetap tampil | Tetap di wilayah dan gedung yang sudah dibuka. Data wilayah, gedung yang sudah dihitung, dan rekomendasi ada di database lokal, jadi tetap muncul. Hindari terbang ke area baru. |
| **Anthropic lambat atau mati** | Jawaban chat lama, atau baris galat "Asisten AI sedang sibuk", "terlalu lama menjawab", atau "tidak bisa terhubung" | Tunggu sampai 30 detik sambil menjelaskan. Bila muncul galat, klik "Coba lagi" di jawaban itu atau tanyakan lagi. Bila tetap mati, lompati bagian chat dan tunjukkan tombol saran, lalu lanjut ke metodologi. Kartu rekomendasi tetap jalan dari cache. |
| **Chat menulis "Asisten AI belum aktif"** | Kotak pertanyaan mati | Kunci Anthropic kosong. Jelaskan bahwa chat butuh kunci, lalu lanjut tanpa chat: semua fitur lain dan rekomendasi (berbasis aturan) tetap jalan. Demo ini sah tanpa chat; ganti bagian 6 dengan membuka kartu rekomendasi wilayah lain. |
| **Chat menulis "kunci API Anthropic ditolak"** | Galat setelah bertanya | `.env` berisi nilai contoh. Kosongkan atau isi kunci benar, mulai ulang server, dan lanjut tanpa chat untuk sekarang. |
| **Kartu rekomendasi lama memuat** | Progres "Menyusun rekomendasi" lebih dari 10 detik | Cache belum diisi. Tunggu (bisa sampai 2 menit pada wilayah pertama), atau buka wilayah lain yang sudah hangat. Pencegahan: `bun run setup` sebelum demo. |
| **Tab Surya menulis catatan asumsi 4,2 jam** | Catatan "Data radiasi matahari NASA POWER sedang tidak tersedia" di daftar asumsi | NASA POWER tidak terjangkau dan belum ada cache. Angka tetap tampil dengan jam matahari asumsi, dan catatan itu jujur. Sebut saja, lalu lanjut. |
| **Tab Cuaca gagal** | Pesan "Prakiraan cuaca sedang tidak tersedia" dengan tombol "Coba lagi" | Open-Meteo mati dan belum ada cache. Klik "Coba lagi" sekali, lalu beralih ke tab Surya. Bila cache lama ada, tab menulis "Open-Meteo sedang tidak bisa dihubungi, jadi ini prakiraan terakhir yang tersimpan" dan tetap menampilkan grafik. |
| **Panel gedung menulis "Perkiraan gedung gagal dimuat"** | Panel dengan tombol "Coba lagi" | Klik "Coba lagi". Bila server mati, mulai ulang `bun start` dan muat halaman. |
| **Jenis gedung ditebak dari luas** (POI Mapbox tidak menjawab) | Meta panel menulis "Jenis ditebak dari luas tapak" | Wajar. Ganti jenis lewat daftar pilihan bila perlu, dan sebut bahwa asumsinya tercatat. |
| **Gedung tidak ditemukan** lewat chat | Tombol aksi "Gedung tidak ditemukan" dan panel "Gedung tidak ditemukan" | Klik gedung langsung di peta. |
| **Database mati** | Panel menampilkan galat atau kartu "Peta belum bisa ditampilkan" saat memuat wilayah | `docker compose up -d`, tunggu status healthy, lalu muat ulang halaman. Bila masih gagal, mulai ulang server. |
| **Waktu mepet** | | Urutan yang boleh dipotong: pertanyaan opsional chat, tab Cuaca, rekomendasi Kutai Barat. Yang jangan dipotong: ringkasan provinsi, klik gedung dengan tab Surya, satu pertanyaan chat, metodologi. |

## Pertanyaan juri yang mungkin muncul

| Pertanyaan | Jawaban singkat |
|---|---|
| Dari mana angka listrik wilayah? | Penjualan PLN per cabang (BPS 2024) dibagi ke wilayah menurut jumlah pelanggan. Ini perkiraan, dan wilayah industri bisa meleset sekitar 30%. Rinciannya di lembar metodologi. |
| Mengapa faktor emisi 1,14? | Faktor resmi Sistem Mahakam dari Kepmen ESDM 163.K/HK.02/MEM.S/2021 (data 2019, combined margin). Untuk CO2 yang dihindari panel dipakai 1,13, faktor khusus PLTS dari Kepmen yang sama. |
| Apakah chat mengarang angka? | Tidak. Angka diambil lewat alat yang memakai data dan rumus aplikasi, sama dengan panel. Bila alat gagal, chat diminta berkata terus terang. |
| Bagaimana bila internet mati? | Data wilayah, pembangkit, dan cache ada di database lokal. Ubin peta Mapbox, cuaca, dan AI perlu internet; tiap fitur punya pesan galat atau cadangan. |
| Mengapa rekomendasi bisa "berbasis aturan"? | Bila Claude tidak tersedia, server menyusun saran dari data dengan aturan tetap, dan kartu menyebutnya dengan jelas. |
| Apakah ada data meteran? | Tidak. Semua angka per gedung adalah hasil model yang berlabel "perkiraan". |
| Bagaimana keamanannya? | Kunci Anthropic hanya di server, token Mapbox publik, semua isi permintaan diperiksa, tanpa akun dan tanpa data pribadi. Rinciannya di dokumen arsitektur. |
