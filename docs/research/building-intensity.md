# Building electricity intensity research (Kalimantan Timur)

Research date: 2026-10-20. Status key: **[official]** = primary government/standard body text read directly; **[secondary]** = journal, news or blog citing an original source; **[unverified]** = snippet only or my own estimate; **not found** = no usable source located.

## 1. Energy intensity (IKE, kWh/m2/year)

- **ASEAN-USAID benchmarks (1987 study, published 1992).** Office 240, hotel/apartment 300, shopping centre 330, hospital 380 kWh/m2/year. [secondary] Cited in https://publikasi.mercubuana.ac.id/index.php/ijimeam/article/download/14491/pdf and in a Bali hotel audit (https://journal.undiknas.ac.id/index.php/teknik/article/view/3189). The original LBL report (https://eta-publications.lbl.gov/sites/default/files/lbl-32380vol1.pdf) was only seen as a table of contents. Treat as historical.
- **ESDM commercial building benchmarking study, 2021 (SEC study, 7 regions).** [secondary, snippet only, unverified] Average IKE 202.72 kWh/m2/year; top quartile below 125.67; proposed efficient-building thresholds: office 180.95, hotel 208.15, hospital 180.81 kWh/m2/year. Source PDF: https://simebtke.esdm.go.id/sinergi/assets/content/20210527150029_Laporan_Akhir_SEC-130120.pdf. I could not read the full PDF.
- **Indonesian office study, 2025 (33 offices).** [secondary, snippet] Mean 160 kWh/m2/year; below 115 = high performance; above 190 = significant inefficiency (source not retrieved in full).
- **Permen ESDM 13/2012 (Penghematan Pemakaian Tenaga Listrik).** [official file, not readable] The JDIH copy (http://jdih.esdm.go.id/common/dokumen-external/Permen%20ESDM%2013%202012.pdf) is a scanned image. My fetch could not OCR it, and page rendering is not available here. Secondary journals quote monthly AC-building IKE classes: very efficient < 8.5; efficient 8.5-14; fairly efficient 14-18.5; wasteful >= 18.5 kWh/m2/month (about < 102, 102-168, 168-222, >= 222 per year). [secondary, unverified] A third-party legal site (https://pasal.id/peraturan/permen/permen-esdm-no-13-tahun-2012) lists it as no longer in force. Check status before citing.
- **Permen ESDM 14/2012 (manajemen energi).** [secondary] Governs energy management and audits, not IKE tables.
- **SNI 03-6196-2000 / SNI 6196:2011 (Prosedur audit energi pada bangunan gedung).** [secondary] Exists; full text is paywalled or restricted (https://kc.umn.ac.id/id/eprint/12833/). Procedure includes calculating IKE. Thresholds: not found.
- **IFC EDGE Indonesia baseline.** not found. EDGE baseline values are in the EDGE software, not in the sources retrieved.
- **School, campus, house, shophouse (ruko), place of worship, warehouse/light industry.** not found.

## 2. Household consumption per VA class

- **Tariffs, Q2 2026 (news, secondary).** 450 VA subsidi Rp415/kWh; 900 VA subsidi Rp605/kWh; 900 VA non-subsidi Rp1,352/kWh; 1,300 VA and 2,200 VA Rp1,444.70/kWh. Sources: https://www.kompas.tv/ekonomi/660188/update-tarif-listrik-pln-1-april-2026-cek-harga-daya-900-2-200-va-token-dan-pascabayar and https://www.metrotvnews.com/read/NxGCPBDY-tabel-rincian-tarif-tambah-daya-listrik-pln-terbaru-juni-2026. Re-check for the current period.
- **Monthly kWh, study data (secondary, small samples, methods differ).**
  - 450 VA: 113.5 kWh/month; 900 VA: 164.6 kWh/month; 1,200 VA (not 1,300): 229.9 kWh/month. Universitas Gorontalo study, https://repository.unigoro.ac.id/4457/6/bab5.pdf (snippet only, sample size unknown).
  - 1,300 VA: 373.34 kWh/month (one house, 136 m2, observed); 262.8 kWh/month (appliance-based simulation). https://ejournal.uika-bogor.ac.id/index.php/JUTEKS/article/view/21656 (not fully read).
  - 2,200 VA: not found.
- **National context.** [secondary] 1,337 kWh per capita in 2023 (Katadata citing ESDM; headline says 1,377). Includes commercial and industrial use, so not comparable to per-customer figures. https://katadata.co.id/amp/berita/energi/65a90bef72a38/konsumsi-listrik-per-kapita-ri-naik-14-pada-2023-capai-1377-kwh/
- **Per-customer PLN average (official).** not found. Try PLN annual reports or ESDM statistics.

## 3. OSM building tags

[official] Source: https://wiki.openstreetmap.org/wiki/Key:building

- `building=house`: "A dwelling unit inhabited by a single household."
- `building=residential`: general residential; use a specific value when known.
- `building=apartments`: "arranged into individual dwellings, often on separate floors."
- `building=commercial`: "for non-specific commercial activities, not necessarily an office building."
- `building=retail`: "mainly used to sell goods to the public." Shop type goes in `shop=*`.
- `building=office`: "An office building."
- `building=school`, `university`, `hospital`, `hotel`, `church`, `mosque`, `temple`: as named; amenity/tourism tags sit on the grounds.
- `building=industrial`, `warehouse`: industrial purposes; warehouse for storage or distribution.
- Levels: `building:levels` (visible floors), `height` (metres). The wiki does not state how they relate.

Note: OSM has no `building=mall` or `building=shophouse`. Malls are usually `building=retail` with a large footprint or `shop=mall`.

## 4. Floor height

- not found. No Indonesian regulation with floor-to-floor heights surfaced. Permen PUPR 14/2017 covers accessibility widths only (https://web.baubaukota.go.id/public/files/20231120144844.pdf is unrelated to floor heights).
- Working assumption (unverified, my judgment): 3.0 m residential, 3.5 m office/commercial/school, 4.0 m hospital/hotel lobby-heavy buildings. Replace with a source before launch.

## 5. Layman CO2 equivalents

- **Car.** [secondary, unverified] Average new light-duty vehicle 190 g CO2/km (2015, GFEI/IEA profile, via search snippet). Indonesian table (Ramachandra and Shetmala 2009, cited in a city study): 223.6 g/km. Use **0.19 kg/km** (unverified).
- **Motorcycle.** [secondary, unverified] Dyno study of 20 Indonesian motorcycles: 27.03 g/km at 60 km/h to 82.30 g/km at 10 km/h (https://www.atlantis-press.com/article/125918741.pdf, snippet). Bandung study: max 76.81 g/km. Use **0.06 kg/km** as a midpoint (my judgment; the range is 0.03-0.08).
- **Tree.** [contested] The widely quoted 22 kg CO2/year traces to a European Environment Agency article that cites no tree study (https://onetreeplanted.org/blogs/stories/how-much-co2-does-tree-absorb). EPA-derived urban estimate: 0.06 t CO2/year for a 10-year-old urban tree (secondary, University of Richmond guide). Range quoted in secondary sources: 10-40 kg. Use **22 kg/year** only with a caveat.
- **Smartphone charge.** [unverified] About 10-20 g CO2 per full charge. Inputs: about 14.5 Wh per day (DOE-based, secondary: https://www.greenbuildinglawupdate.com/2023/09/articles/ghg/unplugged-truth-greenhouse-gas-emissions-from-charging-your-smartphone/) times 0.68 kg CO2/kWh gives about 10 g. Use **0.01 kg**.
- **Grid emission factor used above.** 0.68 kg CO2/kWh (GreenCalculus, Ember 2025, secondary, unverified). Other values: 0.625 kg/kWh (LowCarbonPower, 2023, secondary); RUPTL 2015-2024 projected 0.798 kg/kWh for 2024 (a forecast, not measured). Official 2023/2024 ESDM value: not found (GATRIK portal, https://gatrik.esdm.go.id, not reached).
- **Jakarta (CGK) to Balikpapan (BPN) flight.** Per-passenger CO2: not found. My estimate from great-circle distance of about 1,260 km (my arithmetic) at roughly 0.13-0.15 kg/passenger-km gives about 165-190 kg one way, economy (unverified). Run the ICAO Carbon Emissions Calculator (https://www.icao.int) with CGK and BPN for a citable figure. Methodology: https://icec.icao.int/Methodology%20ICAO%20Carbon%20Emissions%20Calculator_v13_Final.pdf

## Derived house figure (one sample, low confidence)

1,300 VA observed 373 kWh/month = about 4,480 kWh/year on a 136 m2 house = about 33 kWh/m2/year. The appliance simulation (263 kWh/month) gives about 23 kWh/m2/year. Do not use as a national benchmark.

## JSON

```json
{
  "intensity": {
    "office": 240,
    "mall": 330,
    "hotel": 300,
    "hospital": 380,
    "school_campus": null,
    "house": null,
    "place_of_worship": null,
    "warehouse_light_industry": null,
    "shophouse": null
  },
  "householdKwhMonth": {
    "450": 113.5,
    "900": 164.6,
    "1300": 262.8,
    "2200": null
  },
  "osmMapping": {
    "house": "house",
    "detached": "house",
    "semidetached_house": "house",
    "terrace": "house",
    "residential": "house",
    "apartments": "house",
    "commercial": "shophouse",
    "retail": "shophouse",
    "shop": "shophouse",
    "office": "office",
    "school": "school_campus",
    "university": "school_campus",
    "hospital": "hospital",
    "hotel": "hotel",
    "church": "place_of_worship",
    "mosque": "place_of_worship",
    "temple": "place_of_worship",
    "industrial": "warehouse_light_industry",
    "warehouse": "warehouse_light_industry"
  },
  "floorHeightM": 3.5,
  "equivalents": {
    "carKgPerKm": 0.19,
    "motorcycleKgPerKm": 0.06,
    "treeKgCo2PerYear": 22,
    "smartphoneChargeKgCo2": 0.01,
    "flightCgkBpnKgCo2PerPax": null
  }
}
```

Notes on the JSON: `intensity` values are 1992 ASEAN-USAID figures, the only numeric benchmarks with clear sourcing. The ESDM 2021 thresholds (office 181, hotel 208, hospital 181 kWh/m2/year) are a stricter alternative. `householdKwhMonth` 450, 900 and 1300 are study averages (1300 is the appliance simulation; the observed house was 373). `floorHeightM` is an assumption. `flightCgkBpnKgCo2PerPax` is null because no verified figure was found.
