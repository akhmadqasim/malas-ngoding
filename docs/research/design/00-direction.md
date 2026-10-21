# 00 Visual direction: "Atlas malam" (binding)

Date: 21 Oct 2026. Every UI task follows this file. It replaces "Mahakam malam" (Task 6). Sources: reports 01 to 10 in this folder.

**Concept.** A printed thematic atlas, read at night. The map is the page; panels are its margins. On a light map (day, dawn) the margins are printed paper with ink type; on a dark map (dusk, night) they are ink with paper type (section 10). Everything in the panels is set in HeroUI's system sans (section 3), place names largest; figures use tabular numerals; names on the map itself use the basemap's DIN Pro (section 7). **Colour belongs to data.** The interface itself is ink and paper. **Signature:** the legend is a meter. When you point at a region (on the map or in the list), its needle swings along the scale to that value, the column rises and the other columns recede. Everything else stays quiet.

## 1. Anti-slop rules (do not break)

1. No gradient on chrome: no gradient text, buttons, logo, borders or washes. Allowed: the legend ramp (it *is* data) and one scrim behind the intro text, for legibility: ink fading to clear, or by day (light ground) a paper haze under ink type, because ink over the white globe turned into a muddy grey band.
2. No glass: no `backdrop-filter` anywhere. Panels are solid `panel` with a 1px `rule` border (reports 01, 09; it is also cheaper on the GPU).
3. No glow: no `text-shadow`, no coloured `box-shadow`, no neon. Columns stay muted.
4. No pill badges and no eyebrow labels. "perkiraan" is a quiet word: italic, `paper-faint`, set after the unit (`ton CO₂ per tahun, perkiraan`).
5. No all-caps labels, no middle-dot meta strings, no `→` on buttons, no emoji, no icon-in-circle grids.
6. One accent, used for state only (focus, active option, switch on, needle). Never as decoration or as a data colour.
7. One radius per level of hierarchy (`md` panels, `sm` controls, `xs` bars), never one radius on everything.
8. Shadows only on things that float over the map. Tinted to the ink hue, never grey `rgba(0,0,0,.1)` boxes.
9. No vanity numbers: every figure has its unit next to it; estimates say "perkiraan"; the panel footer says where the number comes from.
10. Motion answers an action or tells the one intro story. Nothing loops for decoration (the plant pulse went in round 5: its rings read as targets). The idle sway is the one slow movement, and only when nobody touches the page.
11. Design the unhappy paths: loading, "Belum ada data", and the "Coba lagi" failure card.
12. Only tokens: no hex, `rgb()`, px font sizes or Tailwind arbitrary values (`[...]`) outside the `@theme` block. `tests/web/tokens.test.ts` enforces it.

## 2. Conflicts between the reports, resolved

