# Energy data design language: research notes

Date: 2026-10-21. Scope: colour per fuel, CO2 scales, estimate labels, typography and layout across six energy data products.

Verification legend: **[V]** = fetched from the source page or repo and checked. **[S]** = seen only in a search snippet, unverified. **[N]** = not found in any accessible source. Several vendor sites returned HTTP 403 to our fetcher (ember-energy.org, electricitymaps app docs, OWID explorer pages), so their rows are thin.

## 1. Colour per fuel type

| Fuel | Electricity Maps | Ember | IEA | OWID | Carbon Brief | GEM |
|---|---|---|---|---|---|---|
| Coal | [N] | [N] | [N] | [N] (no fuel colours in ColorConstants) | [V] coal plants shown as yellow (operating), red (new/expanded), white (closing), pink (building), purple (planning) | [N] legend not readable |
| Gas / oil / solar / hydro / biomass | [N] | [N] | [N] | [N] | [N] | [N] |

- [V] OWID's core colour file ([ColorConstants.ts](https://raw.githubusercontent.com/owid/owid-grapher/master/packages/%40ourworldindata/grapher/src/color/ColorConstants.ts)) defines only greys plus `GRAPHER_DENIM #4C6A9C`, `OWID_NO_DATA_GRAY #6e7581`, `OWID_ERROR_COLOR #ff0002`, and `GRAPHER_BACKGROUND #fff`. Text is `GRAY_80 #5b5b5b` (dark) and `GRAY_70 #767676` (light). Fuel colours live in another file, which I could not reach. Source: [OWID colour constants](https://raw.githubusercontent.com/owid/owid-grapher/master/packages/%40ourworldindata/grapher/src/color/ColorConstants.ts).
- [V] Carbon Brief's coal map uses a per-status colour, not a per-fuel one. Quoted legend: "operating" plants are yellow, and in the Future view "pink" marks plants "currently being built" and "purple" marks plants "in various stages of planning". Source: [Carbon Brief, Mapped: the world's coal power plants](https://www.carbonbrief.org/mapped-worlds-coal-power-plants).
- [N] Electricity Maps' per-fuel production colours. The electricitymap-contrib constants file returned 404 at the path I tried.
- [N] IEA, Ember, GEM fuel colour palettes. The IEA search returned no chart style guide. Ember's fuel colours were not reachable.

Conclusion: none of the six publishes a documented per-fuel hex palette that I could verify. Do not claim one. Use the recommended palette in section 6 as our own choice.

## 2. CO2 intensity scale

- [V] Electricity Maps' methodology describes carbon intensity in terms of greenhouse gas per kWh only via tiers and labels, not a colour scale. Its methodology page does not state a colour scale or units for carbon intensity. Source: [Electricity Maps methodology](https://electricitymaps.com/methodology).
- [S] Electricity Maps' help article says areas are coloured by carbon intensity, and greener means lower emissions per unit of electricity. Unverified, search snippet only: [Electricity Maps help, colours on the map](https://help.electricitymaps.com/en/articles/10825301-what-do-the-colors-on-the-map-mean).
- [S] Western Power's (Australia) carbon tracker bands, from a search snippet: red 280+, amber 180 to 279, green 0 to 179 gCO2/kWh. Unverified. Source: [Western Power carbon tracker FAQ](https://carbontracer.westernpower.co.uk/faq/what-does-the-green-yellow-red-banding-mean).
- [V] Carbon Brief and OWID: no CO2 intensity colour scale found on the pages I could fetch. [N].
- [N] IEA and Ember CO2 intensity scales.

Takeaway: the common practice is a green-to-red ramp with numeric bands, but the exact breakpoints are not confirmed from primary sources.

## 3. Estimate and uncertainty labelling

- [V] Electricity Maps labels modelled values with two words. "Preliminary" means "our models estimate the values, but they will be replaced with actual values from the source." "Synthetic" means "the sources are not granular enough, or updated often enough, or simply don't exist." Tier B data "will always be estimated to some extent". Tier C data "will always be labelled as such in the App and in the API". Source: [Electricity Maps methodology](https://electricitymaps.com/methodology).
- [S] Electricity Maps API exposes `isEstimated` and `estimationMethod` fields. Source: [Electricity Maps API concepts](https://app.electricitymaps.com/api/docs/concepts-and-parameters) returned 403 to the fetcher, so this line is from the search snippet ([S]).
- [V] Electricity Maps publishes accuracy as a range, not an error bar: "For 90% of zones, updates after 72 hours are less than 2 percentage points different compared to the real time values." Also "median absolute difference for RE% data against both Ember and IEA remained below 3.2 percentage points for 2023". Source: [Electricity Maps methodology](https://electricitymaps.com/methodology).
- [V] IEA data browser: the most recent year is marked as "provisional" in text, e.g. "additional provisional supply data for the year-1". No symbol legend found. Source: [IEA energy statistics data browser](https://www.iea.org/data-and-statistics/data-tools/energy-statistics-data-browser).
- [S] Ember's 2026 Global Electricity Review estimates 2025 from monthly data, and says "Demand is generation plus net imports". Unverified, search snippet only. Source: [Ember GER 2026 supporting materials](https://ember-energy.org/latest-insights/global-electricity-review-2026/supporting-materials/) (403 to our fetcher).
- [V] GEM Coal Plant Tracker (through Carbon Brief's rendering) states assumptions openly: units with no start year are "assumed to have operated 'since 2000 onwards'", and "Mothballed capacity (12GW) is counted as operating". Source: [Carbon Brief coal map](https://www.carbonbrief.org/mapped-worlds-coal-power-plants). The GEM methodology page did not expose these text blocks to the fetcher.
- [N] Confidence intervals or error bars on any of the six products.

## 4. Typography and layout

- [V] OWID grapher text colours: dark text `#5b5b5b`, light text `#767676`, background `#fff`. Source: [OWID colour constants](https://raw.githubusercontent.com/owid/owid-grapher/master/packages/%40ourworldindata/grapher/src/color/ColorConstants.ts).
- [N] Font families, sizes, grid rules for Electricity Maps, Ember, IEA, Carbon Brief, GEM. The pages I could reach did not expose CSS or style guides.
- [N] A dark-theme energy product among the six. All reachable examples use light backgrounds except the Electricity Maps map, whose palette was not captured.
- [V] Accessibility guidance from third-party style guides (not from the six products): World Bank's guide chooses text colours for sufficient background contrast, and UK GDS advises against colour as the only signal. Sources: [World Bank data viz style guide](https://worldbank.github.io/data-visualization-style-guide/), [GDS chart palette](https://brand.design-system.service.gov.uk/colour/charts). These are general references, not evidence about the six products.

## 5. What this means for "AI-ish" feel

The respected products show a restrained pattern: light or neutral base, one accent colour per series, numeric legends with units, and explicit words for estimated data. Neon gradients, glow and decorative dark cards are not used in the sources I could check. The "AI-ish" look more likely comes from glow, gradients and generic type than from palette alone. I did not verify this with a visual review.

## 6. Concrete rules for Malas Ngoding

These are our recommendations. None of the six sources publishes these exact values; the palette is chosen for a dark Mapbox base and colour-blind separation.

Base: background `#0B1120`, panel `#111827`, body text `#E5E7EB`, secondary text `#9CA3AF`, borders `#1F2937`. No gradients, no glow, no neon.

Fuel colours (one hue per fuel, always with a text label, never colour alone):
- Coal: `#8A8F98` (mid grey, solid)
- Gas: `#FBBF24` (amber)
- Oil / diesel: `#C2410C` (burnt orange, darker than gas so the two separate)
- Solar: `#FEF08A` (pale yellow)
- Hydro: `#38BDF8` (sky blue)
- Biomass: `#65A30D` (olive green)
- Wind (if shown): `#2DD4BF` (teal)
- Nuclear (if shown): `#A78BFA` (violet)
- Unknown or modelled: `#475569` with a dashed outline

CO2 intensity scale (gCO2eq/kWh), sequential, low to high, shown as 5 bins with numeric labels:
- `#2DD4BF` 0 to 100
- `#A3E635` 100 to 300
- `#FBBF24` 300 to 500
- `#F97316` 500 to 700
- `#DC2626` 700 and above

Bin edges are our choice. Check them against the actual East Kalimantan distribution before fixing them. Keep the numeric legend visible, because colour alone fails for colour-blind users.

Estimate labels (adopt Electricity Maps' vocabulary, which is verified):
- `Measured`: value from the source, final.
- `Provisional`: latest year or month from the source, will be revised (IEA style).
- `Modelled` (Electricity Maps "Preliminary" or "Synthetic" sense): we or a model produced it. Use `Synthetic` only when no source exists at that granularity.
- Show the status next to every number and in the tooltip. Show the source name and year in the footer.
- Draw modelled values with a dashed fill or outline, not a different colour.

Typography and layout: pick one sans-serif family for labels and one tabular-number style for figures. Use dark text on light panels or light text on dark panels with at least 4.5:1 contrast. Keep the map as the primary surface, with a single legend block and a single source line. This section is a judgement call, since I found no verified typography from the six products.

## Open items

- Obtain the OWID fuel colour file, the electricitymap-contrib production-mode colours, and Ember's and Carbon Brief's CSS or style guide, to replace the recommended palette with sourced values.
- Ember and Electricity Maps API pages returned 403. Retry from a browser before citing.
- Confirm the exact Electricity Maps carbon-intensity colour breakpoints from the live app.

## Sources (checked)

- [Electricity Maps methodology](https://electricitymaps.com/methodology) [V]
- [Electricity Maps help: colours on the map](https://help.electricitymaps.com/en/articles/10825301-what-do-the-colors-on-the-map-mean) [S, 403]
- [Electricity Maps API concepts](https://app.electricitymaps.com/api/docs/concepts-and-parameters) [S, 403]
- [OWID colour constants](https://raw.githubusercontent.com/owid/owid-grapher/master/packages/%40ourworldindata/grapher/src/color/ColorConstants.ts) [V]
- [Carbon Brief, mapped coal plants](https://www.carbonbrief.org/mapped-worlds-coal-power-plants) [V]
- [IEA energy statistics data browser](https://www.iea.org/data-and-statistics/data-tools/energy-statistics-data-browser) [V]
- [Ember GER 2026 supporting materials](https://ember-energy.org/latest-insights/global-electricity-review-2026/supporting-materials/) [S, 403]
- [Western Power carbon tracker FAQ](https://carbontracer.westernpower.co.uk/faq/what-does-the-green-yellow-red-banding-mean) [S]
- [World Bank data viz style guide](https://worldbank.github.io/data-visualization-style-guide/) [S]
- [UK GDS chart palette](https://brand.design-system.service.gov.uk/colour/charts) [S]
