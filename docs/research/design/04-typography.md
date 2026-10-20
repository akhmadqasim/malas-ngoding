# Typography for data-dense dashboards and map apps

Date: 2026-10-21. Scope: free fonts, pairings, tabular numerals, type scale, label tracking, Bahasa Indonesia text.

Legend: **[verified]** = official page fetched and quoted. **[snippet]** = search result only, treat as unverified. **[not found]** = no source located.

## 1. Why Plus Jakarta Sans everywhere reads as generic

No source says a single sans everywhere is "AI-ish". This is my judgement. The sources below show that data products pick a readable sans for the chart text and add a second voice (serif, mono, or a distinct display face) for identity. One family at every size gives no hierarchy cues, so the product looks like a default template.

## 2. Free fonts used by respected data products and newsrooms

- **Datawrapper** (default for free charts): Roboto. Its blog says: "Roboto, Lato, Open Sans, Source Sans Pro, and Noto Sans are all good options and free to use." It adds: "None of them will make your visualization stand out, but all of them will be readable and pleasant to look at." [verified] https://datawrapper.de/blog/fonts-for-data-visualization (Lisa Charlotte Muth, 12 Sep 2022)
- **The Guardian**: uses one commissioned serif for chart titles and article titles. Datawrapper cites it as "the same commissioned serif font". [verified, same URL]
- **Datawrapper on serif and mono**: serifs are rare in charts. It cites one news project using "a serif typeface for all labels and numbers", and one data project using a monospace. [verified, same URL]
- **IBM Plex** (Sans, Serif, Mono): SIL OFL 1.1. The license header reads "Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"" and "This Font Software is licensed under the SIL Open Font License, Version 1.1." [verified] https://github.com/IBM/plex/blob/master/LICENSE.txt
- **JetBrains Mono**: SIL OFL 1.1. Header: "Copyright 2020 The JetBrains Mono Project Authors". [verified] https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt
- **Plus Jakarta Sans** (current font): Google Fonts page fetched but no license text rendered. Licence not verified here. [not found] https://fonts.google.com/specimen/Plus+Jakarta+Sans
- Newsroom fonts in other outlets (FT Financier, NYT Franklin, Bloomberg Sans): [not found] in this research.

## 3. Pairings

Rules that follow from the sources:
- Datawrapper says sans is "often easier to skim than serif fonts, especially when it comes to numbers". So the chart text stays sans. [verified]
- A serif or mono adds identity. Use it for titles, a single accent, or readouts. Keep it out of dense table body text.
- Option A (recommended for Malas Ngoding): **IBM Plex Sans** for UI and numbers, **IBM Plex Mono** for coordinates, codes, and table IDs. Same superfamily, consistent metrics, both OFL. Add **IBM Plex Serif** only for one editorial heading if needed.
- Option B: **Source Sans 3** (sans) with **JetBrains Mono** (mono). Also free, but I did not verify Source Sans licence here. [not found]

Caution: a Plex-family or mono pairing gives the look. It does not fix weak hierarchy. Hierarchy comes from the scale and colour.

## 4. Tabular numerals for changing numbers

- MDN: "`tabular-nums` activating the set of figures where numbers are all of the same size, allowing them to be easily aligned like in tables. It corresponds to the OpenType values `tnum`." [verified] https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric
- MDN: `proportional-nums` "corresponds to the OpenType values `pnum`". Default numbers are proportional. [verified, same URL]
- MDN compatibility: "Baseline Widely available" and "available across browsers since January 2020". [verified, same URL]
- Tailwind notes that many fonts do not implement these features, so check the font file or the preview. [snippet] https://v2.tailwindcss.com/docs/font-variant-numeric
- Datawrapper: "For your data visualizations, use fonts with lining figures" and "for most of your data visualizations, use tabular figures." [verified, Datawrapper URL above]

Practical effect: animated counters must use `tnum`. Otherwise digits change width each frame and the label jitters.

## 5. Type scale ratios

- Major Third = 1.250 is a standard modular ratio. [snippet] https://madegooddesigns.com/type-scale-calculator/ (search result only; the 1.250 value is listed in several calculators). Treat as common practice, not a standard.
- Fluid scales use CSS `clamp()`. A Sass Modular Scale library builds breakpoint-based fluid scales. [snippet] https://npmjs.com/package/modularscale-sass
- Rounding to 4 or 8 px helps the baseline grid. [snippet, unverified]
- Material 3 type-scale page fetch failed. Its Label Small values are [not found] here. Do not cite Material numbers without checking.