- **Accent hue.** 06 proposes cyan `#6CB4C8`, but its own rule says the accent must sit outside the data ramps, and cyan sits inside the kWh ramp. 05 keeps two metric accents (ember/arus), which 01 and 06 reject. Decision: the accent is luminance, not hue: `accent` = bright paper `#F5F2EA`. Hue stays free for data.
- **Ramps.** 03 suggests green-to-red bins (green reads "clean"); 01 and 06 reject the multi-hue fire ramp. 06's cividis was rendered on the 3D columns and its olive middle looked muddy at night. Decision: one hue per metric in six stops (single-hue ramps are colour-blind safe because lightness carries the value). CO₂ = amber (combustion, coal), kWh = teal (current). Two ramps per metric, chosen by the ground tone: on a dark ground lightness rises with the value; on a light ground (the `-day` ramps) it falls, so the highest value always has the most contrast.
- **Basemap.** 06 says pin one preset and 02 suggests monochrome. The light follows WITA time (Task 6 brief) unless the presenter pins it with the Cahaya switch or `?cahaya=`. Round 5: Standard's own look, lightly muted, in every light: theme `faded` (monochrome turned land, rivers and roads the same grey), and only Standard's `day` and `night` light: its `dawn` and `dusk` presets washed the whole map in a muddy tan, so dawn uses the day light and dusk the night light (`basemapLight` in `effects.ts`); the page still names the time ("Cahaya fajar", "Cahaya senja"). Ground tone, measured: day and dawn light, dusk and night dark. Outlines and dimmed columns switch with it (paper on dark, ink on light).
- **Emissive.** 06 says keep `fill-extrusion-emissive-strength` at or below 0.5. Rendered, 0.5 made the night columns dark and dull. We use 0.85 on a light ground and 1 on a dark one (measured: the scene light shades the columns about a fifth darker at night), one value for every column. It shows the ramp's true colour, not neon, because the ramps are muted. Round 5: the walls are calm planes (no ambient occlusion, no vertical gradient, which broke low walls into dark fragments; the region source is simplified a little more, `tolerance: 2.5`, so the coast does not stripe the walls), and the columns stay fully opaque up to zoom 11, so a selected region is a solid shape, fading out only toward city zoom. Fix round 1: every column has a crisp top outline, a wall-mode fill-extrusion (`fill-extrusion-line-width` about 1.5 px at every zoom) on the same source, running from just under the column top to just over it on the same feature-state height, so it follows the rise, the hover lift and a selection. Mapbox does not draw wall mode on the globe, so the outline starts at zoom 6, where tiles are built flat. It is ink on every column and a quiet grey on a dimmed one. The column shapes are a calmer copy (`regionShapes.ts`: delta islands under 2% of a region's main land dropped, rings simplified to about 450 m), so the delta no longer draws a comb of wall slivers.
- **Fonts.** 04 says IBM Plex Sans + Plex Mono. Round 5, user decision: the chrome follows HeroUI's own system font stack (section 3); Plex is gone. Names drawn on the map (the region labels) use DIN Pro Medium, the Standard basemap's own face. No mono.
- **Type scale.** 04 (11..64) and 05 (11..40) differ. We use one scale near 1.25, snapped to a 4 px line grid (below).
- **Motion.** 07 caps UI motion at about 300 ms. The intro (6 s flight, columns rising) is the one orchestrated moment and is exempt. Camera moves after the intro take 2 s.
- **Rain.** The Mapbox example reveals rain at zoom 11 to 13 with large drops; 10 says zoom 15 to 17 and small drops. Rendered at zoom 16.5, 10's `[1.2, 6]` drops at density 0.35 were almost invisible, so we use thin streaks `[1.3, 14]` at density 1, revealed from zoom 15 (Standard buildings are solid) to 16.5. They are bright in every light and have no refraction: `distortion-strength` turned them into faint glassy smears at night (A/B rendered in fix round 4). Pale drops vanish on a light ground, and dark drops read as needles (fix round 3), so by day the light streaks fall through a slate haze drawn inside the map (section 9), as real rain shows against an overcast sky. Its fog range is long (`[-2, 9]`), so it dims the city instead of swallowing it: the round 3 range `[-1, 2.5]` turned the building view flat grey and hid the far half of the city.

## 3. Type

- HeroUI's own system stack for everything in the chrome (user decision, round 5): `--font-sans` from Tailwind/HeroUI (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`), so SF on macOS and Segoe UI on Windows; `--font-mono` where mono is needed (nowhere yet). No web fonts are loaded. Map labels stay DIN Pro Medium, the basemap's face (section 7).
- Weights: 400 for body text and controls (a chosen option is shown by its fill, not by weight), 600 for place names, titles, list names and values (`--font-weight-medium` and `--font-weight-semibold` are both 600: Segoe UI has no 500, which would fall back to 400 and flatten the hierarchy). Never 700 or more.
- Place names (`Kalimantan Timur`, the region in the sheet, the intro title) are the largest type of their view, 600, tracking `-0.02em`. Readouts (the one big number per view) are 44 px, 600, tracking `-0.02em`, tabular figures.
- Numbers: always `font-variant-numeric: tabular-nums lining-nums` (class `.num`), right-aligned in lists, `id-ID` format, unit after a normal space.
- CO₂ is set as `CO<span class="sub">2</span>` (`chem()` in `src/web/components/Chem.tsx`): a 0.72 em figure set 0.22 em below the baseline with no line height, so it never stretches the line (system fonts share no small-figure feature).
- Scale (px, size/line): 2xs 11/16, xs 12/16, sm 13/20, base 14/20, lg 17/24, xl 22/28, 2xl 28/32, readout 44/44, display 60/60. Sentence case everywhere.

