# Laporan pemasangan PLTS atap: alur dan kontrak API

Tanggal: 23 Oktober 2026. Backend: Claude. UI: Codex. Dokumen ini menggantikan bagian "Kontrak API" serta "Status dan hak tindakan" pada `2026-10-22-solar-applications-handoff.md`. Tipe bersama: `src/shared/applications.ts`.

## Mengapa alurnya berubah

Menurut Permen ESDM 2/2024, pemasangan PLTS atap rumah disetujui oleh PLN dan dikerjakan badan usaha pemasang. Bukti keamanannya berupa SLO atau nomor registrasi ESDM. Pemda tidak memberi izin pasang dan tidak menerbitkan penawaran harga.

Karena itu, aplikasi tidak lagi memuat alur "ajukan pemasangan". Penggantinya adalah **laporan pemasangan**:

1. Warga yang panelnya sudah terpasang mengirim data beserta foto.
2. Pemda memeriksa laporan itu, dengan survei lapangan bila perlu, lalu menandainya **Terverifikasi pemda (pendataan)**.

UI tidak boleh menyebut verifikasi ini sebagai izin pasang, pengganti persetujuan PLN, atau pengganti SLO.

Akun yang dipakai tetap dua peran yang sudah ada: `warga` dan `pemda`. Akun dummy `demo@warga.local` dan `demo@pemda.local` sudah cukup untuk mencoba alurnya.

## Alur status

```
warga kirim laporan + foto
        │
   submitted ──(pemda start_review)──► under_review
        ▲                                   │
        │                ┌──────────────────┼───────────────────────┐
  (warga resubmit)       │                  │                       │
        │        request_changes     schedule_survey          verify / reject
        │                ▼                  ▼                       ▼
   needs_changes ◄── survey_scheduled ──(verify/reject)──► verified | rejected
   (warga edit)          (reschedule_survey tetap di status ini)

Warga dapat cancel → cancelled selama status belum verified atau rejected.
```

| Status | Label warga | Siapa bergerak berikutnya |
|---|---|---|
| `submitted` | Laporan diterima | Pemda: `start_review`. Warga: `cancel` |
| `under_review` | Data sedang diperiksa | Pemda: `request_changes`, `schedule_survey`, `verify`, `reject`. Warga: `cancel` |
| `needs_changes` | Lengkapi data | Warga: `edit` (PATCH), `resubmit`, `cancel` |
| `survey_scheduled` | Survei dijadwalkan | Pemda: `reschedule_survey`, `request_changes`, `verify`, `reject`. Warga: `cancel` |
| `verified` | Terverifikasi pemda (pendataan) | Status akhir. Kapasitas terverifikasi tercatat di rumah |
| `rejected` | Belum dapat diverifikasi | Status akhir, alasan wajib. Warga boleh mengirim laporan baru |
| `cancelled` | Dibatalkan | Status akhir |

Aturan yang berlaku:

- Satu warga hanya boleh punya satu laporan aktif, yaitu laporan yang belum berstatus akhir. Aturan ini dijaga database.
- `request_changes` dan `reject` wajib menyertakan `publicNote`. Catatan ini tampil di timeline warga.
- `verify` hanya bisa dilakukan bila ada bukti SLO atau registrasi: nomor dokumen atau foto berjenis `compliance`, dan `complianceType` bukan `pending`. Bila belum ada, `verify` tidak muncul di `allowedActions` dan server menolak dengan 409 `compliance_missing`.
- `verify` dari `under_review` dicatat sebagai `method: "document"`. Dari `survey_scheduled` dicatat sebagai `method: "survey"`.
- Setiap aksi wajib menyertakan `expectedVersion`. Versi lama ditolak dengan 409 `version_conflict`, dan UI harus memuat ulang laporan.
- **Tombol aksi hanya diambil dari `allowedActions`.** UI tidak menghitung sendiri aksi yang boleh dilakukan.

## Endpoint

Semua permintaan memakai cookie sesi. Permintaan tulis yang berasal dari origin lain ditolak dengan 403.

Format error: `{ "error": "pesan Indonesia", "code": "..." }`. Daftar `code` ada di `ApplicationErrorCode`.

