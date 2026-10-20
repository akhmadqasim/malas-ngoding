# Kalimantan Timur (Kaltim) grid emission factor, generation mix, plants, and fuel factors

Research date: 2026-10-20

Legend: **[verified]** = read from a page I fetched. **[snippet]** = seen only in a search result summary, unverified. **[not found]** = no reliable value located. Coordinates from gem.wiki are WGS 84 values as printed on that site.

## Summary

- Grid emission factor for Sistem Mahakam (Kaltim): **[not found]**. The official table is in the lampiran of Kepmen ESDM 163.K/HK.02/MEM.S/2021, and the PDF could not be read by my tools.
- Generation mix: **no 2024 or 2025 electricity mix by fuel found**. The only fuel-type split is by installed capacity, from 2023 Dinas ESDM Kaltim data (PLTU/PLTG/PLTD only).
- Plants: 13 listed. 4 have coordinates from a readable source. The rest are marked approximate or null.
- Fuel factors: IPCC 2006 values in kg CO2/TJ for coal and gas are available from secondary quotes. Converting to kg CO2/kWh needs plant heat rates, which I did not find.

## 1. Grid emission factor (Sistem Mahakam / Kaltim)

- Regulation: Kepmen ESDM Nomor 163.K/HK.02/MEM.S/2021, "Penetapan Faktor Emisi Gas Rumah Kaca Sistem Ketenagalistrikan". Effective 30 August 2021, signed by Menteri ESDM Arifin Tasrif. **[verified]** https://www.ruangenergi.com/pemerintah-terbitkan-aturan-emisi-grk-sistem-ketenagalistrikan/
- The factors are in an attached lampiran. The text of that lampiran was not in the article. **[verified]** (same URL)
- The JDIH abstract PDF is https://jdih.esdm.go.id/common/dokumen-external/Abstrak%20Kepmen%20ESDM%20No.%20163.K_HK.02_MEM.S_2021.pdf. My fetch returned compressed PDF data, so I could not read the table. **[not found]**
- ESDM methodology: the grid factor is a CO2 combined-margin value for the interconnected system, published by ESDM. The lowest of the margin values is applied. **[verified]** https://gatrik.esdm.go.id/assets/uploads/download_index/files/22727-4.-metodologi-pengoperasian-pembangkit-listrik-ror-on-grid-.pdf (fetched via search summary only, so treat as **[snippet]**)
- APPLE-GATRIK lists a "Faktor Emisi GRK Sistem Interkoneksi Tenaga Listrik 2016 (ton CO2e/MWh)" heading with a map. The page text had no values. **[verified heading only]** https://perdagangankarbon-esdm.id/
- Operating margin (OM), build margin (BM), combined margin (CM) for Mahakam: **[not found]**

**gridEmissionFactor = null** (kg CO2/kWh not found)

## 2. Generation mix in Kaltim

No electricity-generation share by fuel for 2024 or 2025 was found.

Capacity by plant type (the only fuel split found):

| Type | Capacity | Units | Source |
|---|---|---|---|
| PLTU (coal) | 835 MW | 17 | Dinas ESDM Kaltim, article dated 5 Sep 2023 **[verified]** https://industri.kontan.co.id/news/masih-kecil-kalimantan-timur-akan-genjot-pemakaian-energi-baru-terbarukan |
| PLTG (gas) | 282 MW | 6 | same |
| PLTD (diesel) | 233 MW | not stated | same |

Calculated share of these three (my arithmetic, 1,350 MW total): PLTU 61.9%, PLTG 20.9%, PLTD 17.3%. This is installed capacity, not generation, and it excludes solar, hydro and biomass.

Other items:
- PLTS, PLTA, PLTB and biomass figures in the same Kontan article are described as potential, not installed. Not used. **[verified as stated in article]**
- Mahakam system 2021: dependable capacity 856 MW, peak load 505 MW. **[snippet]** https://ekonomi.bisnis.com/read/20211002/44/1449536/pln-siap-pasok-50-mva-ke-pt-kobexindo-cement
- Mahakam 2025: 911 MW capacity vs about 501 MW load. **[snippet only, not fetched]** (search result from responsivekalbar.com, 2026)
- Mongabay (21 May 2025), citing ESDM data: Kaltim has 26 PLTU units, the most in Indonesia. **[verified]** https://mongabay.co.id/2025/05/21/ironi-dari-kampung-lumbung-energi-di-kalimantan-timur/
- RUPTL 2025-2034 regional split: Kalimantan 5.8 GW of planned additions. This is for the whole island, not Kaltim. **[snippet]** https://www.hoganlovells.com/en/publications/powering-indonesias-future-key-takeaways-from-the-20252034-ruptl
- Share of renewable energy in the total energy mix of Kaltim in 2024: 12.14% (total energy, not electricity). **[snippet]** https://ger-idn.energyhub.id/wp-content/uploads/2025/10/Day-4-Panel-Discussion-Energi-Terbarukan-untuk-Pertumbuhan-Daerah.pdf