For a dense dashboard, a fixed scale in px is easier to control than fluid sizes. Use a ratio near 1.25 and snap to whole px.

## 6. Letter-spacing for small uppercase labels

- Google Fonts glossary: more open tracking usually helps all-caps readability, and negative tracking is for display sizes. [snippet] https://fonts.google.com/knowledge/glossary/tracking_letter_spacing
- Common web starting point: about 0.05em to 0.08em for uppercase labels and buttons. [snippet] https://codeshack.io/references/css/letter-spacing/ (one example uses 0.08em)
- A Pollen page suggests 512% extra tracking for all caps. Outlier and unreliable. Ignore. [snippet]
- Use em units so spacing scales with the font size.

## 7. Bahasa Indonesia text considerations

- Indonesian is longer than English. AppTweak gives "between 8% and 12% longer to write than English". This is app-store metadata guidance, not a UI study. [snippet] https://www.apptweak.com/en/aso-blog/how-to-localize-your-app-for-indonesia?format=md
- Short labels expand far more in proportion. One guide says strings under 10 characters may need about 300% room. [snippet, dev.to, unverified] Build label containers with slack, not fixed widths.
- Embarcadero recommends UI elements that show text "be built to handle longer strings". [snippet] https://docwiki.embarcadero.com/RADStudio/Rio/en/Text
- Latin-script Indonesian needs no special glyphs beyond basic Latin. Any of the fonts above covers it. [my knowledge, not verified against a specification here]
- Number format: Indonesian locale uses "." for thousands and "," for decimals (for example 1.234,5). Check with `Intl.NumberFormat('id-ID')` in the browser. [my knowledge, MDN not fetched]
- Map labels: Mapbox's glyphs page says the `{fontstack}` token comes from the symbol layer's `text-font`, and custom fonts can be added via Mapbox Studio or the Fonts API. [verified] https://docs.mapbox.com/style-spec/reference/glyphs/
- The same page does not list default fonts. [verified] Font names in `text-font` must match a font the style can load. The iOS 6.3 docs say text will not load otherwise. [snippet] https://docs.mapbox.com/ios/maps/api/6.4.0/customizing-fonts.html (SDK version is old; check current Mapbox docs.)
- Mapbox Standard default fonts: [not found].

## 8. Concrete rules for Malas Ngoding

Pairing and weights:
- UI and big numbers: **IBM Plex Sans**, weights 400 (body), 500 (labels and KPI numbers), 600 (panel titles). Avoid 800 for numbers.
- Coordinates, IDs, units in tables: **IBM Plex Mono**, weight 400 or 500.
- Optional single editorial heading: **IBM Plex Serif**, weight 500. Use once per screen at most.
- Replace Plus Jakarta Sans everywhere, not just on some panels.

Type scale (px, about 1.25 ratio, snapped):
- 11: uppercase labels (letter-spacing 0.08em, weight 500)
- 13: table cells, secondary text
- 15: body and UI controls
- 19: panel titles
- 24: small KPI values
- 32: section KPI values
- 48: hero numbers
- 64: hero animated counter (only for one number per screen)
- Line height: 1.2 for numbers and titles, 1.5 for body.

Numeral settings:
- Global on numeric elements: `font-variant-numeric: tabular-nums lining-nums;` (`lining-nums` keeps digits cap-height; verify the font supports `tnum` in its specimen).
- Counters and tables: right-align, keep `tnum` on the whole element so width stays fixed during animation.
- Never use proportional numerals in a changing value.

Labels:
- 11px uppercase, `letter-spacing: 0.08em` (start point; check by eye at 11px).
- Do not uppercase long Indonesian phrases. Use uppercase only for 1 to 3 word labels.

Indonesian:
- Give every label container about 12% extra width for Bahasa Indonesia strings. Test the longest string at 320px width.
- Format numbers with `Intl.NumberFormat('id-ID')`. Use "ribu", "juta", "miliar" in prose only if the design needs them; compact notation is a separate choice.

Map labels:
- Register the chosen Plex fonts in Mapbox Studio or the Fonts API, then set `text-font` in each symbol layer to the registered names. Test glyph loading on the real style.

Open items:
- Verify Plus Jakarta Sans licence and whether it implements `tnum`.
- Check Material 3 Label Small tracking on the official page.
- Confirm Mapbox Standard's default font stack.
