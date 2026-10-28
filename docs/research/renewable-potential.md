# Research: renewable potential layer (solar and wind) for Kalimantan Timur

Date checked: 2026-10-22. Labels: **Verified** = I fetched the primary page or ran the request. **Unverified** = search snippet or secondary source. **Not found** = nothing usable; what I searched is stated. "Derived" = my arithmetic, not a source value.

## 1. BMKG open data

**Public forecast API. Verified** (page fetched, endpoint also run live, HTTP 200 with JSON for a Balikpapan code).
- Docs: https://data.bmkg.go.id/prakiraan-cuaca/
- Request: `GET https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode}` where `adm4` is the kelurahan/desa code (level IV, Kepmendagri 100.1.1-6117 of 2022), for example `adm4=64.71.01.1001` (Manggar, Balikpapan Timur). No key.
- Coverage: 3 days, one forecast every 3 hours (8 per day). Refreshed twice a day. Limit 60 requests per minute per IP.
- Fields seen in the live response: `t` (degC), `hu` (%), `tcc` (cloud %), `tp` (precip), `weather_desc`, `weather_desc_en`, `ws` (wind speed, km/h per docs), `wd` (compass text), `wd_deg`, `wd_to`, `vs`, `vs_text`, `analysis_date`, `utc_datetime`, `local_datetime`. The response also holds `lokasi` with lat/lon of the desa.
- Terms: the docs say BMKG must be credited as the data source and shown in the app ("Wajib untuk mencantumkan BMKG"). Sample code: https://github.com/infoBMKG/data-cuaca (**Unverified**, only linked from the docs).
- No solar radiation field. Wind is a forecast value, not an observation.

