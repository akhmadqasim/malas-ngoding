# Gaps filled: Kaltim grid, regions, buildings, solar costs

Research date: 2026-10-21. Status labels: **verified** = value read from a primary document I downloaded and read (or an API I called). **estimate** = derived by me, method given. **unverified** = from a news item, vendor page or search snippet only.

## 1. Grid emission factor, Sistem Mahakam (Kalimantan Timur)

- Value: **1.14 kg CO2/kWh** (1.14 t CO2/MWh). **verified**.
- Source: Kepmen ESDM 163.K/HK.02/MEM.S/2021, Lampiran, page 9, row 73 "Mahakam", province Kalimantan Timur. The file is a scanned PDF, so I read the page image. https://jdih.esdm.go.id/dokumen/download?id=Kepmen+ESDM+No.+163.K_HK.02-MEM.S-2021.pdf (the server often cuts the download short, retry until the size is 5,862,338 bytes).
- Full row (97 generators): OM 1.12, BM 1.16. Combined margin ex-post: 1.14 (OM 0.5 / BM 0.5, all activities) and 1.13 (OM 0.75 / BM 0.25, for PLTS and PLTB). Ex-ante: 1.14 and 1.13.
- The note under the table says the values update 2019 data. I found no newer edition (2020 to 2024 data) on any ESDM page I could reach.
- Nearby grids from the same table: Tarakan (Kaltara) CM 0.48; Khatulistiwa (Kalbar) 1.63; Jamali 0.87.
- Other values seen and not used: JCM methodology tables list Mahakam at 0.534 (PM037) and 0.600 for PV (PM020). They are Japanese JCM conservative defaults, not ESDM values.
- Caution: this is a combined margin (marginal emissions), meant for mitigation accounting. It is higher than the average mix. My average-mix estimate (section 3) is 0.87 kg per kWh generated, or about 0.94 per kWh sold after 7.4 percent own use and losses. Use 1.14 as the official figure and say "official factor" in the UI.

## 2. Generation mix (share of kWh)

- No published generation mix by fuel for Kaltim 2024 found (PLN Statistik site did not resolve from this machine; RUPTL and Dinas ESDM pages give capacity or primary energy only). **estimate**.
- Known facts, **verified**: PLN production in the 4 Kaltim branches in 2024 was 5,885.1 GWh, sold 5,452.2 GWh, own use 32.2 GWh, loss 363.4 GWh (BPS, Provinsi Kalimantan Timur Dalam Angka 2025, Tabel 6.1, p. 521).
- Capacity 2024, Satu Data Kaltim (Dinas ESDM), **verified as published, unit labelled "Kva/Kwh" so treat as MW**: PLTU 833 MW (21 units), PLTG 430 MW (23 units), PLTD 203 MW (82 units), PLTS komunal 4 MW. https://data.kaltimprov.go.id/dataset/energi . I added PLTS IKN 50 MWp (commissioned 2024, news).
- Method: energy weight = MW x capacity factor (coal 0.70, gas 0.50, diesel 0.30, solar 0.15). This gives coal 583, gas 215, diesel 61, solar 8 (relative units), so coal 67.3 percent, gas 24.8, diesel 7.0, solar 0.9. I moved 1 point from coal to biomass (5 percent biomass co-firing at PLTU Teluk Balikpapan, a gem.wiki note) and rounded.
- Result: batubara 0.66, gas 0.25, diesel 0.07, surya 0.01, air 0.00, biomassa 0.01, lainnya 0.00. Hydro is 0: no grid-connected hydro in Kaltim was found.
- Cross-check: total 1,520 MW x 8.76 x these factors is above the 5,885 GWh produced, so real capacity factors are lower, mostly for gas and diesel. Real coal share is likely a little higher than shown. Treat the shares as plus or minus 8 points.

## 3. Fuel emission factors (kg CO2 per kWh of electricity)

Method: IPCC 2006 default CO2 factor (kg/GJ) x heat rate (3.6 / efficiency). **estimate**, except where noted.

