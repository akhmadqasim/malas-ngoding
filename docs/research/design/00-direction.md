# 00 Visual direction: "Atlas malam" (binding)

Date: 21 Oct 2026. Every UI task follows this file. It replaces "Mahakam malam" (Task 6). Sources: reports 01 to 10 in this folder.

**Concept.** A printed thematic atlas, read at night. The map is the page; panels are its margins. Place names are set in a serif, as on printed maps. Everything you read as data is set in a sans with tabular figures. **Colour belongs to data.** The interface itself is ink and paper. **Signature:** the legend is a meter. When you point at a region (on the map or in the list), its needle swings along the scale to that value. Everything else stays quiet.

## 1. Anti-slop rules (do not break)

1. No gradient on chrome: no gradient text, buttons, logo, borders or washes. Allowed: the legend ramp (it *is* data) and one scrim (ink fading to clear) behind the intro text, for legibility.
2. No glass: no `backdrop-filter` anywhere. Panels are solid `panel` with a 1px `rule` border (reports 01, 09; it is also cheaper on the GPU).
3. No glow: no `text-shadow`, no coloured `box-shadow`, no neon. Columns stay muted.
4. No pill badges and no eyebrow labels. "perkiraan" is a quiet word: italic, `paper-faint`, set after the unit (`ton CO2 per tahun, perkiraan`).
5. No all-caps labels, no middle-dot meta strings, no `→` on buttons, no emoji, no icon-in-circle grids.
6. One accent, used for state only (focus, active option, switch on, selected outline, needle). Never as decoration or as a data colour.
7. One radius per level of hierarchy (`md` panels, `sm` controls, `xs` bars), never one radius on everything.
8. Shadows only on things that float over the map. Tinted to the ink hue, never grey `rgba(0,0,0,.1)` boxes.
9. No vanity numbers: every figure has its unit next to it; estimates say "perkiraan"; the panel footer says where the number comes from.
10. Motion answers an action or tells the one intro story. The only loop is the plant pulse, which means "a working power plant".
11. Design the unhappy paths: loading, "Belum ada data", and the "Coba lagi" failure card.
12. Only tokens: no hex, `rgb()`, px font sizes or Tailwind arbitrary values (`[...]`) outside the `@theme` block. `tests/web/tokens.test.ts` enforces it.

## 2. Conflicts between the reports, resolved

- **Accent hue.** 06 proposes cyan `#6CB4C8`, but its own rule says the accent must sit outside the data ramps, and cyan sits inside the kWh ramp. 05 keeps two metric accents (ember/arus), which 01 and 06 reject. Decision: the accent is luminance, not hue: `accent` = bright paper `#F5F2EA`. Hue stays free for data.
- **Ramps.** 03 suggests green-to-red bins (green reads "clean"); 01 and 06 reject the multi-hue fire ramp. 06's cividis was rendered on the 3D columns and its olive middle looked muddy at night. Decision: one hue per metric, lightness rising in six stops (single-hue ramps are colour-blind safe because lightness carries the value). CO2 = amber (combustion, coal), kWh = teal (current). No red, no pink, no multi-hue fire.
- **Basemap.** 06 says pin one preset and 02 suggests monochrome. Monochrome night turned the city at building zoom into a black void, so we keep Standard `theme: "faded"` and the WITA time-follow from the Task 6 brief. Ramps start light enough to reach 3:1 on the faded night ground. On the day ground, column height and the outline carry the value; outline and dimmed columns switch tone (paper on dark presets, ink on day).
- **Emissive.** 06 says keep `fill-extrusion-emissive-strength` at or below 0.5. Rendered, 0.5 made the night columns dark and dull, so we use 0.85 (hover 1). This is safe because the ramps are muted; it shows their true colour, not neon.
- **Fonts.** 04 says IBM Plex Sans + Plex Mono; the frontend-design skill calls mono data labels a tell. We use Plex Sans for UI and figures, and Plex Serif only for place names. No mono.
- **Type scale.** 04 (11..64) and 05 (11..40) differ. We use one scale near 1.25, snapped to a 4 px line grid (below).
- **Motion.** 07 caps UI motion at about 300 ms. The intro (6 s flight, columns rising) is the one orchestrated moment and is exempt. Camera moves after the intro take 2 s.
- **Rain.** The Mapbox example reveals rain at zoom 11 to 13 with large drops; 10 says zoom 15 to 17 and small drops. Rendered at zoom 16.5, 10's `[1.2, 6]` drops at density 0.35 were almost invisible, so we use thin streaks `[1, 10]` at density 0.7, revealed from zoom 15 (Standard buildings are solid) to 16.5.