**Historical / climate data. Verified** (page fetched): https://dataonline.bmkg.go.id
- Requires registration, email verification and login. Climate parameters include wind and sunshine duration. Max download 30 days per request. The page says finer-than-monthly requests go through https://ptsp.bmkg.go.id. Users must complete a survey every six months. Per-station data, no open API, no stated redistribution licence.
- Monthly regional summaries (pressure, wind speed, sunshine duration) exist on some local open-data portals, for example https://opendata.penajamkab.go.id/id/dataset/?tags=bmkg (**Unverified**, snippet).
- BMKG-station wind maps exist (a data.go.id entry says the national wind map used 10 m station speeds, **Unverified** snippet, https://data.go.id/instantion/badan-meteorologi-klimatologi-dan-geofisika). No open gridded climatology found.

**Verdict:** the public API is a short-term forecast only (3 days). It cannot give long-term wind or solar potential. DataOnline is registration-only, per station, and limited. Use BMKG only for a "cuaca saat ini" note with attribution. Use NASA POWER for potential.

## 2. NASA POWER (WS50M, ALLSKY_SFC_SW_DWN)

**Verified live** (request run 2026-10-22, HTTP 200, no key):
```
https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=WS50M,ALLSKY_SFC_SW_DWN&community=RE&longitude=117.15&latitude=-0.5&format=JSON
https://power.larc.nasa.gov/api/temporal/climatology/regional?parameters=WS50M&community=RE&latitude-min=-2.5&latitude-max=2.5&longitude-min=113.5&longitude-max=119&format=JSON
```
- Response header: "25-year Meteorological and Solar Monthly & Annual Climatologies (January 2001 - December 2025)", API v2.10.1, sources SYN1DEG, MERRA2. Keys `JAN`..`DEC` and `ANN`. Units: `ALLSKY_SFC_SW_DWN` kW-hr/m^2/day ("All Sky Surface Shortwave Downward Irradiance"), `WS50M` m/s ("Wind Speed at 50 Meters"). Fill value -999.
- Regional requests allow one parameter only; point requests up to 20 (docs: https://power.larc.nasa.gov/docs/services/api/temporal/climatology/, **Verified**).
- Native grids: solar from CERES SYN1deg, 1 x 1 deg, March 2000 to near present (https://power.larc.nasa.gov/docs/methodology/energy-fluxes/syn1deg/, **Verified**). Meteorology from MERRA-2 on a 1/2 x 5/8 deg grid, 1981 to near real time (https://power.larc.nasa.gov/docs/methodology/meteorology/, **Verified**). In the Kaltim box above the regional call returned 99 wind cells (0.5 x 0.625 deg) and 36 solar cells (1 deg) (derived count).
- Measured over that box (lat -2.5 to 2.5, lon 113.5 to 119, includes sea and part of Kaltara): `WS50M` ANN min 1.43, mean 2.23, max 4.10 m/s (max at 118.75E, 1.0N, a coastal/offshore cell; derived). `ALLSKY_SFC_SW_DWN` ANN min 4.69, mean 4.91, max 5.38 kWh/m2/day (derived). Point 117.15E, 0.5S: WS50M 1.78 m/s, GHI 4.77.
- Solar accuracy: daily all-sky insolation 2000-2020 about 0.3% bias, 13.5% RMSE against BSRN (search snippet of https://power.larc.nasa.gov/docs/methodology/energy-fluxes/solar-validation/, **Unverified**).
- Wind caveats (**Verified**, https://power.larc.nasa.gov/docs/methodology/meteorology/wind/): POWER says its wind describes "mean wind flow of a region rather than local area"; buildings and topography are not represented. Validation shown is MERRA-2 10 m against station plots with no error numbers, so WS50M accuracy is not quantified. Reanalyses can differ by up to 20% in derived capacity (**Unverified**, snippet, https://doi.org/10.3390/en14040882). A tropical (NE Brazil) mast comparison found MERRA-2 underestimating speeds (**Unverified**, snippet). **Not found:** a quantified MERRA-2 WS50M bias for equatorial Borneo. Treat the layer as coarse screening.
- POWER's own height correction: speed = WS50M x (h/50)^alpha, alpha from a surface-roughness table (same wind page, **Verified**).
- Attribution: the project asks for both a POWER reference and a data reference with service name, version and access date; template "The data was obtained from the POWER Project's Hourly 2.x.x version on YYYY/MM/DD." (**Verified**, https://power.larc.nasa.gov/docs/referencing/). It also asks to be sent links to publications (larc-power-project@mail.nasa.gov). Licence statement: **Not found** on the pages fetched (acknowledgement page https://power.larc.nasa.gov/docs/acknowledgements/ has no required wording).
- Rate caveat: repeated requests can be blocked (see solar-weather-boundaries.md). Fetch the grid once and commit it.

## 3. Global Wind Atlas and Global Solar Atlas

- Global Wind Atlas v3 GIS layers: 250 m resolution, mean wind speed and power density at 50, 100 and 200 m; licence Creative Commons Attribution 4.0. **Verified**: https://datacatalog.worldbank.org/search/dataset/0038643/world-wind-speed-and-power-density-gis-data . Downloadable at global, country and first-admin level (**Unverified**, snippet, https://data.amerigeoss.org/dataset/global-wind-atlas). The Indonesia package is listed at https://energydata.info/dataset/indonesia-wind-speed-and-wind-power-potential-maps (**Not read**: HTTP 403).
- Global Solar Atlas: PVOUT is a long-term yearly average in kWh/kWp; GIS data by country/region from https://globalsolaratlas.info/download (**Unverified**, snippet). Licence (CC BY 4.0?) and attribution wording: **Not found** (site pages did not render for my fetch; the global PVOUT dataset page https://energydata.info/en/dataset/dashboard/world-photovoltaic-power-potential-pvout-gis-data-global-solar-atlas returned 403). Check before use.
- Figures for Kaltim: PVOUT **Not found**. A snippet said East Kalimantan has the smallest value among provinces in one GSA-based study (https://ejournal2.undip.ac.id/index.php/jebt/article/view/26122/0), unit unclear, **Unverified**, do not use.
- Indonesia mean wind speed at 100 m is about 4 m/s, "less than half" of Denmark/UK (8.5 m/s+); virtually never above 10 m/s. **Verified**: https://pmc.ncbi.nlm.nih.gov/articles/PMC9442366/ (Langer et al. 2022). Kaltim-specific GWA numbers: **Not found**.
- Practical use: the app can call POWER live or from a committed grid. GWA/GSA rasters are an optional upgrade (finer, CC BY 4.0 for GWA) but need a GeoTIFF step. They are not required for this feature.

## 4. Wind turbine assumptions

- Utility turbine example, Vestas V150-4.5 MW: rated 4,500 kW, cut-in 3 m/s, cut-out 24.5 m/s, rotor 150 m, IEC class S (low wind). **Verified**: https://www.vestas.com/en/energy-solutions/onshore-wind-turbines/4-mw-platform/v150-4-5-mw . Rated wind speed not listed there.
- Class IIIA 4.5 MW examples (W2E-151/4.5, W2E-155/4.5fc): cut-in 3, rated 13, cut-out 20 to 22 m/s. **Unverified** (snippet): https://thewindpower.net/turbine_en_1654_w2e_w2e-151-4.5.php
- Generic 2.1 MW and 3.4 MW onshore models used in a Indonesia study: cut-in 1.5 to 2, rated 9 to 10.5, cut-out 20 to 25 m/s, hub 100 m. **Verified**: https://pmc.ncbi.nlm.nih.gov/articles/PMC9442366/ (the paper reports mean 100 m speed about 4 m/s).
- Chosen simple model (an assumption, not a published curve): 4.5 MW, cut-in 3, rated 11, cut-out 24.5 m/s, power between cut-in and rated proportional to (v^3 - 3^3)/(11^3 - 3^3), Rayleigh (Weibull k=2) distribution with mean speed U at hub height, times 0.85 for wake, availability and electrical losses (the 0.85 is an assumption). Rated 11 m/s is a compromise between 9 to 13 m/s above (**Unverified**).
- Derived capacity factor (net, my calculation with that model) by hub-height mean speed: 3 m/s 2%, 4 m/s 6%, 5 m/s 13%, 6 m/s 21%, 7 m/s 29%, 8 m/s 37%. Gross is 1/0.85 higher.
- Shear: 50 m to 100 m with alpha = 1/7 (0.143) gives x1.104. 1/7 is the neutral-conditions default; measured exponents vary widely with terrain (**Unverified**, snippet, https://lifescienceglobal.com/84-abstract/jbas/1416-abstract-effect-of-wind-shear-coefficient-for-the-vertical-extrapolation-of-wind-speed-data-and-its-impact-on-the-viability-of-wind-energy-project). POWER itself uses the same (h/50)^alpha form with roughness-based alpha (**Verified**, see section 2). Cite 1/7 as an assumption and show that it is one.
- Viability threshold: the classical NREL/Battelle wind power class table puts class 3 at 400 W/m2 and 7.0 m/s at 50 m, class 2 (marginal) at 300 W/m2 and 6.4 m/s (**Unverified**, reproduced on secondary pages, https://edinformatics.com/math_science/alternative_energy/wind/resources_potential.htm). IESR's technical potential for Indonesia used minimum mean speeds of 7.25 m/s at 50 m and 7.99 m/s at 100 m (**Unverified**, snippet of an IESR-based summary in the Langer paper search). Use "about 6 m/s at hub height, marginal" and "7 m/s and above, viable" as screening labels.
- **Result for Kaltim (derived):** best POWER cell 4.10 m/s at 50 m becomes about 4.5 m/s at 100 m, net capacity factor about 10%. Kaltim mean cell 2.23 m/s becomes about 2.5 m/s at 100 m, capacity factor near 0. No cell comes near 6 m/s. Wind is not viable by this data; the layer should say so, not hide it.

## 5. Ground-mounted solar assumptions

- Land: IKN Nusantara 50 MW plant on about 87 ha (another report: 80 ha), so about 1.6 to 1.75 ha per MW (derived). **Verified**: https://listrikindonesia.com/detail/15447/plts-50-mw-resmi-beroperasi-di-ikn ; https://kaltim.antaranews.com/berita/213570/pln-plts-suplai-100-persen-listrik-saat-upacara-hut-ke-79-ri-di-ikn (**Unverified**, snippet). Whether 50 MW is MWp or MWac is not clear in the sources.
- US benchmarks: NREL (Ong et al. 2013) total land 8.9 acres/MWac, direct 7.3 acres/MWac (about 3.6 and 3.0 ha/MWac, derived). LBNL median 0.35 MWdc/acre fixed tilt, 0.24 tracking (about 1.2 and 1.7 ha/MWdc, derived). **Unverified** (search summaries; the LBNL PDF https://emp.lbl.gov/sites/default/files/emp-files/land_requirements_for_utility-scale_pv.pdf would not parse). App value: 1.75 ha/MWp, range 1.2 to 3.6.
- Performance ratio: PVWatts default system loss 14% (derate 0.86), and a secondary page combines it with about 96% inverter efficiency for about 0.83 overall. **Unverified**: https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.modelchain.ModelChain.with_pvwatts.html ; no primary 80 to 85% utility benchmark found. App value: PR 0.80 (assumption, conservative for tropical heat).
- Yield formula: kWh/year = MWp x 1000 x GHI(kWh/m2/day) x 365 x PR (same form as solar-weather-boundaries.md). Example (derived): 1 MWp, GHI 4.8, PR 0.80 gives about 1,402 MWh. GHI is horizontal, not tilted, so this is slightly conservative. Cross-check: IKN claims 92.8 GWh/yr for 50 MW, i.e. 1,856 kWh/kWp (derived), 32% above this model. The claim is a developer estimate on a possibly different MW basis, so the app should label its own number "perkiraan".
- Cost: "theoretically Rp 10 miliar per MWp", KCE OEM head, 5 Nov 2024, actual cost varies with cable length and site. **Verified**: https://investortrust.id/esg/46557/kce-garap-plts-berkapasitas-16-mwp-senilai-rp-160-miliar-hingga-akhir-2025 (16 MWp for about Rp 160 miliar). Rystad: large ground-mounted PLTS in Indonesia about 0.8 per W in 2024 (article prints "$0.8/MW", a unit typo; read as USD 0.8M per MWp), **Unverified**: https://www.energytrend.com/print/47769 . IESR: global average installed cost USD 600 to 700 per kWp (July 2026, **Unverified** snippet via https://www.kabarbursa.com/ekonomi-hijau/iesr-kontribusi-plts-indonesia-baru-15-gw-ri-mampu-kejar-ketertinggalan). App value: Rp 10 miliar per MWp.

## 6. Kaltim context

- PLTS Nusantara (IKN): 50 MW with 14.2 MWh BESS, about 5 km from KIPP, about 87 ha, 92.8 GWh/yr estimated, operation announced 22 Jan 2025 (Sembcorp Renewables Indonesia and PLN Nusantara Renewables). **Verified**: https://listrikindonesia.com/detail/15447/plts-50-mw-resmi-beroperasi-di-ikn . Phase 1 (10 MW) synced 29 Feb 2024 (**Unverified**, https://kaltim.antaranews.com/berita/213570/pln-plts-suplai-100-persen-listrik-saat-upacara-hut-ke-79-ri-di-ikn). Exact coordinates: **Not found**.
- Kaltim potential per ESDM EBTKE site as quoted by a media article (8 Jan 2024): solar 13.47 GW, wind (bayu) 212 MW, hydro 16.844 GW (the article's own total is flagged by the fetch as odd). **Verified** that the article says this, **Unverified** as official: https://listrikindonesia.com/detail/12336/ini-potensi-energi-terbarukan-kalimantan-timur . The 212 MW wind figure conflicts with the POWER result above; say "potensi teoretis menurut ESDM" if shown.
- RUPTL PLN 2025-2034: 69.5 GW added nationally, about 76% renewables and storage; Kalimantan 5.8 GW of which 3.5 GW EBT. **Unverified** (snippet): https://gatrik.esdm.go.id/assets/uploads/download_index/files/4ec39-materi-paparan-ruptl-2025-2034.pdf . A revision adding a 100 GWp solar acceleration is being drafted (Kontan, 22 Sep 2026, **Unverified**): https://industri.kontan.co.id/news/esdm-revisi-ruptl-2025-2034-target-rampung-sebelum-akhir-2026 . Kaltim-only RUPTL split: **Not found**.
- RUED Kaltim solar/wind targets: **Not found** (searched "RUED Kalimantan Timur target EBT PLTS PLTB"). Kaltim renewable share in total energy mix 2024: 12.14% (**Unverified**, already in grid-and-plants.md).
- Wind in Kaltim: no measured mean speed or PLTB project found. National wind: 154.6 GW potential, 152.3 MW built by 2024 (**Unverified**, snippet, https://www.goodnewsfromindonesia.id/2024/09/27/kementerian-esdm-bidik-percepatan-pengembangan-energi-bayu-di-indonesia-segini-potensinya). ESDM map highlights Kalimantan Selatan, not Kaltim, as a higher-wind area (**Unverified** snippet). IESR-based technical potential listed zero for Kalimantan Barat and 86.7 MW (100 m) for Kalimantan Selatan (**Unverified** snippet). Offshore LCOE study notes cheaper wind only in southern Kalimantan: https://pmc.ncbi.nlm.nih.gov/articles/PMC9442366/ (**Verified**).

## 7. Siting exclusions the app cannot model

A real siting study would intersect candidates with:
- Kawasan hutan (protected, conservation and production forest) and moratorium maps from the Ministry of Forestry (formerly KLHK), served through its SIGAP system. A Bappeda Kaltim report mentions SIGAP data-quality and coordinate-system problems (**Unverified**, https://bappeda.kaltimprov.go.id/beranda/berita/monev-sigap-oleh-kementerian-lhk-ri/detail). Whether the layers are openly downloadable: **Not found** (searched "peta kawasan hutan KLHK SIGAP download").
- Peat (gambut) and peat hydrological units (KHG), BRGM / Kementerian LHK. Open download: **Not found**.
- Also: land cover and concessions (mining, plantation), slope, protected areas, grid distance, airports, settlements, flooding. Kaltim has many coal-mining and plantation concessions; none are modelled.
- App statement (Bahasa Indonesia, suggested): "Peringkat ini hanya berdasarkan data radiasi dan angin NASA POWER. Kawasan hutan, gambut, lahan konsesi, kemiringan, dan jarak ke jaringan belum diperhitungkan."

## Numeric assumptions for the app

```json
{
  "solar": {
    "ghi_source": { "value": "NASA POWER ALLSKY_SFC_SW_DWN ANN climatology 2001-2025", "unit": "kWh/m2/day", "source": "https://power.larc.nasa.gov/api/temporal/climatology/point", "verified": true },
    "performance_ratio": { "value": 0.8, "unit": "ratio", "source": "asumsi; PVWatts 14% loss default https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.modelchain.ModelChain.with_pvwatts.html", "verified": false },
    "land_use": { "value": 1.75, "unit": "ha/MWp", "source": "derived from 87 ha / 50 MW at PLTS Nusantara https://listrikindonesia.com/detail/15447/plts-50-mw-resmi-beroperasi-di-ikn", "verified": false },
    "cost_per_mwp": { "value": 10000000000, "unit": "IDR/MWp", "source": "https://investortrust.id/esg/46557/kce-garap-plts-berkapasitas-16-mwp-senilai-rp-160-miliar-hingga-akhir-2025", "verified": true },
    "reference_mwp": { "value": 1, "unit": "MWp", "source": "app choice", "verified": false }
  },
  "wind": {
    "source_height": { "value": 50, "unit": "m", "source": "NASA POWER WS50M", "verified": true },
    "hub_height": { "value": 100, "unit": "m", "source": "https://pmc.ncbi.nlm.nih.gov/articles/PMC9442366/", "verified": true },
    "shear_exponent": { "value": 0.143, "unit": "none", "source": "asumsi 1/7 neutral default", "verified": false },
    "turbine_rated_power": { "value": 4500, "unit": "kW", "source": "https://www.vestas.com/en/energy-solutions/onshore-wind-turbines/4-mw-platform/v150-4-5-mw", "verified": true },
    "cut_in": { "value": 3, "unit": "m/s", "source": "https://www.vestas.com/en/energy-solutions/onshore-wind-turbines/4-mw-platform/v150-4-5-mw", "verified": true },
    "rated_speed": { "value": 11, "unit": "m/s", "source": "asumsi; other 4.5 MW models list 9-13 m/s https://thewindpower.net/turbine_en_1654_w2e_w2e-151-4.5.php", "verified": false },
    "cut_out": { "value": 24.5, "unit": "m/s", "source": "https://www.vestas.com/en/energy-solutions/onshore-wind-turbines/4-mw-platform/v150-4-5-mw", "verified": true },
    "power_curve_shape": { "value": "cubic between cut-in and rated, Rayleigh (Weibull k=2) wind distribution", "unit": "none", "source": "asumsi", "verified": false },
    "loss_factor": { "value": 0.85, "unit": "ratio", "source": "asumsi (wake, availability, electrical)", "verified": false },
    "net_capacity_factor_by_hub_mean_speed": { "value": { "3": 0.02, "4": 0.06, "5": 0.13, "6": 0.21, "7": 0.29, "8": 0.37 }, "unit": "fraction at mean m/s", "source": "derived from the model above", "verified": false },
    "viable_mean_speed_hub": { "value": 6.0, "unit": "m/s", "source": "asumsi; NREL class 2-3 table 6.4-7.0 m/s at 50 m https://edinformatics.com/math_science/alternative_energy/wind/resources_potential.htm", "verified": false }
  },
  "grid_resolution": {
    "wind_cell": { "value": "0.5 x 0.625", "unit": "deg", "source": "https://power.larc.nasa.gov/docs/methodology/meteorology/", "verified": true },
    "solar_cell": { "value": 1.0, "unit": "deg", "source": "https://power.larc.nasa.gov/docs/methodology/energy-fluxes/syn1deg/", "verified": true }
  },
  "kaltim_power_results": {
    "ws50m_ann_max": { "value": 4.1, "unit": "m/s", "source": "NASA POWER regional climatology run 2026-10-22", "verified": true },
    "ws50m_ann_mean": { "value": 2.23, "unit": "m/s", "source": "NASA POWER regional climatology run 2026-10-22", "verified": true },
    "ghi_ann_mean": { "value": 4.91, "unit": "kWh/m2/day", "source": "NASA POWER regional climatology run 2026-10-22", "verified": true }
  }
}
```
