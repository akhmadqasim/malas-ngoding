# Research: solar, weather, and boundary data for Kalimantan Timur

Date checked: 2026-10-20. Status labels: **Verified** = I fetched the source or ran the request. **Unverified** = search snippet or secondary site only. **Not found** = no usable source.

## 1. NASA POWER (daily irradiance, no key)

**Verified live.** Request returned HTTP 200 with no key.

```
https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=117.15&latitude=-0.5&start=20240101&end=20240131&format=JSON
```

- Parameters: `parameters` (ALLSKY_SFC_SW_DWN), `community` (RE), `longitude`, `latitude`, `start` and `end` (YYYYMMDD), `format` (JSON, CSV, ASCII).
- Units in response: `kW-hr/m^2/day`. Label: "All Sky Surface Shortwave Downward Irradiance". So the value is already kWh/m2/day.
- Response reported: source SYN1DEG, time standard LST, elevation 52.04 m, 31 daily values for January 2024. Mean about 5.09, min 2.3484 (2024-01-08), max 6.6619 (2024-01-30). No fill values (-999) and an empty `messages` array.
- Climatology endpoint (`/api/temporal/climatology/point`, same parameters without start and end): **Not tested.** Check the docs before use.
- Docs page: https://power.larc.nasa.gov/docs/services/api/temporal/daily/ (Verified to exist, but it did not list ALLSKY_SFC_SW_DWN, units, or a key policy. Relied on the live response instead.)
- Caveat: the POWER page warns that repeated requests for the same location may get blocked. Cache results.

## 2. Open-Meteo forecast (hourly, Asia/Makassar)

**Verified live.** Response came back with timezone `Asia/Makassar`, `utc_offset_seconds` 28800, `timezone_abbreviation` "GMT+8".

```
https://api.open-meteo.com/v1/forecast?latitude=-0.5&longitude=117.15&hourly=shortwave_radiation,global_tilted_irradiance,cloud_cover,precipitation,weather_code&timezone=Asia/Makassar&forecast_days=7&tilt=0&azimuth=0
```

- Docs: https://open-meteo.com/en/docs. Hourly variables `shortwave_radiation`, `global_tilted_irradiance`, `cloud_cover`, `precipitation`, `weather_code` are all listed there.
- `forecast_days`: integer 0 to 16, default 7.
- `tilt` (0 to 90) and `azimuth`: panel parameters. The docs summary I got says azimuth near 0 means south. **Unverified** for the exact sign convention. Check against the docs before you set it per roof.
- API key: not required for non-commercial use. Commercial use needs a paid key (per docs summary).
- Example response (first 3 hours, 2026-10-20 00:00 to 02:00 WITA): `shortwave_radiation` 0.0, 0.0, 0.0 W/m2. `cloud_cover` 84, 29, 8 %. `weather_code` 3, 1, 0. `precipitation` 0.00 mm. `global_tilted_irradiance` present.
- `hourly_units`: `shortwave_radiation` "W/m²", `global_tilted_irradiance` "W/m²", `cloud_cover` "%", `precipitation` "mm", `weather_code` "wmo code".
- Conversion (derived): daily kWh/m2 = sum of hourly W/m2 / 1000.

## 3. PV, battery, and tariff inputs