Proxy mix used in the JSON below (capacity basis, 2023):

```
coal 0.619, gas 0.209, diesel 0.173, solar null, hydro null, biomass null
```

## 3. Major power plants in Kaltim

Coordinates marked **approx: false** are from gem.wiki (WGS 84, printed as exact). Coordinates marked **approx: true** are not in my sources.

| # | Name | Type | Fuel | MW | Status / year | Lat | Lng | Approx | Source |
|---|---|---|---|---|---|---|---|---|---|
| 1 | PLTU Kaltim Teluk Balikpapan (Kariangau, Balikpapan Utara) | PLTU | Coal (biomass 5%) | 220 (2 x 110) | Operating, 2017. Unit 3 (300 MW) cancelled | -1.17036 | 116.78872 | false | [verified] https://www.gem.wiki/Kaltim_Teluk_Balikpapan_power_station |
| 2 | PLTU Embalut (Tenggarong Seberang, Kutai Kartanegara) | PLTU | Coal | 60 | Operating, 2014 | null | null | n/a | Capacity [verified] https://gem.wiki/Embalut_power_station . Coordinates [not found] |
| 3 | PLTU Embalut - Tanjung Batu | PLTU | Coal | 50 | not verified | null | null | n/a | [snippet] inzonex list, WRI data: https://inzonex.co.uk/poweratlas/indonesia/region/east-kalimantan/largest/ |
| 4 | PLTGU / PLTG Tanjung Batu (PLN) | Gas plant | Natural gas, diesel | 60 | Operating, 1997 | -0.381356 | 117.051316 | false | [verified] https://www.gem.wiki/Tanjung_Batu_power_station . A 2014 Antara snippet gives 2 x 20 MW, which conflicts |
| 5 | Kaltim power station (Kaltim Peaker 2 / Kaltim Add-on) (PLN, Kutai Kartanegara) | Gas peaker / CCGT (planned) | Natural gas, diesel | 100 operating (2 x 50, 2013); 2 x 50 and 80 planned | Units 1-1 and 1-2 operating; 2-0 to 2-2 pre-construction, planned 2026-2027 | -0.384362 | 117.051473 | false | [verified] https://www.gem.wiki/Kaltim_power_station . The user's "PLTMG Kaltim Peaking" may be this plant; name not confirmed |
| 6 | PLTG Senipah (PT Kartanegara Energi Perkasa, IPP) | Gas combined cycle | Natural gas, diesel | 117 | Operating, 2020 | -0.987643 | 117.135578 | false | [verified] https://www.gem.wiki/Senipah_power_station |
| 7 | PLTG Sambera (Muara Badak, Kutai Kartanegara) | Gas (portable, LNG by truck) | LNG / gas, dual fuel | 40 | Commissioned 2009 | null | null | n/a | [snippet] https://esdm.go.id/id/media-center/arsip-berita/pltg-sambera-atasi-meningkatnya-kebutuhan-listrik-di-kaltim |
| 8 | PLTS IKN (Penajam Paser Utara) | PLTS | Solar | 50 | Phase 1 (10 MW) connected Mar 2024; full 50 MW status not confirmed | null | null | n/a | [snippet] https://ekonomi.bisnis.com/read/20240302/44/1745825/pln-resmi-operasikan-kapasitas-plts-10-mw-di-ikn |
| 9 | PLTU Kaltim-1 (PLN Nusantara Power, Kaltim) | PLTU | Coal | 100 | Operating per company page; COD not stated. May overlap with #1 | null | null | n/a | [verified page, location unclear] https://siujptl.co.id/pembangkit/pltu-kaltim-1 |
| 10 | Balikpapan Refinery power plant | Gas | Gas | 224 | not verified | null | null | n/a | [snippet] inzonex list (WRI data) |
| 11 | AlamTri aluminium smelter power station (captive) | Captive PLTU | Coal | 2200 | not verified | null | null | n/a | [snippet] inzonex list. Captive, not PLN grid |
| 12 | NALCO East Kutai power station (captive) | Captive PLTU | Coal | 1250 | not verified | null | null | n/a | [snippet] inzonex list. Captive, not PLN grid |
| 13 | PLTU Kaltim 4 (planned, 2 x 100) | PLTU | Coal | 200 | Planned in RUPTL 2016-2025; current status not known | null | null | n/a | [snippet] https://ejournal2.undip.ac.id/index.php/jpii/article/download/24597/11943 |

Excluded after checking: Kaltimra (cancelled, 2 x 200 MW) and Adaro East Kalimantan (cancelled, 2 x 300 MW), both from gem.wiki. PLTU Muara Jawa: not found in any source. PLTU Teluk Balikpapan 2017 per Petromindo snippet: 2 x 110 MW.

## 4. Fuel emission factors

IPCC 2006 Guidelines, Vol. 2, Ch. 1 Table 1.4 (CO2, net calorific value basis, kg/TJ):