## 4. Colour (WCAG contrast, measured)

- Text on `panel #141922` (night chrome): paper `#ECE9E2` 14.5:1, muted `#A7ADB5` 7.8:1, faint `#878F99` 5.4:1 (4.9:1 on `panel-high`).
- Text on `sheet #F7F6F2` (day chrome): ink `#10141B` 17.1:1, `ink-muted #4B525C` 7.3:1, `ink-faint #626973` 5.1:1 (4.6:1 on `sheet-high`).
- Columns against the ground, measured from rendered pixels by `bun run contrast` (median column pixel against the median ground pixel under the same points of the drawn column shapes; the region names, outlines, top rims and plants are hidden while measuring). Grounds (theme `faded`, day or night light): day and dawn land `#d9f4d6`, dusk and night `#2d4656`. The lowest is 3.2:1.

| Preset | CO₂ / kWh | Stop 1 | Stop 2 | Stop 3 | Stop 4 | Stop 5 | Stop 6 |
|---|---|---|---|---|---|---|---|
| day, dawn | ramp `-day` | 3.6 / 3.4 | 4.4 / 4.1 | 5.1 / 4.9 | 6.1 / 5.6 | 7.2 / 6.6 | 8.4 / 7.8 |
| dusk, night | ramp | 3.2 / 3.3 | 3.9 / 4.0 | 4.7 / 4.9 | 5.6 / 5.8 | 6.7 / 6.9 | 7.8 / 8.2 |

- Plant markers are pins (round 6, 21 Oct): one style for every plant, a round head in the fuel colour on a short point, inside a thin paper edge and a thin ink edge (no rings, no pulse, no fainter variant: the tooltip names the status). The point marks the plant (`icon-anchor: bottom`). The edges carry the contrast: the ink edge on a light map, the paper edge on a dark map and on the columns. Fuel colours: coal charcoal (slate `#6B727C`, light enough not to read as a hole), gas orange, diesel rust, solar yellow, hydro river blue, biomass leaf green, other lilac. Size is the square root of MW. **A pin stands on the top of the column it is in**, so no wall or rim of the raised land runs through it (flat dots on the ground did, at every tilt). `symbol-z-offset` takes no feature-state, so there is one pin layer per column with plants (`plants-<region>`, plus `plants-ground` for plants at sea), each lifted by a camera expression: the column's height flattened by zoom exactly like the column (`columnZoomScale`, or the selected column's sooner curve). regionsLayer reports the column tops every frame they move (`onColumnTops`: the rise, the hover lift, a selection, a metric swap, the Wilayah switch), and the pins move with them; a changed camera expression needs no new layout, and the lift has no transition, so it never lags. The layers go back to front (ground, then the columns north to south) and have no sort key, so a nearer pin is drawn over a farther one. Pins are never ghosted behind a column in front (`icon-occlusion-opacity: 1`). Plants closer than 18 px on screen form a group (`plantGroups.ts`): the same pin in the fuel of its largest plant, sized by the summed MW, with the count in its head (paper on an ink halo). The groups are a tree worked out once, with the exact zoom where each group parts; every marker cross-fades over 0.6 zoom levels around the zoom it appears at and the zoom it parts at, so a group turns into its pins in place, with no jump and no badge beside a pin, and at a fixed zoom (the idle sway) nothing changes. A group's tooltip lists its plants; a click zooms in until they part. The tooltip opens at the pin's height (`Popup.setAltitude`), beside the pin, never over its head. The opacity is written into feature-state on every zoom (a zoom-and-feature paint expression is only evaluated at whole zooms and blended, which ghosted the groups at rest), the size depends on capacity only, and the markers are drawn only from zoom 6 and only once the overview has landed: symbol layers drawn while the camera eases off the globe (a skipped intro, a fast zoom-out) made Chromium log GL_INVALID_OPERATION warnings. One hover handler picks the topmost marker that is shown, across every pin layer. The legend key is the same pin, drawn in CSS. Always shown with a text label. The smoke checks that the point of every pin on screen is on its column's top (within 4 px) at the province view, at pitch 60 at both ends of the sway and during a hover lift.
- Mapbox paint and canvas colours are read from these CSS tokens at runtime (`src/web/theme.ts`), never typed in TS.