| Metode dan path | Akses | Hasil |
|---|---|---|
| POST `/api/me/solar-application-files` | warga | Unggah satu foto (multipart: `kind`, `file`). 201 `{ file }` |
| POST `/api/me/solar-applications` | warga | Kirim laporan. Header `Idempotency-Key: <uuid>` wajib. 201 `{ application }`; ulangan dengan kunci dan isi sama mendapat 200 dengan laporan yang sama |
| GET `/api/me/solar-applications?cursor=&limit=` | warga | `{ items: SolarApplicationSummary[], nextCursor }` |
| GET `/api/me/solar-applications/:id` | warga pemilik | `{ application: SolarApplication }` |
| PATCH `/api/me/solar-applications/:id` | warga pemilik, hanya saat `needs_changes` | Perbaiki sebagian field dan/atau tambah foto (`addFileIds`) |
| POST `/api/me/solar-applications/:id/actions` | warga pemilik | `resubmit`, `cancel` |
| GET `/api/pemda/solar-applications?status=a,b&regionId=&q=&cursor=&limit=` | pemda | `{ items: PemdaApplicationSummary[], nextCursor }`. `q` mencari nomor referensi atau nama kontak |
| GET `/api/pemda/solar-applications/:id` | pemda | `{ application: PemdaSolarApplication }`, termasuk catatan internal dan siapa yang bertindak |
| POST `/api/pemda/solar-applications/:id/actions` | pemda | `start_review`, `request_changes`, `schedule_survey`, `reschedule_survey`, `verify`, `reject` |
| GET `/api/solar-application-files/:id` | pemilik foto; pemda hanya untuk foto yang sudah terlampir di laporan | Isi gambar |

Laporan milik warga lain selalu dijawab 404 tanpa isi apa pun. `limit` default 20, maksimum 50.

### Foto

- **Jenis (`kind`):** `installation` (foto panel terpasang, wajib minimal satu), `pln_approval`, `compliance` (SLO atau registrasi), `other`.
- **Format:** JPEG, PNG, atau WebP, maksimum 5 MB. Jenis berkas diperiksa dari isinya, bukan dari nama berkas.
- **Batas:** maksimum 10 foto per laporan.
- **Foto yang belum terlampir** hilang setelah satu hari. Satu akun boleh menyimpan paling banyak 20 foto yang belum terlampir.
- **Alur UI:** unggah foto dulu, simpan id-nya, lalu kirim laporan dengan `fileIds`. Bila pengiriman gagal, ulangi dengan `Idempotency-Key` dan isi yang sama.

### Contoh kirim laporan

```http
POST /api/me/solar-applications
Idempotency-Key: 6f1c2a9e-1b7a-4c2e-9d0e-3a5b7c9d1e2f
Content-Type: application/json

{
  "expectedHomeUpdatedAt": "2026-10-22T08:00:00.000Z",
  "installedKwp": 2.2,
  "panelCount": 4,
  "installedOn": "2026-09-30",
  "installerName": "CV Surya Mahakam",
  "plnApprovalNumber": null,
  "complianceType": "registration",
  "complianceNumber": null,
  "contactName": "Budi Santoso",
  "phone": "0812 3456 7890",
  "ownership": "owner",
  "ownerPermissionConfirmed": true,
  "preferredContactWindow": "weekday_afternoon",
  "notes": "Hubungi sebelum datang",
  "consentApplicationProcessing": true,
  "fileIds": ["<id foto installation>", "<id foto compliance>"]
}
```

Catatan field:

- `expectedHomeUpdatedAt` diisi dengan `home.updatedAt` dari GET `/api/me/home`. Bila rumah sudah berubah sejak formulir dibuka, server menjawab 409 `home_changed`.
- `complianceType` bernilai `slo`, `registration`, atau `pending`. Nomor dokumen boleh kosong bila fotonya dilampirkan.
- Telepon disimpan dalam format `08…`.
- `installedOn` tidak boleh tanggal di masa depan (dihitung dalam WITA).

Jawaban 201 (dipersingkat):

```json
{ "application": {
  "id": "…uuid…", "reference": "PLTS-2026-000001", "status": "submitted", "version": 1,
  "homeSnapshot": { "featureId": "…", "regionName": "Samarinda", "potentialKwp": 12.65, "homeUpdatedAt": "…" },
  "estimate": { "panelCount": 4, "kWp": 2.2, "savingRpYear": 0, "assumptions": ["…"], "modelVersion": "solar-2026-10" },
  "report": { "installedKwp": 2.2, "complianceType": "registration", "…": "…" },
  "contact": { "name": "Budi Santoso", "phone": "081234567890", "…": "…" },
  "survey": null, "verification": null,
  "files": [{ "id": "…", "kind": "installation", "url": "/api/solar-application-files/…" }],
  "events": [{ "action": "create", "status": "submitted", "title": "Laporan pemasangan dikirim", "publicNote": null }],
  "allowedActions": ["cancel"],
  "warnings": []
} }
```