## 3. Type

- `IBM Plex Sans Variable` (wght 100-700, wdth 75-100): all UI text and every number. Weights: 400 body, 500 values and controls, 600 names and titles. Never 700 or more.
- `IBM Plex Serif` 500: place names only (`Kalimantan Timur`, region names, the intro title). Use at most once per view.
- Readouts (the one big number per view) use Plex Sans at `font-stretch: 85%`, like a meter readout.
- Numbers: always `font-variant-numeric: tabular-nums lining-nums` (class `.num`), right-aligned in lists, `id-ID` format, unit after a normal space.
- Scale (px, size/line): 2xs 11/16, xs 12/16, sm 13/20, base 14/20, lg 17/24, xl 22/28, 2xl 28/32, readout 44/44, display 60/60. Sentence case everywhere.

## 4. Colour (WCAG contrast, measured)

- Text on `panel #141922`: paper `#ECE9E2` 14.5:1, muted `#A7ADB5` 7.8:1, faint `#878F99` 5.4:1 (4.9:1 on `panel-high`).
- On the faded night ground `#2D4656`: CO2 ramp 3.0, 3.8, 4.6, 5.6, 6.8, 8.1:1; kWh ramp 3.1, 3.9, 4.8, 5.8, 7.0, 8.5:1.
- Plant markers: a fuel-coloured core in an ink ring, with a thin paper pulse, so they read on any column. Fuel colours: coal ash grey, gas orange, diesel rust, solar yellow, hydro river blue, biomass leaf green. Always shown with a text label.
- Mapbox paint and canvas colours are read from these CSS tokens at runtime (`src/web/theme.ts`), never typed in TS.

## 5. Tokens (binding copy lives in `src/web/styles.css`)

```css
@theme static {
  --color-*: initial; --font-*: initial; --text-*: initial; --radius-*: initial; --shadow-*: initial; --ease-*: initial;
  --color-ink: #10141b; --color-panel: #141922; --color-panel-high: #1c222c;
  --color-rule: #283040; --color-rule-strong: #384255;
  --color-paper: #ece9e2; --color-paper-muted: #a7adb5; --color-paper-faint: #878f99;
  --color-accent: #f5f2ea; --color-on-accent: #10141b;
  --color-co2-1: #b4863f; --color-co2-2: #c39653; --color-co2-3: #d5a969;
  --color-co2-4: #e7bc7e; --color-co2-5: #f9cf94; --color-co2-6: #fee5c3;
  --color-kwh-1: #4a9ca1; --color-kwh-2: #63aeb2; --color-kwh-3: #7bc0c4;
  --color-kwh-4: #92d2d5; --color-kwh-5: #a9e4e7; --color-kwh-6: #c1f7fa;
  --color-dim-dark: #3e4a5a; --color-dim-light: #c2cad0; --color-outline-light: #1c222c;
  --color-fuel-batubara: #8e959d; --color-fuel-gas: #e58a3e; --color-fuel-diesel: #a86a3d; --color-fuel-surya: #f2d45c;
  --color-fuel-air: #4fa3d9; --color-fuel-biomassa: #79a94f; --color-fuel-lainnya: #7b8794;
  --color-rain: #a8adbc; --color-rain-vignette: #283040;
  --font-sans: "IBM Plex Sans Variable", "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-serif: "IBM Plex Serif", ui-serif, Georgia, serif;
  --font-weight-regular: 400; --font-weight-medium: 500; --font-weight-semibold: 600; --font-stretch-readout: 85%;
  --text-2xs: 0.6875rem; --text-2xs--line-height: 1rem; --text-xs: 0.75rem; --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem; --text-sm--line-height: 1.25rem; --text-base: 0.875rem; --text-base--line-height: 1.25rem;
  --text-lg: 1.0625rem; --text-lg--line-height: 1.5rem; --text-xl: 1.375rem; --text-xl--line-height: 1.75rem;
  --text-2xl: 1.75rem; --text-2xl--line-height: 2rem; --text-readout: 2.75rem; --text-readout--line-height: 1;
  --text-display: 3.75rem; --text-display--line-height: 1;
  --tracking-tight: -0.01em; --tracking-display: -0.02em;
  --spacing: 4px;
  --radius-xs: 2px; --radius-sm: 4px; --radius-md: 6px; --radius-full: 999px;
  --shadow-panel: 0 1px 0 rgb(4 7 12 / 0.3), 0 12px 32px -16px rgb(4 7 12 / 0.55);
  --shadow-float: 0 2px 4px rgb(4 7 12 / 0.4), 0 16px 32px -12px rgb(4 7 12 / 0.65);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1); --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --duration-instant: 120ms; --duration-quick: 200ms; --duration-panel: 240ms; --duration-exit: 180ms; --duration-intro: 6000ms;
  --layout-inset: 24px; --layout-panel: 336px; --layout-reserve-right: 96px; --layout-clear-bottom: 44px;
}
```