## 5. Tokens (binding copy lives in `src/web/styles.css`)

```css
@theme static {
  --color-ink: #10141b; --color-panel: #141922; --color-panel-high: #1c222c; --color-rule: #283040;
  --color-rule-strong: #384255; --color-scrim: rgb(16 20 27 / 0.86);
  --color-scrim-day: rgb(248 248 248 / 0.94); --color-scrim-day-mid: rgb(248 248 248 / 0.78);
  --color-paper: #ece9e2; --color-paper-muted: #a7adb5; --color-paper-faint: #878f99;
  --color-paper-bright: #f5f2ea;
  --color-sheet: #f7f6f2; --color-sheet-high: #ecebe5; --color-sheet-rule: #dad7cf;
  --color-sheet-rule-strong: #bcb8ad; --color-ink-muted: #4b525c; --color-ink-faint: #626973;
  --color-co2-1: #bc8d46; --color-co2-2: #cb9e5a; --color-co2-3: #dbaf6e; --color-co2-4: #ebc082;
  --color-co2-5: #fbd196; --color-co2-6: #fee5c3;
  --color-kwh-1: #52a4a8; --color-kwh-2: #69b4b8; --color-kwh-3: #7fc4c8; --color-kwh-4: #95d5d8;
  --color-kwh-5: #abe6e9; --color-kwh-6: #c1f7fa;
  --color-co2-day-1: #a56f1c; --color-co2-day-2: #9e6111; --color-co2-day-3: #965307;
  --color-co2-day-4: #8d4602; --color-co2-day-5: #843800; --color-co2-day-6: #7a2a01;
  --color-kwh-day-1: #2e8b90; --color-kwh-day-2: #1f7f88; --color-kwh-day-3: #0e7380;
  --color-kwh-day-4: #006878; --color-kwh-day-5: #045c6e; --color-kwh-day-6: #025064;
  --color-dim-dark: #3e4a5a; --color-dim-light: #c2cad0; --color-outline-light: #1c222c;
  --color-fuel-batubara: #6b727c; --color-fuel-gas: #e58a3e; --color-fuel-diesel: #a86a3d;
  --color-fuel-surya: #f2d45c; --color-fuel-air: #4fa3d9; --color-fuel-biomassa: #79a94f;
  --color-fuel-lainnya: #a78bc9;
  --color-rain: #e2e5ea; --color-rain-day: #f4f5f7; --color-rain-haze: #5f6874;
  --color-rain-haze-high: #4a525e; --color-rain-vignette: #283040; --color-overcast: #3c4757;
  --font-weight-regular: 400; --font-weight-medium: 600; --font-weight-semibold: 600;
  --text-sub: 0.72em; --text-2xs: 0.6875rem; --text-2xs--line-height: 1rem; --text-xs: 0.75rem;
  --text-xs--line-height: 1rem; --text-sm: 0.8125rem; --text-sm--line-height: 1.25rem;
  --text-base: 0.875rem; --text-base--line-height: 1.25rem; --text-lg: 1.0625rem;
  --text-lg--line-height: 1.5rem; --text-xl: 1.375rem; --text-xl--line-height: 1.75rem;
  --text-2xl: 1.75rem; --text-2xl--line-height: 2rem; --text-readout: 2.75rem;
  --text-readout--line-height: 1; --text-display: 3.75rem; --text-display--line-height: 1;
  --leading-relaxed: 1.5; --tracking-tight: -0.01em; --tracking-display: -0.02em;
  --spacing: 4px; --radius-xs: 2px; --radius-sm: 4px; --radius-md: 6px; --radius-full: 999px;
  --shadow-panel: 0 1px 0 rgb(4 7 12 / 0.3), 0 12px 32px -16px rgb(4 7 12 / 0.55);
  --shadow-float: 0 2px 4px rgb(4 7 12 / 0.4), 0 16px 32px -12px rgb(4 7 12 / 0.65);
  --shadow-panel-day: 0 1px 0 rgb(16 20 27 / 0.04), 0 12px 32px -16px rgb(16 20 27 / 0.3);
  --shadow-float-day: 0 2px 4px rgb(16 20 27 / 0.1), 0 16px 32px -12px rgb(16 20 27 / 0.32);
  --shadow-dot: 0 0 0 1px var(--color-paper), 0 0 0 2px var(--color-ink);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1); --duration-instant: 120ms; --duration-quick: 200ms;
  --duration-panel: 240ms; --duration-exit: 180ms; --duration-intro: 6000ms; --duration-tooltip: 400ms;
  --layout-inset: 24px; --layout-panel: 336px; --layout-reserve-right: 96px; --layout-clear-bottom: 44px;
}
```

