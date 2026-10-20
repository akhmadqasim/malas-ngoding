# Electricity use by kabupaten/kota in Kalimantan Timur (research notes)

Date of research: 2026-10-20

## Summary

- The official BPS Kaltim tables I could reach did not give per-region electricity figures. The BPS Kaltim PDF "Provinsi Kalimantan Timur Dalam Angka 2025" is over 10 MB and my fetch tool could not read it, and its landing page shows no electricity numbers.
- The BPS table pages (population 2025, Samarinda kWh sold) load only their titles in my fetch tool. I could not read their values.
- Most numbers below come from search snippets or secondary sites (Databoks, Tribunkaltim, Antara). They are marked `estimated: true`. Treat them as unverified until someone checks the BPS table directly.
- Per-region kWh sold by customer group, electrification ratio per region, and PLN UID Kaltimra GWh data were not found.
- No 2026 edition of "Kalimantan Timur Dalam Angka" was found. The newest edition found is 2025.

## Definitions used

- `estimated: true` means the value is from a secondary site, a news snippet, or a page I could not open. It has not been checked against the primary BPS table.
- `estimated: false` is used only for values I read directly from a source I could open. No region-level value met that bar.
- `null` means not found.

## 1. Electricity sold (kWh) per region

| Region | Value | Year | Source status |
|---|---|---|---|
| Samarinda | About 1.38 billion kWh total; households about 753,180 thousand kWh; industry about 142,254 thousand kWh | 2025 | Search snippet of BPS Samarinda table "Perkembangan kWh Terjual di PLN Wilayah Kalimantan Timur dan Utara Area Samarinda menurut Jenis Pelanggan". Table page did not load in my fetch, so unverified. Note the table covers the PLN Kaltimra Samarinda area, which may not match the city boundary exactly. |
| Other 9 regions | Not found | | |

Customer-group split (rumah tangga, bisnis, industri, sosial, pemerintah): found only for Samarinda, from the same snippet. Business, social, and government values were not in the snippet.

Provincial: PLN UID Kaltimra reported sales growth of 22.66 percent, with industry sales up 109.79 percent. The year and absolute totals were not stated in the snippet.

## 2. PLN customers per region

Source: Tribunkaltim article (citing BPS), year 2024. The article page returned HTTP 403 when fetched, so these numbers come only from the search snippet. Unverified.

| Region | Customers (2024) |
|---|---|
| Samarinda | About 340,040 |
| Balikpapan | About 278,600 |
| Kutai Kartanegara | About 245,940 |
| Kutai Barat | About 58,540 |
| Other 6 regions | Not found |
| Province total | About 1,360,000 (2024) |

Also found: PLN UID Kaltimra added 72,517 customers in Q1 2024 and reported 25.39 percent annual customer growth (Antara Kaltim, 2024). This figure covers Kaltim and Kaltara together.

## 3. Population per region

| Region | Population | Year | Source status |
|---|---|---|---|
| Kutai Kartanegara | 818,897 | 2025 | Databoks, citing BPS semester data. Secondary. |
| Kutai Timur | 432,850 (432.85 thousand) | 2025 | Databoks, citing BPS. Secondary. |
| Berau | 246,740 (246.74 thousand) | 2025 | Databoks. Secondary. Databoks says the figure is falling. |
| Paser | 295,834 | Year not stated | Search snippet only. Verify before use. |
| Samarinda | 868,500 | 2024 | Databoks, citing BPS 2024. Secondary. Dukcapil June 2024 administrative count is 861,880. |
| Balikpapan | Not found in BPS 2025. Dukcapil June 2024: 738,530 | 2024 | Databoks compilation of Dukcapil data. Not a BPS figure. |
| Bontang | Not found in BPS 2025. Dukcapil June 2024: 189,970 | 2024 | Same as above. |
| Penajam Paser Utara, Kutai Barat, Mahakam Ulu | Not found | | |

Primary source for population: BPS Kaltim table "Jumlah Penduduk, Laju Pertumbuhan Penduduk, Distribusi Persentase Penduduk, Kepadatan Penduduk, dan Rasio Jenis Kelamin Penduduk menurut Kabupaten/Kota di Provinsi Kalimantan Timur, 2025". URL: https://kaltim.bps.go.id/en/statistics-table/3/V1ZSbFRUY3lTbFpEYTNsVWNGcDZjek53YkhsNFFUMDkjMyM2NDAw/jumlah-penduduk--laju-pertumbuhan-penduduk--distribusi-persentase-penduduk--kepadatan-penduduk--rasio-jenis-kelamin-penduduk-menurut-kabupaten-kota-di-provinsi-kalimantan-timur.html?year=2025 . The page showed the title only. Values need to be copied from it.