## 6. Motion (JS values live in `src/web/motion.ts`)

- Panel enter 240 ms `ease-out`, exit 180 ms `ease-in`; moves at most 16 px. Controls: spring `visualDuration 0.2, bounce 0.15`. Panels: no bounce.
- The needle is the only element with overshoot: spring `visualDuration 0.4, bounce 0.25`, like a meter needle.
- Count-up: 900 ms `ease-out`, only on first reveal or a real data change, never on hover. Stagger 30 ms, total at most 300 ms, first mount only.
- Camera after the intro: `flyTo` 2000 ms, `curve 1.2`; any user gesture stops it. Idle orbit after 20 s, 2.2 deg/s.
- Map motion: columns rise 1.6 s in a west-to-east wave (intro only), hover lift 300 ms, select 900 ms, metric swap sink 380 ms then rise 900 ms. Plant pulse: 3.2 s period, drawn at 24 fps, stopped while the layer is hidden.
- Reduced motion: `MotionConfig reducedMotion="user"`, the camera jumps, counters show the final value, no pulse, no orbit, opacity fades stay.

## 7. Layout and components

- Left sheet (`layout-panel` wide, inset from the top-left): a title block (`Malas Ngoding`, data year), the place name, one readout, then content. It scrolls inside itself if the screen is short.
- Bottom legend strip: metric switch, the meter scale (ramp, ticks with real values, unit, "perkiraan"), and the layer switches with the fuel key and the rain hint. It wraps at 1440 px and below and must never overflow at 1366 px.
- The right side stays free for the building panel (Task 7) and the chat button (Task 8). Mapbox controls sit bottom-right above the chat button.
- Tooltip and popup: `panel`, `rule-strong` border, `radius-sm`, `shadow-float`; name, then value, unit and "perkiraan". Status notes ("Rencana", "Lokasi perkiraan") are plain muted text.
- The one primary button per view (for example "Coba lagi") is filled `accent` with `on-accent` text. Every other button is text or outlined.

## 8. Info panel pattern (Task 7 building panel, also region detail)

- Right side, 360 px (320 px at 1440 px and below), from the top inset down to just above the legend strip; slides in 16 px from the right (240 ms). On narrow screens it becomes a bottom sheet.
- Order: name (Plex Sans 600; place names only in serif), type as an editable select that looks like text with a chevron, floors stepper; then the one readout (kWh per year, perkiraan); then tabs Energi / Emisi / Surya / Cuaca as underlined text tabs; then details as label-value rows with hairlines between groups.
- `bySource` as one horizontal stacked bar in fuel colours with a labelled list below (a donut is allowed only if its labels sit outside it). Equivalents as a list of rows (number, unit, label); no card grid, no emoji.
- Loading: a skeleton with the same rows (flat `panel-high` blocks, no shimmer). Error: one sentence about what failed and a "Coba lagi" button. Outside Kaltim: say "Di luar Kalimantan Timur" in place of the region.
- Building highlight and select colours: `paper-muted` and `accent` on dark presets; `outline-light` on the day preset.

## 9. Rain (`setRainEffect` in `src/web/map/effects.ts`)

```ts
const reveal = (v: number) => ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, v];
map.setRain({ density: reveal(0.7), intensity: 0.8, color: token("--color-rain"), opacity: 0.5,
  vignette: reveal(0.4), "vignette-color": token("--color-rain-vignette"), direction: [0, 80],
  "droplet-size": [1, 10], "distortion-strength": 0.3, "center-thinning": 0.25 });
```

Below zoom 15 the density is 0, so the province and city views never show rain. Off means `setRain(undefined)`. While rain is on and the view is farther out than zoom 15, the legend says "Hujan terlihat saat peta diperbesar sampai tingkat gedung."