## 6. Motion (JS values live in `src/web/motion.ts`)

- Panel enter 240 ms `ease-out`, exit 180 ms `ease-in`; moves at most 16 px. Controls: the accent block of a segmented choice slides with a spring `visualDuration 0.2, bounce 0.15`; switches use HeroUI's own short CSS transitions. Panels: no bounce. Tooltips open after 400 ms.
- The needle is the only element with overshoot: spring `visualDuration 0.4, bounce 0.25`, like a meter needle.
- Count-up: 900 ms `ease-out`, only on first reveal or a real data change, never on hover. Stagger 30 ms, total at most 300 ms, first mount only.
- The intro is the one orchestrated moment: title and lede settle in 700 ms, the 6 s flight, columns rising, then the panels assemble in 500 ms with an 80 ms stagger.
- Camera after the intro: `flyTo` 2000 ms, `curve 1.2`; any user gesture stops it. The idle orbit (spec Goal 8) is a slow sway, not a full turn: after 20 s without input the camera swings like a pendulum 12° either side of the bearing it rests at, 36 s there and back (at most about 2.1 deg/s), easing in from rest. Any input stops it where it is; idle again, it carries on around the same resting bearing. At the province view (below zoom 7.5) the sway always centres on the province bearing (-14°): after "Hadapkan ke utara" or a drag, it first glides back to the arc at its own speed, so the region names only ever face the arc the smoke sweeps. The map has no snap to north (`bearingSnap: 0`), so a gesture that ends near north, inside the sway, leaves the bearing where it is. The province stays readable while a presenter talks, and the region names only have to hold over this arc.
- Map motion: columns rise 1.6 s in a west-to-east wave (intro only), select 900 ms, metric swap sink 380 ms then rise 900 ms. Hover previews a selection in 300 ms: the column rises ×1.12 and the others fade 60% toward the dimmed colour. A selection (900 ms) sinks the others to the ground and dims them; from zoom 8.6 they are gone, so a region seen up close stands alone on the basemap, and from zoom 10 the selected column turns see-through (45% at 10.6) so its city shows through while its outline keeps the shape. The camera frames a selected region inside the space the sheet, the dock and the tools leave free (measured on screen). Colour fades are tweened like the heights (feature-state `fade`), so no colour ever jumps; nothing glows. Idle sway only below zoom 11.
- Reduced motion: `MotionConfig reducedMotion="user"`, the camera jumps, counters show the final value, no sway, opacity fades stay.

## 7. Layout and components

