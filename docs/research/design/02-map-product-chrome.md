# Map product chrome: what respected map UIs share

Research date: 2026-10-21. Scope: UI chrome around the map (panels, sidebars, controls, type, colour, density).

Source quality note: Official docs were fetched for Felt, Kepler.gl, Mapbox, and Nullschool. Flightradar24 blog posts returned HTTP 403, Electricity Maps products page and Apple Maps and Justin O'Beirne pages returned 404, and the Apple HIG Maps page returned only its title. Those items rely on search snippets and are marked UNVERIFIED. Windy findings come from community forum posts, not Windy's own docs.

## Findings per product

### Felt (verified, official docs)
- Layout: "The Felt toolbar runs along the top of the map." Edit-mode tools sit in the centre of the toolbar. "The legend in Felt is the left panel of a map." A "detail panel opens on the right when you select a layer or annotation." "The map is the area in the middle of the screen."
- Two modes: "Use view mode to explore a Felt map and edit mode to change it." The viewer sees a Legend tab. The editor sees a List tab with all layers and annotations.
- Extension panels (SDK): action triggers are buttons in the left sidebar. Custom panels sit in the right sidebar with a header, body, and footer. Footer holds primary actions "pinned to the bottom".
- Button rule from the SDK docs: "Use sparingly - typically one per panel section." Group related buttons in a ButtonRow.
- Sources: https://help.felt.com:443/getting-started/tour-the-interface , https://developers.felt.com/js-sdk/ui-components , https://help.felt.com/layers/list

### Kepler.gl (verified, official docs; partial)
- Theme is a single setting: "dark", "light", "base", or a theme object that "will use the value passed as input to overwrite values from" the base theme. Docs say the default is "dark".
- The docs do not list which UI elements (side panel, cards, text colours) a theme object controls. Treat the panel styling as not documented.
- Map style (Dark/Light basemap) is separate from the UI theme. The docs describe the basemap text colour, not the panel.
- Sources: https://docs.kepler.gl/docs/api-reference/custom-theme , https://docs.kepler.gl/docs/user-guides/f-map-styles

### Mapbox (verified, official docs)
- Mapbox says it is removing hand-tuned cartography: Standard presets "Day, Night, Dusk and Dawn" with "ability to pass custom lighting settings". The docs say this "reduces the technical burden and cartographic ability needed to maintain a map".
- Runtime tuning is a documented pattern: "Lighten or darken the map based on the time of day", "increase the size of labels based on user preferences to improve legibility".
- Config is set through a `config` parameter; for Standard the basemap option is `basemap`. `lightPreset` changes lights, e.g. from `day` to `dusk`.
- Limit: the docs say colour theming and 3D object toggles are not available on Standard Satellite. The docs do not give a dark-palette recipe.
- Legacy Light/Dark styles are "no longer actively maintained" (search snippet, UNVERIFIED wording only from snippet).
- Sources: https://docs.mapbox.com/help/dive-deeper/map-design/ , https://docs.mapbox.com/mapbox-gl-js/guides/styles/set-a-style.md

### Nullschool earth (verified, own about page)
- Credits HINT.FM wind map as inspiration. Colour scales are cited as ColorBrewer2, "Kindlmann Linear Luminance", MYCARTA, and "Dave Green's cubehelix". So the palettes come from perceptual colour research, not taste.
- Fonts credited: M+ FONTS and Google Noto Fonts. The chrome is mostly keyboard-driven: animation toggle, "go to now", HD mode.
- The author says of the CO2 overlay: "This is not scientifically valid, but it does allow the visualization to become illustrative". Honest labelling of a simplified layer.
- Source: https://earth.nullschool.net/about

### Flightradar24 (UNVERIFIED, snippets only; blog returned 403)
- Snippet from its blog: base maps "rendered in vector format" with WebGL, which "cut map load times and sped up panning and zooming".
- Map controls sit on the right with a true full-screen mode. Settings bar moved to the bottom. Flight info panel reorganised; progress bar shows elapsed and remaining time and distance.
- Density is a user choice: icon size slider, List View for paid tiers, multi-select shows route, type, altitude, ETA, photo.
- Sources (search results, not fetched): https://www.flightradar24.com/blog/inside-flightradar24/supercharging-flightradar24s-data-display/ , https://www.flightradar24.com/blog/inside-flightradar24/an-overview-of-the-updated-flight-information-panel-on-flightradar24-com/