| Fuel | kg CO2/TJ | Status | Source |
|---|---|---|---|
| Bituminous coal | 94,600 | [snippet] secondary quote | https://greencalculus.com/convert/t-co2-per-tj-to-kg-per-gj/ ; IPCC PDF not readable by my tools: https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/2_Volume2/V2_1_Ch1_Introduction.pdf |
| Natural gas | 56,100 | [snippet] excerpt of Table 1.4 | https://verra.org/documents/vmd0014-estimation-of-emissions-from-fossil-fuel-combustion-e-ffc-v1-0 |
| Gas/diesel oil | 74,100 | [snippet] excerpt of Table 1.4 | same Verra source |
| Subbituminous coal, lignite, solar, hydro | not found | | |

Notes:
- The IPCC corrigenda say some values in Chapter 2 tables 2.2 to 2.5 were revised. Check the corrected tables before citing: https://www.ipcc-nggip.iges.or.jp/public/2006gl/corrigenda4.html [verified page exists, content not checked for these values]
- kg CO2/kWh needs plant heat rate (MJ/kWh). Heat rates were not found, so fuel-to-kWh factors are null.
- Solar and hydro: no operational kg CO2/kWh value found in my sources. Lifecycle values were not searched in this pass.

## JSON

```json
{
  "gridEmissionFactor": null,
  "mix": {
    "basis": "installed capacity, 2023, Dinas ESDM Kaltim (proxy, not generation)",
    "coal": 0.619,
    "gas": 0.209,
    "diesel": 0.173,
    "solar": null,
    "hydro": null,
    "biomass": null
  },
  "plants": [
    {"name": "PLTU Kaltim Teluk Balikpapan", "type": "PLTU", "fuel": "coal", "capacityMw": 220, "lat": -1.17036, "lng": 116.78872, "approx": false},
    {"name": "PLTU Embalut", "type": "PLTU", "fuel": "coal", "capacityMw": 60, "lat": null, "lng": null, "approx": true},
    {"name": "PLTU Embalut - Tanjung Batu", "type": "PLTU", "fuel": "coal", "capacityMw": 50, "lat": null, "lng": null, "approx": true},
    {"name": "PLTGU Tanjung Batu", "type": "PLTGU/PLTG", "fuel": "natural gas", "capacityMw": 60, "lat": -0.381356, "lng": 117.051316, "approx": false},
    {"name": "Kaltim power station (Kaltim Peaker 2)", "type": "PLTMG/PLTG", "fuel": "natural gas", "capacityMw": 100, "lat": -0.384362, "lng": 117.051473, "approx": false},
    {"name": "PLTG Senipah", "type": "PLTGU (CC)", "fuel": "natural gas", "capacityMw": 117, "lat": -0.987643, "lng": 117.135578, "approx": false},
    {"name": "PLTG Sambera", "type": "PLTG", "fuel": "LNG", "capacityMw": 40, "lat": null, "lng": null, "approx": true},
    {"name": "PLTS IKN", "type": "PLTS", "fuel": "solar", "capacityMw": 50, "lat": null, "lng": null, "approx": true},
    {"name": "PLTU Kaltim-1", "type": "PLTU", "fuel": "coal", "capacityMw": 100, "lat": null, "lng": null, "approx": true},
    {"name": "Balikpapan Refinery power plant", "type": "gas", "fuel": "natural gas", "capacityMw": 224, "lat": null, "lng": null, "approx": true},
    {"name": "AlamTri captive coal power station", "type": "captive PLTU", "fuel": "coal", "capacityMw": 2200, "lat": null, "lng": null, "approx": true},
    {"name": "NALCO East Kutai power station", "type": "captive PLTU", "fuel": "coal", "capacityMw": 1250, "lat": null, "lng": null, "approx": true},
    {"name": "PLTU Kaltim 4 (planned)", "type": "PLTU", "fuel": "coal", "capacityMw": 200, "lat": null, "lng": null, "approx": true}
  ],
  "fuelFactors": {
    "unit": "kg CO2/TJ (IPCC 2006, NCV basis); kg CO2/kWh not found",
    "bituminousCoal": 94600,
    "naturalGas": 56100,
    "gasDieselOil": 74100,
    "coal_kgCO2_per_kWh": null,
    "gas_kgCO2_per_kWh": null,
    "diesel_kgCO2_per_kWh": null,
    "solar_kgCO2_per_kWh": null,
    "hydro_kgCO2_per_kWh": null
  }
}
```

## Open items

1. Get the Kepmen ESDM 163/2021 lampiran (the full PDF from jdih.esdm.go.id or peraturan.go.id). This gives the Mahakam OM, BM and CM values.
2. Get PLN RUPTL 2025-2034 Kalimantan appendix or PLN Statistik 2024 for the Mahakam mix by fuel.
3. Confirm the coordinates for Embalut, Sambera, PLTS IKN and PLTU Kaltim-1.
4. Confirm whether "PLTMG Kaltim Peaking" is the same as "Kaltim power station" (gem.wiki).
5. Read IPCC Table 1.4 and corrected Table 2.2 directly (PDF not readable by these tools).