## 4. Electrification ratio and villages without PLN

Electrification ratio per region: not found.

Province (Susenas March 2025, via Tribunkaltim snippet, unverified): PLN household electrification 97.77 percent. Kutai Timur has the highest non-PLN household share at 14.01 percent.

Villages without PLN, verified (Antara Kaltim, fetched, dated 15 Nov 2023):
- 169 villages without PLN as of September 2023 (Dinas ESDM Kaltim).
- PLN village electrification ratio was 83.72 percent (869 of 1,038 villages) as of August 2023.
- Villages without PLN are in six regencies: Berau, Kutai Kartanegara, Kutai Timur, Paser, Kutai Barat, Mahakam Ulu. Kutai Barat and Mahakam Ulu have the most. No per-region count given.

Latest figures (unverified snippets):
- Koran Jakarta, 15 Sep 2026, citing Governor Rudy Mas'ud: 1,038 villages in Kaltim, 72 still without PLN. Kutai Barat 21, Mahakam Ulu 11, and the rest spread across Paser, Berau, Kutai Kartanegara, and Kutai Timur. The regional figures add up to 78, not 72. Check the source before use.
- The same snippet cites August 2024: 904 villages electrified, 134 not.
- Mongabay, May 2025: 110 villages across six regencies/cities, about 12,000 households affected. Snippet only.

Figures from 2023, 2024, 2025, and 2026 use different methods. Do not chart them as one series.

## Source list

Verified (fetched):
- Antara Kaltim, 169 villages without PLN, 15 Nov 2023: https://kaltim.antaranews.com/berita/201021/169-desa-di-kaltim-belum-tersentuh-aliran-listrik-pln
- BPS Kaltim, Kalimantan Timur Province in Figures 2025 landing page (release 28 Feb 2025, 15.1 MB, no electricity values visible): https://kaltim.bps.go.id/en/publication/2025/02/28/2fd1ffbcf042aa223f3b9b25/provinsi-kalimantan-timur-dalam-angka-2025.html
- BPS Kaltim PDF download link for the same publication (could not be read, file over 10 MB): https://web-api.bps.go.id/download.php?f=MpskQOYGkTtaZ4kQlS+Y73cxLzFVdlZhb0ZkaHVkQStFRloyQ3ltcS9GbXFkRlI3emEvd0FxZHFLT3Q2WFBqT09mNnhGVU9uYmZ4dHJvOXJlN2pXcldKVjc5cnZzNVY1eENiUE1RNjh5Z2NjWTVWTkltQ3l5VEtjTHY2VGl1cWphT3ZmRXU5STBnNzA5akJweFF3dWlBS0FualB4NnloSzl2aHZzNmZIWklYaitScmxhNXZQbWtrVHZENE5RcmlHUHpXZlhtOWRJZ0FGNGhnT1B4dFhYZ0hTd1pVZ2dDeVh1VTZNMHhHSUMwdktiYUdZMzhIVURvS0VHYU9kOVZKTyt5US9ILzZPK0J1andRejFtc0xueGtOenBudmwrcWlERFEzLyt3PT0=
- BPS Kaltim population table 2025 (title only): https://kaltim.bps.go.id/en/statistics-table/3/V1ZSbFRUY3lTbFpEYTNsVWNGcDZjek53YkhsNFFUMDkjMyM2NDAw/jumlah-penduduk--laju-pertumbuhan-penduduk--distribusi-persentase-penduduk--kepadatan-penduduk--rasio-jenis-kelamin-penduduk-menurut-kabupaten-kota-di-provinsi-kalimantan-timur.html?year=2025

Not readable (blocked or empty in my tools):
- BPS Kaltim table "Jumlah Pelanggan Listrik menurut Kabupaten/Kota": failed to load.
- BPS Samarinda table on kWh sold, https://samarindakota.bps.go.id/id/statistics-table/2/MzA3IzI=/perkembangan-kwh-terjual-di-pln-wilayah-kalimantan-timur-dan-utara-area-samarinda-menurut-jenis-pelanggan.html : title only.
- Tribunkaltim articles (customers 2024; non-PLN areas): HTTP 403.