`estimate` adalah perkiraan aplikasi untuk jumlah panel yang dilaporkan, disimpan saat laporan dikirim. UI wajib memberinya label "perkiraan". `warnings` dapat berisi `exceeds_roof_estimate` atau `compliance_pending`; keduanya hanya peringatan dan tidak menolak laporan.

### Contoh aksi pemda

```json
{ "action": "schedule_survey", "expectedVersion": 2,
  "survey": { "startsAt": "2026-11-02T09:00:00+08:00", "endsAt": "2026-11-02T11:00:00+08:00" },
  "publicNote": "Petugas datang pagi.", "internalNote": "Bawa meteran." }

{ "action": "verify", "expectedVersion": 3, "verifiedKwp": 2.2 }

{ "action": "request_changes", "expectedVersion": 2, "publicNote": "Foto SLO belum terbaca." }
```

Aturan jadwal survei:

- Waktu wajib berformat ISO 8601 dengan zona waktu. Server menyimpannya dalam UTC; tampilkan dalam WITA (`APPLICATION_TIME_ZONE`).
- Durasi survei paling lama 12 jam.
- Survei dijadwalkan mulai sekarang sampai satu tahun ke depan.

## Perubahan pada data yang sudah ada

- `Home` mendapat field `verifiedKwp` dan `verifiedAt`. Keduanya hanya diisi oleh `verify`. Field `installedPv` dan `installedKwp` tetap merupakan laporan mandiri warga, dan PUT `/api/me/home` tidak mengubah nilai terverifikasi. Bila rumah dipindah ke bangunan lain, nilai terverifikasi dihapus.
- `PemdaRegionSummary` dan totalnya mendapat field `verified` dan `verifiedKwp`.
- DELETE `/api/me/home` ditolak dengan 409 `active_application_exists` selama warga masih punya laporan aktif.

## Penyimpanan

Migrasi `db/migrations/006_solar_applications.sql` membuat tabel berikut:

- `solar_applications`: snapshot rumah, estimasi, laporan, dan kontak (jsonb), ditambah `version`.
- `solar_application_events`: timeline sekaligus audit (aktor, catatan internal, isi sebelum diperbaiki).
- `solar_application_files`: foto (bytea).
- `solar_application_requests`: kunci idempotensi.

Migrasi yang sama menambah kolom `homes.verified_kwp` dan `homes.verified_at`.

Satu laporan aktif per warga dijaga oleh unique index parsial. Kunci idempotensi, aturan satu laporan aktif, pemeriksaan versi rumah, dan pelampiran foto berjalan dalam satu transaksi, dengan baris user dikunci terlebih dahulu.

## Pengujian

- `tests/server/applications.test.ts` (fake) menguji:
  - alur lengkap
  - akses antar akun
  - peran
  - idempotensi
  - kiriman bersamaan
  - konflik versi
  - validasi
  - foto
  - snapshot
  - penghapusan rumah
- `tests/server/applications.db.test.ts` menguji hal yang sama di Postgres: index parsial, kunci baris, dan presisi waktu. Tes ini membuat akun `apptest-*` lalu menghapusnya, dan dilewati bila database tidak menyala.

## Keterbatasan yang tersisa

- **Foto:** belum ada pemeriksaan lokasi GPS dari EXIF, dan foto tidak diperkecil atau dibersihkan metadatanya. Foto hanya terlihat oleh pemilik dan pemda.
- **Verifikasi dokumen:** pemda belum bisa memeriksa nomor SLO atau registrasi ke sistem ESDM, karena belum ada integrasi.
- **Peran pemda:** belum ada pembagian peran di dalam pemda; semua akun pemda dapat melakukan semua aksi.
- **Dasbor:** peta titik rumah pemda (`/api/pemda/homes`) belum menampilkan kapasitas terverifikasi; ringkasan wilayah sudah.
- **Rate limit:** berjalan di memori satu proses (10 kirim dan 30 unggah per menit per alamat).