| Source | EF fuel | Assumed efficiency | kg CO2/kWh |
|---|---|---|---|
| Coal PLTU | 96.1 (sub-bituminous) | 33 percent (small and mid subcritical units) | 1.04 |
| Gas (PLTG, PLTMG, PLTGU mix) | 56.1 | about 38 percent mix (GT 30, engine 40, CCGT 50) | 0.53 |
| Diesel PLTD | 74.1 | 36 percent | 0.75 |
| Solar, operation | none | | 0 |
| Hydro, operation | none | | 0 |
| Biomass, operation | biogenic CO2 counted as 0 (IPCC inventory rule) | | 0 |

- IPCC 56.1 and 74.1 kg/GJ are **verified by the earlier note** (Verra excerpt of Table 1.4). 94.6 for bituminous coal was also listed there. I use 96.1 for sub-bituminous, the type Kaltim uses (unverified, from memory of Table 1.4 and a thesis snippet quoting 0.96 kg/kWh for sub-bituminous).
- Cross-check, **verified by search**: Permen ESDM 16/2022 PTBAE (coal cap) is 1.011 t/MWh for non-mine-mouth PLTU of 100 to 400 MW and 1.297 for units under 100 MW. The 1.04 value fits between them. The release gives 0.911 or 1.089 for large and mine-mouth units, and the two passages disagree.
- Lifecycle values (not used in the JSON), IPCC AR5 Annex III medians, g CO2e/kWh, **unverified** (secondary pages, not the IPCC table): coal 820, gas CC 490, biomass dedicated 230, PV utility 48, PV rooftop 41, hydro 24. NREL 2021 update: coal about 1,001, gas 486, PV utility 43.

## 4. Electricity sold per kabupaten/kota

### What is verified (BPS, Provinsi Kalimantan Timur Dalam Angka 2025, PDF read with pdftotext and page images)

PDF: https://web-api.bps.go.id/download.php?f=MpskQOYGkTtaZ4kQlS+Y73cxLzFVdlZhb0ZkaHVkQStFRloyQ3ltcS9GbXFkRlI3emEvd0FxZHFLT3Q2WFBqT09mNnhGVU9uYmZ4dHJvOXJlN2pXcldKVjc5cnZzNVY1eENiUE1RNjh5Z2NjWTVWTkltQ3l5VEtjTHY2VGl1cWphT3ZmRXU5STBnNzA5akJweFF3dWlBS0FualB4NnloSzl2aHZzNmZIWklYaitScmxhNXZQbWtrVHZENE5RcmlHUHpXZlhtOWRJZ0FGNGhnT1B4dFhYZ0hTd1pVZ2dDeVh1VTZNMHhHSUMwdktiYUdZMzhIVURvS0VHYU9kOVZKTyt5US9ILzZPK0J1andRejFtc0xueGtOenBudmwrcWlERFEzLyt3PT0= (22 MB, 864 pages, chapter 6 at pages 573 to 579).

- Tabel 6.1: kWh sold 2024 **by PLN branch, not by regency**. Samarinda branch 2,555,826,617 kWh (serves Samarinda, Kutai Kartanegara, Kutai Barat, Mahakam Ulu). Balikpapan branch 1,764,008,828 (Balikpapan, PPU, Paser, Kutai Kartanegara). Berau branch 268,088,076 (Berau and Malinau in Kaltara). Bontang branch 864,278,124 (Bontang, Kutai Kartanegara, Kutai Timur). Total 5,452,201,645.
- Tabel 6.2: PLN customers 2024: Paser 99,721; Kutai Barat 58,549; Kutai Kartanegara 245,946; Kutai Timur 114,579; Berau 89,331; PPU 68,008; Mahakam Ulu 7,071; Balikpapan 278,604; Samarinda 340,041; Bontang 63,761. Province 1,365,611 (sum checked).
- Tabel 6.6: electrification ratio 2024 (percent): Paser 92.31; Kutai Barat 94.82; Kutai Kartanegara 89.32; Kutai Timur 89.17; Berau 89.58; PPU 92.83; Mahakam Ulu 87.41; Balikpapan 99.62; Samarinda 100.00; Bontang 94.43. Province 96.17. The same table gives 100 percent electrified villages everywhere, which conflicts with news of 72 to 169 villages without PLN (those count villages without 24-hour grid supply, a different definition).