Secondary, snippet level only:
- Tribunkaltim (customers 2024), Tribunkaltim (non-PLN 2025), Mongabay (May 2025), Koran Jakarta (Sep 2026), Databoks (population 2025), Antara Kaltim (PLN customer growth Q1 2024).

Not found:
- Per-region kWh sold for the 9 regions other than Samarinda.
- Customer-group split for any region except Samarinda.
- Per-region electrification ratio.
- PLN UID Kaltimra total GWh sold for 2024 or 2025.
- Official BPS 2025 population for Balikpapan, Bontang, Penajam Paser Utara, Kutai Barat, Mahakam Ulu.

## Next steps

1. Open the BPS Kaltim population 2025 table and copy the values into the JSON below. Set `estimated` to false for each one copied.
2. Open the BPS Kaltim PDF "Dalam Angka 2025" in a browser (not through the fetch tool). Look in the Energi / Listrik chapter for customers, kWh sold, and villages without electricity by regency.
3. Check the Samarinda kWh table in a browser. Confirm the total and customer split.
4. Ask PLN UID Kaltimra for the regional sales and customer table (PLN publishes these in its statistics and annual report).
5. Confirm the 72 vs 78 villages count with the Kaltim ESDM office.

## JSON

```json
{
  "year": 2025,
  "regions": [
    {"name": "Paser", "kwhSold": null, "customers": null, "population": 295834, "electrificationRatio": null, "villagesNoPln": null, "source": "Search snippet, year not stated (verify). No primary source opened.", "estimated": true},
    {"name": "Kutai Barat", "kwhSold": null, "customers": 58540, "population": null, "electrificationRatio": null, "villagesNoPln": 21, "source": "Customers: Tribunkaltim citing BPS 2024 (snippet). Villages: Koran Jakarta 15 Sep 2026 citing Gubernur Kaltim (snippet).", "estimated": true},
    {"name": "Kutai Kartanegara", "kwhSold": null, "customers": 245940, "population": 818897, "electrificationRatio": null, "villagesNoPln": null, "source": "Customers: Tribunkaltim citing BPS 2024 (snippet). Population: Databoks citing BPS 2025 semester data.", "estimated": true},
    {"name": "Kutai Timur", "kwhSold": null, "customers": null, "population": 432850, "electrificationRatio": null, "villagesNoPln": null, "source": "Databoks citing BPS 2025.", "estimated": true},
    {"name": "Berau", "kwhSold": null, "customers": null, "population": 246740, "electrificationRatio": null, "villagesNoPln": null, "source": "Databoks citing BPS 2025.", "estimated": true},
    {"name": "Penajam Paser Utara", "kwhSold": null, "customers": null, "population": null, "electrificationRatio": null, "villagesNoPln": null, "source": "Not found.", "estimated": true},
    {"name": "Mahakam Ulu", "kwhSold": null, "customers": null, "population": null, "electrificationRatio": null, "villagesNoPln": 11, "source": "Koran Jakarta 15 Sep 2026 citing Gubernur Kaltim (snippet).", "estimated": true},
    {"name": "Balikpapan", "kwhSold": null, "customers": 278600, "population": 738530, "electrificationRatio": null, "villagesNoPln": null, "source": "Customers: Tribunkaltim citing BPS 2024 (snippet). Population: Dukcapil June 2024 via Databoks, not BPS.", "estimated": true},
    {"name": "Samarinda", "kwhSold": 1380000000, "customers": 340040, "population": 868500, "electrificationRatio": null, "villagesNoPln": null, "source": "kWh: BPS Samarinda table 2025 (snippet, total about 1.38 billion kWh). Customers: Tribunkaltim citing BPS 2024 (snippet). Population: Databoks citing BPS 2024.", "estimated": true},
    {"name": "Bontang", "kwhSold": null, "customers": null, "population": 189970, "electrificationRatio": null, "villagesNoPln": null, "source": "Dukcapil June 2024 via Databoks, not BPS.", "estimated": true}
  ],
  "province": {
    "year": 2025,
    "kwhSold": null,
    "customers": 1360000,
    "customersYear": 2024,
    "population": null,
    "electrificationRatio": 97.77,
    "electrificationNote": "PLN household share, Susenas March 2025, via Tribunkaltim snippet",
    "villagesTotal": 1038,
    "villagesNoPln": 72,
    "villagesNoPlnYear": 2026,
    "villagesNoPlnNote": "Governor statement via snippet; regional split sums to 78, not 72. Verify.",
    "source": "Mixed. See sections above. All estimated.",
    "estimated": true
  }
}
```