**PV yield formula (from your brief, not fetched from NREL or IEC):**
- kWh/day = kWp × PSH × PR. Example (derived): 3 kWp × 4.5 PSH × 0.78 = 10.5 kWh/day.
- PR: the search snippet quoted an IEC 61724-1 style definition (PR = AC energy / (GHI × kWp / 1000)) and said 0.75 to 0.85 is typical. **Unverified** (secondary site).
- PVWatts default total system losses are 14%. **Unverified** (search snippet from GridPIQ). Primary doc: https://developer.nrel.gov/docs/solar/pvwatts/ (not fetched).
- Kaltim PSH or PVOUT: **Not found.** Global Solar Atlas (https://globalsolaratlas.info) is the place to read it for your site. Or use the POWER irradiance above: the mean of the 31 January 2024 POWER values (about 5.1 kWh/m2/day) gives a rough PSH near 5.

**Battery sizing (derived formula):**
- Usable kWh = critical load (kW) × backup hours.
- Nominal kWh = usable kWh / (DoD × inverter efficiency).
- Example (derived): 1.0 kW × 4 h = 4 kWh usable. With DoD 0.8 and inverter efficiency 0.92: 4 / (0.8 × 0.92) ≈ 5.4 kWh nominal.
- LiFePO4 DoD: an EPEVER 12.8 V 100 Ah datasheet lists >6000 cycles at 80% DoD and recommends 80% discharge depth. https://www.epever.com/wp-content/uploads/2026/07/LiA12100_Datasheet.pdf. **Unverified** (search snippet, not fetched). A Victron figure (80% DoD = 2500 cycles) came from a forum quote and is **Unverified**. 90% DoD: **Not found.**

**Indonesian rooftop PV cost per kWp, 2025 to 2026:** **Not found.** Searches only returned older figures. All **Unverified** (news snippets):
- PLN brochure, Hari Listrik Nasional 2023: Rp23.7 juta for 1 kWp, Rp90 juta for 5 kWp (Jakarta area, shipping extra elsewhere). Source: search snippet from an article, not fetched.
- PLN director, 2022: average about Rp15 juta per kWp, down from about Rp24 juta five years earlier. https://ekonomi.bisnis.com/read/20220603/47/1539539/iesr-beberkan-strategi-tekan-biaya-pemasangan-plts-atap-bagi-pengembang
- Advice: get quotes from certified installers that include SLO and the export-import meter.

**PLN residential tariff, R-1 1300 VA and 2200 VA (2025 to 2026):**
- Rp1,444.70 per kWh (rounded Rp1,445 in some outlets). Same for both sizes. Non-subsidized tariff. Unchanged through Q3 2026 per Metro TV (14 to 20 Sep 2026) and Kompas TV. Q4 2026: a 6 Oct 2026 article said no new tariff was announced. Taxes (PPJ, materai) are not in the figure.
- Sources (all **Unverified** secondary, not the ESDM decree):
  - https://www.kompas.tv/info-publik/659868/tarif-listrik-pln-1-10-april-2026-untuk-13-golongan-non-subsidi
  - https://www.metrotvnews.com/read/kM6C4n6l-tarif-listrik-lengkap-periode-14-20-september-2026
  - https://journalarta.com/news/2026/10/06/tarif-listrik-pln-terbaru-oktober-2026/
- Official ESDM or PLN source: **Not fetched.** Check https://www.esdm.go.id before you publish a number.

## 4. Boundaries (ADM2, kabupaten and kota)

**Kaltim count:** 10 units today. 7 kabupaten (Berau, Kutai Barat, Kutai Kartanegara, Kutai Timur, Mahakam Ulu, Paser, Penajam Paser Utara) and 3 kota (Balikpapan, Bontang, Samarinda). Source: Bappeda Kaltim (via search snippet). **Unverified.**
- The 2012 Kalimantan Utara split (UU 20/2012) removed Tarakan, Nunukan, Malinau, Tana Tidung, and Bulungan. Kaltim went from 14 to 9 units. Source: search snippet, **Unverified**.
- Mahakam Ulu was formed from the northern districts of Kutai Barat on 14 Dec 2012, so Kaltim is back to 10. https://en.wikipedia.org/wiki/Mahakam_Ulu_Regency (Verified: fetched; the page gives the date and parent district but not a law number).
- Note: your brief's "7 + 3 after the 2012 split" is correct only if you count Mahakam Ulu.

**geoBoundaries gbOpen IDN ADM2 (recommended, CC BY 3.0 IGO):**
- Metadata API (Verified): https://www.geoboundaries.org/api/current/gbOpen/IDN/ADM2/
  - `boundaryYearRepresented`: "2020"
  - `boundaryLicense`: "Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)"
  - `gjDownloadURL`: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM2/geoBoundaries-IDN-ADM2.geojson
  - `simplifiedGeometryGeoJSON`: https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/IDN/ADM2/geoBoundaries-IDN-ADM2_simplified.geojson
- File size: the GitHub listing shows only Git LFS pointer files (about 134 bytes). The real simplified GeoJSON is over 10 MB (my WebFetch hit the 10,485,760-byte limit). Full GeoJSON size: **Not found**.
- Region name property: geoBoundaries normally uses `shapeName`. **Unverified**, I could not open the file. Check the first feature.
- Current boundaries: the dataset year is 2020, which should include Mahakam Ulu (2012). Whether it has all 10 Kaltim units: **Unverified**. Check for "Mahakam Ulu" in the file.

**GADM 4.1 (not recommended for a commercial app):**
- URL: https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_2.json.zip (Verified: HTTP download returned a zip, about 1.3 MB; the zip holds `gadm41_IDN_2.json`).
- Property names (`NAME_1`, `NAME_2`, `GID_2`): **Unverified** (GADM convention, not opened).
- License (Verified, https://gadm.org/data.html): "The data are freely available for academic use and other non-commercial use. Redistribution, or commercial use is not allowed without prior permission."
- So GADM is a poor fit if this app is commercial. Use geoBoundaries (attribution required).

## Open items

- Verify Kaltim PSH or PVOUT from Global Solar Atlas for your roof sites.
- Find an official 2025 to 2026 PV price for Indonesia. None found.
- Open the geoBoundaries file and confirm the `shapeName` field and the 10 Kaltim units.
- Confirm the NASA POWER climatology endpoint before you rely on it.
