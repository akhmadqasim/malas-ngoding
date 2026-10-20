# 06 Colour for a dark basemap data map

Date: 2026-10-21. Scope: colour for the CO2 fill-extrusion columns on the Mapbox Standard basemap, plus the UI chrome.

## Sources and status

- [S1] WCAG 2.1 SC 1.4.11 Non-text Contrast, https://www.w3.org/TR/WCAG21/#non-text-contrast (fetched, official)
- [S2] WCAG 2.1 SC 1.4.3 Contrast (Minimum), https://www.w3.org/TR/WCAG21/#contrast-minimum (fetched, official)
- [S3] Matplotlib, Choosing colormaps, https://matplotlib.org/stable/users/explain/colors/colormaps.html (fetched, official docs)
- [S4] Nunez, Anderton, Renslow 2018, "Optimizing colormaps with consideration for color vision deficiency", PLOS ONE, https://pmc.ncbi.nlm.nih.gov/articles/PMC6070163 (search summary only, not read in full)
- [S5] ColorBrewer 2.0, https://colorbrewer2.org/ (fetched, official tool page)
- [S6] Mapbox Standard style guide, https://docs.mapbox.com/map-styles/guides/standard-styles/ (fetched, official)
- [S7] Mapbox style spec, fill-extrusion layer, https://docs.mapbox.com/style-spec/reference/layers/#fill-extrusion (fetched, official)
- Unverified: all hex values below are hand-picked. Contrast ratios were computed by hand from the WCAG relative luminance formula. Check them with a contrast tool and a colour-vision simulator before shipping.
- Not found: a source that says which ColorBrewer schemes pass the colour-blind filter, including YlOrRd. S5 only lists the filter names.

## 1. Sequential scales for intensity

What the sources say:
- [S3] "For many applications, a perceptually uniform colormap is the best choice; i.e. a colormap in which equal steps in data are perceived as equal steps in the color space." It also says lightness should rise monotonically, because viewers read lightness changes better than hue changes.
- [S3] Lists viridis, plasma, inferno, magma and cividis as the perceptually uniform sequential group. It does not describe each one.
- [S4] Cividis runs blue to yellow. The authors built it to read nearly the same for viewers with and without red-green colour vision deficiency (CVD). The paper's summary says more than 4% of people have a CVD. Other sources in the same search gave 8.5%.
- [S5] ColorBrewer offers "colorblind safe", "print friendly" and "photocopy safe" filters. The page does not say which schemes pass each filter. YlOrRd is not named on the page.

Practical reading for a dark basemap (my reasoning, not from a source):
- Magma and inferno start near black. On a near-black basemap their low values disappear. Viridis starts dark purple, which has the same problem.
- Cividis is the safest family here. Its blue-to-yellow path avoids red and green, which is the axis most CVD types confuse.
- YlOrRd is the ramp that reads as "fire" and is the look the user calls slop. The hue path from magenta through red to orange is also the red-green risk zone. Avoid it.
- A dark basemap needs every class to clear 3:1 against the background (see section 4). Truncate the ramp so it does not start at black. Do not use the full 0 to 1 range.

## 2. Restrained accent

- Use one accent hue, and use it for interface state only: active tab, focus ring, selected region outline. Never use it as a data colour.
- Keep data colour (the CO2 ramp) and accent apart. If the accent sits inside the ramp's hue range, a selected column looks like a data value.
- The current code has three accents (`--ember`, `--arus`, `--surya`, in `src/web/styles.css`), and the CO2 ramp is `#4a3f7a, #b8487a, #ff6a3d, #ffc65c` (`src/web/map/regionsLayer.ts`). Together they are the "neon" look. Cut the accents to one.
- No source checked the accent rule. It is a design judgment.

## 3. Neutral surfaces with a slight hue

- Dark surfaces should be tinted, not pure black or pure grey. The existing palette already does this (`--ink: #0d1524`), but it is saturated navy. Lower the saturation so the surfaces recede behind the data.
- Keep text off pure white. A near-white with a little blue (`#E6EAF0`) is easier on a dark screen and keeps the contrast high.
- The surface step between levels should be small (about 6 to 8 lightness points), so panels look layered without glow.