### Windy.com (community sources only, not official)
- Users say controls can be "faded and blurred" when idle, and side decorations removed (userstyle). Customisation has a "hide controls" option.
- Complaints about the redesign: crowded layout, a top bar that appears and vanishes for spot readings, and a request for an adjustable, thinner sidebar "which allowed to show more of the map". This is the clearest signal that density drives perceived quality.
- Sources: https://community.windy.com/topic/27534/new-ui-is-clunky/2 , https://community.windy.com/topic/26665/make-the-sidebar-width-adjustable , https://userstyles.world/style/16835

### Apple Maps (UNVERIFIED, search snippets; pages returned 404 or no body)
- 2021 redesign changed "every aspect of the map's look and feel at once" (O'Beirne snippet). Physical-feature labels were made smaller and lighter; city labels got letter-spacing changes; landcover lost a yellow tint (beta notes).
- Lesson in the snippets: label weight and tint changes were tuned over several betas, and one neighbourhood style was reverted. Hierarchy is tuned per zoom level.
- Apple HIG Maps page was not retrievable. Not found: a verified Apple quote on overlays.
- Sources (snippets): https://justinobeirne.com/apple-maps-redesign-screenshots , https://justinobeirne.com/ios-15-beta2-cartography-changes

### Electricity Maps (UNVERIFIED; products page 404)
- Search snippet describes the map as showing real-time generation, consumption, and carbon intensity, and says the map is open source. Website redesign exists on Dribbble (Rasmus Jeppsen), not an app write-up. Not found: a published app design case study.
- Source (snippet): https://electricitymaps.com/products

### Google Earth (weak; no 2025 design source found)
- Search results: a 2023 support thread reports tilt and compass controls missing from new Earth Web. A revamped search groups suggestions by type and offers category filters. Google Maps moved UI into floating sheets over the map (Google Maps, not Earth). Not found: a verified Google Earth design write-up.

## What they share (inference from the sources above)
1. The map is the centre and the chrome sits at the edges: toolbar top, legend or list left, detail right (Felt). Floating or fading controls (Windy, Flightradar24).
2. Mode separation: view versus edit (Felt). Simple view for readers, more controls only when needed.
3. Few primary actions: one filled button per section, footer for the main action (Felt SDK).
4. Palettes are chosen on purpose and cited: perceptual scales (Nullschool), luminance-based colour (Kindlmann).
5. Labels and tints are tuned per zoom and per legibility need, and changed in small, tested steps (Apple, Mapbox).
6. Density is user-adjustable: sidebar width, icon size, hide controls (Windy, Flightradar24).
7. Honest labels on simplified data (Nullschool CO2 note).

## Concrete rules for Malas Ngoding
- Keep the map full-bleed. Put all chrome in a single left column (about 320 px) or floating cards on the edges. Do not overlay the 3D view centre.
- Use one fixed set of 2 to 3 colours plus one accent. Choose the accent for CO2 or load only, not for decoration. Check contrast of labels against the basemap.
- Use a perceptual sequential palette for intensity (for example, a luminance-based scale), and cite it in the legend.
- Make the legend a first-class element: units, scale, and time range in one place, always visible.
- Use a single sans typeface with 2 to 3 sizes. Use tabular figures for kWh and ton CO2 numbers so values do not jump.
- Limit primary buttons to one per panel section. Use secondary text buttons for the rest.
- Let the user hide the panel and reset the view. Fade idle controls only if the map stays usable without them.
- Show the data source and update time in small text at the bottom edge, not as a banner.
- Use a single time control (scrubber or range) at the bottom. Do not add several competing timeline widgets.
- Tune label size and weight by zoom level after screenshots, not by guess. Keep kabupaten and kota labels at a readable size on a dark basemap.
- Use the basemap's built-in dark preset as a starting point (Mapbox Standard `lightPreset` night), then adjust with documented config options. Do not hand-tune every layer first.
- Avoid decorative gradients, glassmorphism stacks, and icon-in-circle grids. These are the "AI-ish" tells; no cited product above depends on them.
- Write every number with its unit next to it, and label simplified CO2 estimates as estimates, as Nullschool does.
- Keep density low by default; offer a denser table or list view as an opt-in tab (Felt List, Flightradar24 List View).
- Test with one screenshot per state (default, hover, selected, empty). Compare against Felt's legend view as the reference for a read-only public map.

## Gaps
- Flightradar24, Electricity Maps, Apple HIG, and Apple Design Awards material could not be fetched. Re-check if you need exact quotes.
- No primary design write-up was found for Windy, Electricity Maps app, or Google Earth 2025.