- Left sheet (`layout-panel` wide, inset from the top-left), one editorial column: a masthead (`Malas Ngoding`, and the span of the data shown, `Data 2019–2026`), the place name with its one readout right under it, the ranked list as an index (rank, name, value, and a 4 px bar in the ramp colour under the name), then a foot with one hint and one source line. The region detail names the year of each figure (penduduk "proyeksi 2025", pelanggan and elektrifikasi "data 2024", desa "data 2026", the emission factor "data 2019" in the note). It scrolls inside itself if the screen is short.
- Bottom dock, two cards side by side right of the sheet, bottom-aligned: the legend (what you see: "Tinggi kolom" with its metric switch, the meter with ramp, ticks with real values, unit and "perkiraan", and the "Pembangkit" fuel key, which steps back when the plant layer is off) and the map controls (what you can change: "Lapisan" with Wilayah and Pembangkit, then "Cahaya" Otomatis, Siang, Malam with Hujan and its hint). Every group name has one style (`group-label`). Dawn and dusk have no button: from the clock or from a `?cahaya=dawn` link they show as Otomatis, and the label then names the light ("Cahaya fajar", "Cahaya senja"); Otomatis goes back to the link's light. Both cards fit beside the sheet from 1280 px wide; narrower, the controls card wraps above the legend; on phones both take the full width. On screens 820 px tall or less the sheet tightens, and again at 740 px (with a tighter dock, so it clears the south of the province), so all ten regions fit.
- Basemap labels are Indonesian (`language: "id"`). On the globe and in the first half of the intro (below zoom 5.5, crossed at about 2.4 s, before the columns rise) the basemap names the geography (Malaysia, Brunei, Jakarta, Makassar, Laut Sulu; Standard has no label for Selat Makassar at these zooms). Once the overview has landed, the basemap names come back only below zoom 4.5, so a small zoom-out from the province view (to about zoom 5) shows the standing columns alone, with no basemap names over them. While the columns stand (zoom 5.5 to 12, and from 4.5 after the intro) the basemap place names are off, because Standard draws them ghosted behind the columns; our own region names (`regionLabels.ts`, DIN Pro Medium, paper on an ink halo) sit on top of each column (`symbol-z-elevate` + `symbol-z-offset` = the column's resting height). The crowded coast is hand-placed at the province view (`text-variable-anchor` would switch the lift off) and every label centres from zoom 7.5. Placement priority follows the metric shown, largest first (`symbol-sort-key`, which Mapbox sorts across tiles), so Samarinda, Kutai Kartanegara, Balikpapan and Kutai Timur never yield. All ten names hold, none touching another or a panel, over the whole idle sway at 1280 to 1920 px, CO2 and kWh (the smoke sweeps it); a name that ever has to yield fades with Mapbox's 300 ms symbol fade. Plant markers sit under the names and never push one away; a name over a marker stays legible on its ink halo. Labels are full or nothing, never half-faded; hidden while columns move; a selection keeps only its own. Road names show from zoom 11, place names again from 12.
- The right side stays free for the building panel (Task 7) and the chat button (Task 8). Our own map tools (`panels/MapTools.tsx`, not Mapbox's controls) sit bottom-right above the chat button: one vertical toolbar with zoom in, zoom out, north (its needle turns with the map), back to the whole province, and "Tentang peta ini" (a popover with the map and data sources). Arrow keys move between tools; every tool has a tooltip. The Mapbox wordmark and the full attribution line ("© Mapbox © OpenStreetMap Improve this map") stay on screen in the bottom-left corner under the sheet, as the Mapbox terms ask.
- Tooltip and popup: `overlay` (the panel colour of the theme), `border-strong`, `radius-sm`, the float shadow; name, then value, unit and "perkiraan". A plant's tooltip: name, fuel with its dot, capacity in MW. Status notes ("Rencana", "Lokasi perkiraan") are plain muted text.
- The one primary button per view (for example "Coba lagi") is filled `accent` with `accent-foreground` text. Every other button is text or outlined.

## 8. Info panel pattern (Task 7 building panel, also region detail)

- Right side, 360 px (320 px at 1440 px and below), from the top inset down to just above the legend strip; slides in 16 px from the right (240 ms). On narrow screens it becomes a bottom sheet.
- Order: name (600; a place name is the largest type), type as an editable select that looks like text with a chevron, floors stepper; then the one readout (kWh per year, perkiraan); then tabs Energi / Emisi / Surya / Cuaca as underlined text tabs; then details as label-value rows with hairlines between groups.
- `bySource` as one horizontal stacked bar in fuel colours with a labelled list below (a donut is allowed only if its labels sit outside it). Equivalents as a list of rows (number, unit, label); no card grid, no emoji.
- Loading: a skeleton with the same rows (flat `panel-high` blocks, no shimmer). Error: one sentence about what failed and a "Coba lagi" button. Outside Kaltim: say "Di luar Kalimantan Timur" in place of the region.
- Building highlight and select colours: on dark presets the hover is `paper` and the selection the light CO2 amber (`co2-4`), because the night `faded` basemap grades light neutrals down until a paper selection all but vanishes; `outline-light` on light presets (day, dawn).

## 9. Rain (`setRainEffect` in `src/web/map/effects.ts`)

```ts
const reveal = (v: number) => ["interpolate", ["linear"], ["zoom"], 15, 0, 16.5, v];
map.setRain({ density: reveal(1), intensity: 0.85, color: token("--color-rain"), opacity: 0.95,
  vignette: reveal(0.35), "vignette-color": token("--color-rain-vignette"), direction: [0, 80],
  "droplet-size": [1.3, 14], "distortion-strength": 0, "center-thinning": 0.15 });
// Light ground (day, dawn): color --color-rain-day (brighter), opacity 1, vignette 0.3, plus rainFog():
// fog color --color-rain-haze, range [-2, 9], horizon-blend 0.2 at full rain.
```

Below zoom 15 the density is 0, so the province and city views never show rain. Off means `setRain(undefined)`. No refraction (`distortion-strength: 0`): it made the streaks glassy smears and costs a full-screen copy per frame. By day the haze is spliced into the basemap's own fog from zoom 15 to 16.5, so the globe and province views keep their atmosphere; switching rain off, or to a dark preset, puts the basemap fog back. Mapbox fog is `(1 - e^(-6r))^3` of the way along its range, so `[-2, 9]` dims the map centre by about 30% and the city two camera-distances further by about 70%: the light streaks show, the whole city stays visible. Spliced values that are plain arrays go in as `["literal", [...]]`, the form every GL JS version parses (3.33 happens to coerce a bare one). A flat `overcast` slate layer between the map and the panels fades in with the rain to 10% on a light ground and 12% on a dark one; it dims streaks and city alike, so it sets the mood, not the contrast. A light change re-applies rain, haze and tint. While rain is on and the view is farther out than zoom 15, the legend says under the switch: "Terlihat saat peta diperbesar sampai tingkat gedung."

## 10. Components: HeroUI v3 and the theme bridge

- UI components come from HeroUI v3 (`@heroui/react`, styles `@heroui/styles`; docs https://heroui.com/react/llms.txt, component pages are `.mdx`). In use: Card (sheet, dock cards, failure card), Button (Semua wilayah, Coba lagi, Lewati intro, map tools), ToggleButtonGroup (metric and light switches: a radiogroup with arrow keys), Switch (layers, rain), Toolbar, Tooltip, Popover, Separator. The ranked list rows stay our own buttons: they are data rows with a bar, not a HeroUI pattern.
- `src/web/styles.css` imports `tailwindcss`, then `@heroui/styles`, then the bridge `src/web/atlas-theme.css`. Raw values stay in the theme block of `styles.css`; the bridge maps them onto HeroUI's semantic variables (`--background`, `--foreground`, `--surface`, `--overlay`, `--muted`, `--accent`, `--border`, `--separator`, `--focus`, `--field-*`, `--radius`, the shadows and tooltip delays) under `[data-theme="atlas-night"]` and `[data-theme="atlas-day"]`, plus two of ours: `--faint` and `--border-strong`. Our own component classes read the same variables, so a panel and a HeroUI control never drift apart.
- The theme sits on `<html>` (HeroUI computes `--accent-hover` and friends on `:root`) and follows the ground tone: `atlas-day` (paper sheet, ink type, ink accent) for day and dawn, `atlas-night` (ink panel, paper type, `paper-bright` accent) for dusk and night. Overlays in portals (tooltips, popovers) follow it too.
- Icons: `@gravity-ui/icons` (the set HeroUI's examples use) for every icon in the chrome: the map tools (Plus, Minus, Compass turned by the bearing, House, CircleInfo) and the back chevron. No hand-drawn SVGs, no other set.
- HeroUI's look is adjusted in the bridge, unlayered, by setting each component's own variables (`--button-bg`, `--toggle-button-fg-selected`, `--switch-control-bg-checked`) and only then its properties: radius `sm` for controls and `md` for cards (HeroUI's defaults are pills and 24 px corners), our type sizes, no shadows on controls. Our base element rules sit in `@layer base`, so HeroUI's component rules win over them. HeroUI owns some class names (`.meter`, `.card`, `.button`, ...); our legend scale is `.gauge` for that reason.