### Population (verified)

BPS "Proyeksi Penduduk Kabupaten/Kota Provinsi Kalimantan Timur 2020-2035", Tabel 3.1, projection for 2025 (thousand): Paser 289.75; Kutai Barat 180.31; Kutai Kartanegara 845.62; Kutai Timur 470.40; Berau 265.30; PPU 400.03; Mahakam Ulu 34.74; Balikpapan 725.44; Samarinda 865.31; Bontang 190.71; province 4,267.60 (sum checked). https://kaltim.bps.go.id/publication/2023/07/14/b91f5bf8d6eda289dd135816/proyeksi-penduduk-kabupaten-kota-provinsi-kalimantan-timur-2020-2035-hasil-sensus-penduduk-2020.html . This is a model projection that includes the planned IKN move, so PPU (400k) is far above any head count. Databoks quotes other BPS 2025 values (Kukar 818,897; Kutim 432,850; Berau 246,740), which are survey-based and lower.

### Per-regency kWh (estimate)

BPS publishes no per-regency kWh table in this book, so I split the branch totals.

1. Samarinda city fixed at 1,380.657 million kWh. Source: BPS Samarinda table "Perkembangan kWh Terjual ... Area Samarinda", seen as a search snippet (unverified; year assumed 2024; household 753 million kWh, industry 142 million). It agrees with 340,041 customers x 4.06 MWh.
2. Kutai Kartanegara customers are split across the three branches that serve it: 60 percent Samarinda branch, 25 percent Balikpapan branch, 15 percent Bontang branch (assumption, no data).
3. Mahakam Ulu: 7,071 customers x 1,500 kWh (assumption: rural, remote, mostly small homes) = 10.6 million kWh.
4. The rest of the Samarinda branch (after steps 1 and 3) is split between Kutai Kartanegara (its 60 percent) and Kutai Barat by customers.
5. Balikpapan and Bontang branches are split by customers.
6. Berau: assumed 25,000 Malinau customers (not found), so Berau gets 78 percent of the Berau branch.

Result (kWh, 2024): Samarinda 1,380.7 million; Kutai Kartanegara 1,195.5; Balikpapan 967.8; Kutai Timur 460.1; Paser 346.4; Kutai Barat 330.8; Bontang 256.0; PPU 236.2; Berau 209.5; Mahakam Ulu 10.6. Sum 5,393.6 million, which is the branch total minus the Malinau part (58.6 million). Customer-weighted splits ignore industry, so Bontang, Kutai Timur and Kutai Barat (mines, plants) carry the most error, probably plus or minus 30 percent. Kutai Barat at 1,835 kWh per person looks high; real industrial load there is unknown.

PLN UID Kaltimra (Kaltim plus Kaltara) sold 6,214.98 GWh in 2024 (+22.66 percent, household 3,000.24 GWh, +109.79 percent industry growth): https://kalpress.id/2025/01/23/penjualan-listrik-2024-tumbuh-2266-dari-tahun-2023-pln-uid-kaltimra-terus-dorong-pertumbuhan-ekonomi-di-kaltim-dan-kaltara/ (verified by fetch). The BPS branch total (5,452 GWh) is lower because it covers only the 4 Kaltim branches, not North Kalimantan.

Villages without PLN: only the 2026 Koran Jakarta snippet (Kutai Barat 21, Mahakam Ulu 11), unverified. Other regions are null.

## 5. Building energy intensity (kWh/m2/year)

Verified: ESDM Sinergi, "Laporan Akhir SEC" 2021 (7 regions, survey means, downloaded and read): office 180.95, hotel 208.15, hospital 180.81, shopping centre 286.54, all commercial 202.72. https://simebtke.esdm.go.id/sinergi/assets/content/20210527150029_Laporan_Akhir_SEC-130120.pdf . These are measured on gross floor area. The older ASEAN-USAID values (office 240, mall 330, hotel 300, hospital 380) are from 1987 and now too high.

