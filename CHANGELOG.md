# Catatan Pengembangan

## 23 Oktober 2026 — Prototipe dashboard transisi energi

### Tampilan dan pengalaman pengguna

- Dashboard warga dan pemda dipisahkan sesuai tugas masing-masing.
- Warga langsung membuka rumah tersimpan setelah login atau refresh, tanpa mengulang tampilan globe.
- Fokus kamera rumah, posisi penanda atap, dan tampilan ponsel diperbaiki.
- Ikon Lucide serta karakter pendamping warga, pemda, dan teknisi digunakan untuk menjelaskan tindakan.
- Bentuk rumah, masjid, gudang, gedung pemerintahan, dan bangunan besar diberi variasi arsitektur; penempatan atap dan panel memperhitungkan tapak bangunan.
- Karakter 3D dan model panel serta turbin ditambahkan untuk demonstrasi peta.

### Energi dan kembar digital

- Pratinjau pemasangan panel di atap: atur jumlah panel, bandingkan sebelum/sesudah, dan lihat animasi pemasangan.
- Perhitungan produksi, pemakaian sendiri, biaya, dan penghematan menyesuaikan skenario panel.
- Cuaca lokasi, prakiraan produksi 24 jam, dan arah angin mendukung simulasi energi.
- Sensor virtual memperbarui pemantauan energi rumah dan estimasi dampak CO₂.
- Laboratorium simulasi menyediakan kondisi cerah, mendung, hujan, hujan lebat, malam, serta eksperimen baterai.
- Pemda dapat membandingkan prioritas transisi wilayah dan merencanakan PLTS atau PLTB dengan pemeriksaan lokasi.

### Akun, rumah, dan pendataan

- Registrasi, login, logout, akun demo, sesi cookie, dan pembatasan percobaan masuk.
- Pencarian alamat dan penyimpanan rumah pada akun warga.
- Data rumah demo untuk dashboard adopsi PLTS pemda.
- Pelaporan panel yang sudah terpasang, unggah foto, pemeriksaan pemda, permintaan perbaikan, penjadwalan survei, dan verifikasi untuk pendataan.
- Status pemasangan yang dilaporkan warga dibedakan dari kapasitas hasil verifikasi pemda.
- Asisten percakapan dapat menggunakan konteks rumah dan mengarahkan peta; pembaruan rekomendasi wilayah dibatasi untuk pemda.

### Prototipe pengajuan pemasangan baru

- Warga memilih paket contoh dan mengajukan survei melalui menu **Pasang panel**.
- Pemda menjadwalkan survei dan menerbitkan rancangan serta anggaran contoh.
- Warga menyetujui rancangan sebelum pemda melanjutkan penjadwalan pemasangan.
- Pemda menjalankan tahap pemasangan sampai selesai; warga dapat membuka pemantauan simulasi.
- Ikon, karakter pendamping, riwayat tahapan, jadwal WITA, serta reset presentasi tersedia.
- Data pengajuan baru disimpan di browser yang sama dan bertahan setelah refresh; tidak mengirim pesanan atau mengubah status rumah di database.

### Batas prototipe

- Sensor, progres pemasangan baru, tim teknisi, dan anggaran contoh merupakan simulasi.
- Cuaca berasal dari model layanan cuaca, bukan pengukuran sensor pada setiap gedung.
- Pelaporan panel terpasang memakai API/database; pengajuan pemasangan baru masih memakai penyimpanan browser.
- Integrasi sensor IoT, penyedia pemasangan nyata, pembayaran, dan notifikasi eksternal belum dihubungkan.

### Validasi

- Pemeriksaan tipe TypeScript dan pengujian backend, perhitungan energi, serta komponen peta.
- Pemeriksaan browser untuk alur warga/pemda, rumah setelah refresh, pratinjau panel, pelaporan terpasang, dan pengajuan pemasangan demo.
- Pengujian pengajuan demo mencakup seluruh tahapan lintas peran, tampilan ponsel, persistensi refresh, dan tidak adanya mutasi API rumah/laporan.