## 4. Contrast and accessibility

- [S1] "The visual presentation of the following have a contrast ratio of at least 3:1 against adjacent color(s):" with "Parts of graphics required to understand the content", "except when a particular presentation of graphics is essential to the information being conveyed."
- [S2] Text needs 4.5:1. Large text needs 3:1.
- Applied to columns: the lowest class must reach 3:1 against the basemap. On a dark basemap, that rules out dark stops. The ramp below starts at about lightness 40 for this reason.
- Colour is not the only channel. Column height already encodes the value, so colour can be a second cue. Keep that redundancy, and do not rely on colour alone to read a legend.
- For CVD, use a blue-to-yellow path (cividis-like). Test with a colour-vision simulator. Not checked in this round.
- Glow and emissive light change the rendered colour. Measure the colours from a screenshot, not from the hex values.

## 5. Mapbox Standard light presets

- [S6] "Set the `lightPreset` option to one of four predefined lighting conditions: `dawn`, `day`, `dusk`, or `night`."
- [S6] "The preset affects the color temperature, shadow direction, and intensity of both ambient and directional lighting." So a preset change shifts the rendered colour of every fill, including your columns.
- [S6] The doc does not state the default preset. It also has theme options (`default`, `faded`, `monochrome`, `custom`) and `show3dObjects`. Use the basemap theme to quiet the base map so the data colour stands out.
- [S6] Night note: "custom layers added to the map require an `emissive-strength` configuration." The doc says layers can render black under `night` if emissive strength is 0. Confirm this for `fill-extrusion` in your own test, because the note is written for custom layers.
- [S7] `fill-extrusion-emissive-strength` "Controls the intensity of light emitted on the source features." The code sets it to 0.72, and 1 on hover. Higher values push colours toward neon. Keep it low.
- The app changes the preset by time of day (`lightPresetFor` in `src/web/map/effects.ts`). `MapView.tsx` also allows a pinned preset. Pin one preset for the palette, because a time-based change alters every column colour during the day.

## 6. Recommendation summary

- One basemap preset (pinned), one basemap theme, low emissive strength.
- Cividis-style blue-to-yellow ramp for CO2, truncated so the low end clears 3:1.
- One muted accent for UI state only.
- Neutral, slightly blue-tinted surfaces.

## Concrete rules for Malas Ngoding

Surfaces (dark, slight blue hue):
- Map and page background: `#0E1116`
- Panel: `#161B22`
- Raised card and border: `#222A35`
- Hairline and grid: `#2D3644`

Text:
- Primary (headings, values): `#E6EAF0` (about 16:1 on `#0E1116`)
- Secondary (body): `#9AA5B5` (about 7.6:1 on `#0E1116`)
- Muted (captions, axis labels): `#7A8699` (about 5.1:1 on `#0E1116`, 4.7:1 on `#161B22`)

Accent (UI state only: focus, active tab, selected region outline; never inside the data ramp):
- `#6CB4C8` (about 8.1:1 on `#0E1116`)

CO2 scale, low to high, six stops (blue to yellow, lightness rises each step; contrast is against `#0E1116`):
1. `#3A6690` (about 3.1:1)
2. `#4F8A96` (about 4.9:1)
3. `#76A08A` (about 6.5:1)
4. `#A8B77A` (about 8.8:1)
5. `#D6C760` (about 11:1)
6. `#F4E04D` (about 14:1)

Rules:
- Use only these six stops for CO2. Remove `#4a3f7a`, `#b8487a`, `#ff6a3d`, `#ffc65c` and the old accents.
- Set the map to one pinned Mapbox Standard preset. Do not change it by time of day in the data view.
- Keep `fill-extrusion-emissive-strength` at or below about 0.5. Hover may go higher, but test it.
- Keep height as the second value channel. Do not use colour alone.
- Check the final render with a screenshot, a contrast checker and a colour-vision simulator. The hex values above have not been tested in a render.