Estimates (no Indonesian study found; method in the JSON `source` fields):

| Type | kWh/m2/year | Basis |
|---|---|---|
| rumah | 35 | 900 to 1300 VA homes, 165 to 373 kWh/month on 60 to 136 m2 |
| ruko | 110 | about half of commercial mean (AC shop below, home above) |
| pemerintahan | 130 | about 70 percent of private office |
| sekolah | 35 | fans and lights, few AC rooms |
| kampus | 85 | measured Undip engineering faculty 84.71; Polines 27 to 78 (journal snippets) |
| ibadah | 30 | lights, fans, sound; AC only in some |
| gudang | 25 | lights and fans |
| industri | 120 | light manufacturing only; heavy industry needs metered data |

Typical floors (assumption): rumah 1, ruko 3, kantor 4, pemerintahan 2, sekolah 2, kampus 3, rumah sakit 4, hotel 6, mal 3, ibadah 1, gudang 1, industri 1. Floor height working assumption stays 3.0 to 4.0 m.

## 6. Solar, battery and tariffs (2026)

- Rooftop PV: **Rp 15,000,000 per kWp** installed, on-grid, residential size. Range Rp 14 to 17 million (sobatbangun.com April 2026, a vendor blog; ica.id gives 3 kWp at Rp 40 to 55 million, 5 kWp at Rp 65 to 85 million; PLN said Rp 15 million in 2022). **unverified**. https://sobatbangun.com/artikel/harga-panel-surya-april-2026-biaya-pasang-rumah/
- LiFePO4 battery: **Rp 2,500,000 per kWh**. Marketplace listings: 16 kWh wall units Rp 31.3 to 38.7 million (Rp 1.95 to 2.7 million per kWh); 5 kWh 48 V 100 Ah units Rp 15.5 to 16.8 million (Rp 3.0 to 3.3 million per kWh); sobatbangun gives 5 kWh at Rp 9 to 13 million (Rp 1.8 to 2.6 million per kWh). **unverified**. https://www.tokopedia.com/find/lifepo4-16kwh
- Tariffs, October 2026, same as Q3 2026 (Q4 not yet changed per ESDM statement 5 Oct 2026), Rp per kWh: R1 900 VA non-subsidy 1,352; R1 1300 VA 1,444.70; R1 2200 VA 1,444.70; B2 (6,600 VA to 200 kVA) 1,444.70; P1 (government, 6,600 VA to 200 kVA) 1,699.53. 450 VA 415 and 900 VA subsidy 605 are older notes. **unverified** (news, not the Kepmen text). https://www.detik.com/bali/bisnis/d-8687548/daftar-lengkap-tarif-listrik-oktober-2026

## 7. Flight Jakarta (CGK) to Balikpapan (BPN)

- **111.13 kg CO2 per passenger, economy, one way**. Distance 1,255 km, fleet A320, A320neo, B737-800, fuel burn 6,098 kg per flight. Business class 231.6 kg. **verified**: I called the ICAO Carbon Emissions Calculator web API on 2026-10-21 (POST https://icec.icao.int/icec/Home/PassengerCompute). Calculator: https://icec.icao.int/ . The earlier estimate of 165 to 190 kg was too high.

## Other equivalents

- Car 0.19 kg/km (unverified; cross-check 2.31 kg CO2 per litre / 12 km per litre). Motorbike 0.05 kg/km (estimate, 45 km per litre). Tree 22 kg/year (contested, range 10 to 40). Phone charge 0.017 kg (15 Wh x 1.14 kg/kWh).

## Final JSON

```json
{
 "grid": {
  "year": 2024,
  "factorKgPerKwh": 1.14,
  "shares": {
   "batubara": 0.66,
   "gas": 0.25,
   "diesel": 0.07,
   "surya": 0.01,
   "air": 0.0,
   "biomassa": 0.01,
   "lainnya": 0.0
  },
  "fuelFactors": {
   "batubara": 1.04,
   "gas": 0.53,
   "diesel": 0.75,
   "surya": 0.0,
   "air": 0.0,
   "biomassa": 0.0,
   "lainnya": 0.0
  },
  "source": "Factor: Kepmen ESDM 163.K/HK.02/MEM.S/2021 Lampiran no. 73 Mahakam (Kalimantan Timur), CM ex-post OM0.5/BM0.5 = 1.14 t CO2/MWh (2019 data, verified; 1.13 for PLTS/PLTB). Shares: estimate for 2024 from capacity (Dinas ESDM Kaltim) x capacity factors. Fuel factors: IPCC 2006 EF x assumed efficiency (estimate)."
 },
 "regions": [
  {
   "id": "paser",
   "name": "Paser",
   "kind": "kabupaten",
   "kwhYear": 346400000,
   "population": 289750,
   "customers": 99721,
   "electrificationPct": 92.31,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "kutai-barat",
   "name": "Kutai Barat",
   "kind": "kabupaten",
   "kwhYear": 330800000,
   "population": 180310,
   "customers": 58549,
   "electrificationPct": 94.82,
   "villagesNoPln": 21,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "kutai-kartanegara",
   "name": "Kutai Kartanegara",
   "kind": "kabupaten",
   "kwhYear": 1195500000,
   "population": 845620,
   "customers": 245946,
   "electrificationPct": 89.32,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "kutai-timur",
   "name": "Kutai Timur",
   "kind": "kabupaten",
   "kwhYear": 460100000,
   "population": 470400,
   "customers": 114579,
   "electrificationPct": 89.17,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "berau",
   "name": "Berau",
   "kind": "kabupaten",
   "kwhYear": 209500000,
   "population": 265300,
   "customers": 89331,
   "electrificationPct": 89.58,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "penajam-paser-utara",
   "name": "Penajam Paser Utara",
   "kind": "kabupaten",
   "kwhYear": 236200000,
   "population": 400030,
   "customers": 68008,
   "electrificationPct": 92.83,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "mahakam-ulu",
   "name": "Mahakam Ulu",
   "kind": "kabupaten",
   "kwhYear": 10600000,
   "population": 34740,
   "customers": 7071,
   "electrificationPct": 87.41,
   "villagesNoPln": 11,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "balikpapan",
   "name": "Balikpapan",
   "kind": "kota",
   "kwhYear": 967800000,
   "population": 725440,
   "customers": 278604,
   "electrificationPct": 99.62,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "samarinda",
   "name": "Samarinda",
   "kind": "kota",
   "kwhYear": 1380700000,
   "population": 865310,
   "customers": 340041,
   "electrificationPct": 100.0,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: BPS Samarinda table 1,380,657 thousand kWh (search snippet, year not confirmed, assumed 2024); customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  },
  {
   "id": "bontang",
   "name": "Bontang",
   "kind": "kota",
   "kwhYear": 256000000,
   "population": 190710,
   "customers": 63761,
   "electrificationPct": 94.43,
   "villagesNoPln": null,
   "estimated": true,
   "source": "kWh: estimate, PLN branch kWh sold 2024 (BPS Tabel 6.1) split by customers, see gaps-filled.md section 4; customers/electrification: BPS Kaltim Dalam Angka 2025 Tabel 6.2 and 6.6 (verified); population: BPS projection 2025 Tabel 3.1 (verified, projection);"
  }
 ],
 "buildingTypes": {
  "rumah": {
   "intensityKwhM2Year": 35,
   "typicalFloors": 1,
   "source": "Estimate: 900-1300 VA households 165-373 kWh/month on 60-136 m2 gives about 33 kWh/m2/year (estimated)"
  },
  "ruko": {
   "intensityKwhM2Year": 110,
   "typicalFloors": 3,
   "source": "Estimate: shop on ground floor with AC, living space above; about half of the commercial survey mean (estimated)"
  },
  "kantor": {
   "intensityKwhM2Year": 181,
   "typicalFloors": 4,
   "source": "ESDM SEC survey 2021, 7 regions, office mean 180.95 kWh/m2/year (verified)"
  },
  "pemerintahan": {
   "intensityKwhM2Year": 130,
   "typicalFloors": 2,
   "source": "Estimate: about 70 percent of private office mean, fewer AC hours; 2025 study of 33 offices gave mean 160 (snippet)"
  },
  "sekolah": {
   "intensityKwhM2Year": 35,
   "typicalFloors": 2,
   "source": "Estimate: mostly fan and lighting, few AC rooms, about 200 days per year (estimated)"
  },
  "kampus": {
   "intensityKwhM2Year": 85,
   "typicalFloors": 3,
   "source": "Measured Undip Engineering faculty 84.71 kWh/m2/year; Polines buildings 27-78 (journal snippets); estimate"
  },
  "rumah_sakit": {
   "intensityKwhM2Year": 181,
   "typicalFloors": 4,
   "source": "ESDM SEC survey 2021, hospital mean 180.81 kWh/m2/year (verified). Old ASEAN-USAID value was 380"
  },
  "hotel": {
   "intensityKwhM2Year": 208,
   "typicalFloors": 6,
   "source": "ESDM SEC survey 2021, hotel mean 208.15 kWh/m2/year (verified)"
  },
  "mal": {
   "intensityKwhM2Year": 287,
   "typicalFloors": 3,
   "source": "ESDM SEC survey 2021, shopping centre mean 286.54 kWh/m2/year (verified)"
  },
  "ibadah": {
   "intensityKwhM2Year": 30,
   "typicalFloors": 1,
   "source": "Estimate: lighting, fans, sound system, AC only in some mosques; no study found (estimated)"
  },
  "gudang": {
   "intensityKwhM2Year": 25,
   "typicalFloors": 1,
   "source": "Estimate: lighting and fans, low load (estimated)"
  },
  "industri": {
   "intensityKwhM2Year": 120,
   "typicalFloors": 1,
   "source": "Estimate: light manufacturing; heavy industry is far higher and needs a metered value (estimated)"
  }
 },
 "solarCosts": {
  "costRpPerKwp": 15000000,
  "batteryRpPerKwh": 2500000,
  "tariffs": {
   "R1_1300": 1444.7,
   "R1_2200": 1444.7,
   "B2": 1444.7,
   "P1": 1699.53
  },
  "source": "PV: Rp14-17 million/kWp on-grid (sobatbangun.com Apr 2026, vendor blogs; PLN 2022 figure Rp15 million). Battery: marketplace LiFePO4 listings 2026, Rp1.8-3.3 million/kWh. Tariffs: detik.com Oct 2026, same as Q3 2026 (news, not the Kepmen)."
 },
 "equivalents": [
  {
   "key": "mobil_km",
   "label": "km naik mobil",
   "kgCo2PerUnit": 0.19,
   "unit": "km",
   "source": "Average new car 190 g/km (GFEI/IEA via snippet; also 2.31 kg CO2/L / 12 km/L); unverified"
  },
  {
   "key": "motor_km",
   "label": "km naik motor",
   "kgCo2PerUnit": 0.05,
   "unit": "km",
   "source": "Estimate: 2.31 kg CO2/L / 45 km/L; Indonesian dyno studies 0.027-0.082 kg/km"
  },
  {
   "key": "pohon",
   "label": "pohon menyerap setahun",
   "kgCo2PerUnit": 22,
   "unit": "pohon",
   "source": "22 kg CO2/tree/year, widely quoted EEA figure, contested range 10-40"
  },
  {
   "key": "charge_hp",
   "label": "kali charge HP",
   "kgCo2PerUnit": 0.017,
   "unit": "kali",
   "source": "Estimate: 15 Wh per full charge x 1.14 kg/kWh (Kaltim grid factor)"
  },
  {
   "key": "penerbangan",
   "label": "penerbangan Jakarta–Balikpapan",
   "kgCo2PerUnit": 111.1,
   "unit": "penerbangan",
   "source": "ICAO ICEC API, CGK-BPN economy one way, 1,255 km, 111.13 kg CO2 per passenger (verified, queried 2026-10-21)"
  }
 ]
}
```
