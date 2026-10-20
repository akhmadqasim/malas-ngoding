# Feature panel, legend, and rain: research notes

Date: 2026-10-21. Sources marked UNVERIFIED come from search snippets or third-party blogs. "Not found" means I did not find an official statement.

## Part 1: Feature info panel and legend patterns

### Mapbox Standard building selection (official, primary)
Source: https://docs.mapbox.com/mapbox-gl-js/example/highlight-buildings-standard/

- Uses `map.addInteraction` with the built-in `buildings` featureset, `importId: 'basemap'`.
- Hover sets the `highlight` feature state and a pointer cursor. Click sets a persistent `select` state and clears the previous selection.
- Quote: "`colorBuildingHighlight` controls the hover color (default: blue). `colorBuildingSelect` controls the click/selection color (default: blue)."
- Quote: "`show3dLandmarks` is set to false, as this highlighting technique does not work for buildings represented as 3D models."
- Config: `config: { basemap: { colorBuildingHighlight: '#93C5FD', colorBuildingSelect: '#1E40AF', show3dLandmarks: false } }`
- Official API page (https://docs.mapbox.com/map-styles/standard/api/) says: "The `buildings` featureset contains all the building layers in the Mapbox Standard style."
- The example shows no panel. It only styles the selected building. The panel is your own UI, so the patterns below apply.

### Felt (official help docs)
Source: https://help.felt.com/styling/popups

- Show modes: "On click", "On hover and click", and "Only on label click". Quote: "A layer uses the same popup for click and hover."
- Placement: "Standard popups always open on the map, next to the feature." Custom HTML/URL popups use a Layout setting: "On map", "Left sidebar" or "Right sidebar" ("a panel at the side for long content"), or "Dialog".
- Overlapping features: "use the popup's arrows to move between them."
- Desktop vs mobile: the page only mentions these as editor preview modes. Not found for end-user behavior.
- Legend: the Felt developer docs say the UI API lets you enable or disable features such as the legend (https://developers.felt.com/js-sdk-api-reference/ui). No legend design spec found.

### Google Maps (official developer docs, limited)
- Place Details element: https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details
  - Quote: "The recommended width range for the `gmp-place-details` element is 250px-400px." and "Widths less than 250px may not display correctly."
  - Quote: "The Place Details element is designed to scroll within the allotted space as needed."
  - Sample places it in a side panel beside the map. Loading: the sample waits for the `gmp-load` event. Error handling: not documented.
- Info window: https://developers.google.com/maps/documentation/javascript/infowindows
  - Quote: "If the `anchor` option is `null` or undefined, the info window will open at its `position` property."
  - Quote on width: "the info window will auto-wrap to enforce the specified width." Async content and error handling: not found.
- Google's own consumer Maps place card layout (order, bottom sheet): official guidance not found. UNVERIFIED: search snippet of Places iOS SDK UI kit (https://developers.google.com/maps/documentation/places/ios-sdk/place-details-ui-kit) describes a compact card (photo, address, rating, price, open-now) and a full view (photo collage, hours, summary, website, phone).
- UNVERIFIED third-party blog: action row (Directions, Call, Save, Share) pinned at bottom of the Overview tab in a beta.

### Apple Maps (official Business Connect guide, limited)
Source: https://business.apple.com/docs/onboarding-guide/place-card

- Quote: "A cover photo and logo personalize the place card and appear at the top. They display as a set-both must be provided."
- Order of blocks: cover photo, logo, action row, gallery, then "Showcase, Good to Know, About the place."
- Action row: directions, call, and website come after the default buttons.
- Essential info: "name, address, hours, and phone numbers," with richer content below.
- Exact header and name/address/hours order: not found. Image sizes: not in this page, see "Photo and text standards and guidelines" in the Business User Guide.
- UNVERIFIED: Apple's MapKit docs list card styles (automatic, full callout, compact callout) per the search snippet (https://developer.apple.com/documentation/mapkit). Not fetched.

### Windy (weak evidence, community sources only)
- Layer controls sit bottom-right. The color legend is shown by default. Source: https://community.windy.com/topic/7012/add-wind-speed-legend/3 and https://community.windy.com/topic/7427/legend-for-different-color-clouds
- Official Windy UI docs: not found. Everything here is UNVERIFIED.

### Common patterns (synthesis, my judgement)
- Key number first: name, then one headline value (rating, height, count), then actions, then details.
- Desktop: anchored card next to the feature (Felt "next to the feature") or a side panel 250-400px wide (Google sample). Mobile: bottom sheet over a visible map.
- Keep the map visible behind the panel. Google's and Apple's cards both sit over the map.
- Legend: keep it small and collapsible, default-on for data layers. Windy does this, UNVERIFIED.
- Loading: show a skeleton with the same layout. Official docs for these panels did not describe loading or error states, so Not found. Show a message with a retry action for failed fetches (judgement).

## Part 2: `map.setRain()` (Mapbox GL JS v3, EXPERIMENTAL)

Sources: https://docs.mapbox.com/style-spec/reference/rain/ and https://docs.mapbox.com/mapbox-gl-js/api/map/ (method `setRain(rain: RainSpecification)`: "Sets the rain property of the style. This API is experimental." Passing null or undefined removes rain.) Also `getRain()`.

Every rain property is marked EXPERIMENTAL on the style spec page.

| Property | Type | Default | Range | Official description |
|---|---|---|---|---|
| density | number | zoom-interpolated: 0 at z11, 0.5 at z13 | 0-1 | "Controls the overall screen density of the rain." |
| intensity | number | 1 | 0-1 | "Controls the overall rain particles speed" |
| color | color | brightness-based, `#03113d` to `#a8adbc` | not stated | "Individual rain particle dorplets color." (sic) |
| opacity | number | brightness-based, 0.88 to 0.7 | 0-1 | "Rain particles opacity." |
| vignette | number | zoom-interpolated: 0 at z11, 1 at z13 | 0-1 | "Screen-space vignette rain tinting effect intensity." |
| vignette-color | color | brightness-based, `#001736` to `#464646` | not stated | "Rain vignette screen-space corners tint color." |
| direction | [number, number] | [0, 80] | 0-360 each | "Main rain particles direction. Azimuth and polar angles." |
| droplet-size | [number, number] | [2.6, 18.2] | 0-50 each | "x - normal to direction, y - along direction" (units not stated) |
| distortion-strength | number | 0.7 | 0-1 | "Rain particles screen-space distortion strength." |
| center-thinning | number | 0.57 | 0-1 | "0 - no thinning. 1 - maximal central area thinning." |

Not stated in the docs: whether rain is limited to the Standard style, and the unit of droplet-size. Treat droplet-size as relative until tested on device.

### Official example (verbatim)
Source: https://docs.mapbox.com/mapbox-gl-js/example/rain (v3.29.0 example, Helsinki, zoom 16.8, pitch 74)

```js
const zoomBasedReveal = (value) => {
    return [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        0.0,
        13,
        value
    ];
};

map.setRain({
    density: zoomBasedReveal(0.5),
    intensity: 1.0,
    color: '#a8adbc',
    opacity: 0.7,
    vignette: zoomBasedReveal(1.0),
    'vignette-color': '#464646',
    direction: [0, 80],
    'droplet-size': [2.6, 18.2],
    'distortion-strength': 0.7,
    'center-thinning': 0 // Rain to be displayed on the whole screen area
});
```

The official example says the expression is used "to gradually fade in the rain effect between zoom levels 11 and 13." It applies zoom expressions only to `density` and `vignette`. The rest are fixed.

### Why far-out rain looks wrong
- The official ramp starts at zoom 11. At zoom 11 to 13 the density is already visible, and a 3D pitched view shows large particles near the camera's ground plane. Droplet sizes are fixed, so they look huge at low zoom. Inference, not stated in the docs.
- `center-thinning: 0` puts rain across the full screen, which adds clutter over the clickable buildings.

## Concrete rules for Malas Ngoding

1. Start rain at zoom 15 and reach full value at zoom 17. Density and vignette are the only zoom-driven values, so keep them as the only interpolated keys.
2. Use smaller droplets than the Mapbox example. Start at `[1.2, 6]` and tune on device. The default `[2.6, 18.2]` looks like streaks at close range.
3. Lower density and opacity so rain does not hide buildings or the selection color. Start with density 0.35 and opacity 0.5.
4. Set `center-thinning` to about 0.6 so the center stays clear for clicks. Use 0 only if you want full-screen rain.
5. Keep `intensity` at about 0.6 to slow the motion.
6. Use a dark vignette color (e.g. `#1a1f2e`) to match the dark theme. Set `vignette` to 0.6 at full zoom.
7. Call `setRain(null)` when the user turns the rain toggle off. Rain is a toggle in the legend or layer panel.

Exact config (values are my starting point, not from the docs; tune on device):

```js
const zoomReveal = (value) => [
  'interpolate', ['linear'], ['zoom'],
  15, 0.0,
  17, value
];

map.on('style.load', () => {
  map.setRain({
    density: zoomReveal(0.35),
    intensity: 0.6,
    color: '#a8adbc',
    opacity: 0.5,
    vignette: zoomReveal(0.6),
    'vignette-color': '#1a1f2e',
    direction: [0, 80],
    'droplet-size': [1.2, 6],
    'distortion-strength': 0.4,
    'center-thinning': 0.6
  });
});
```

8. Feature panel: anchor a card next to the building on desktop, use a bottom sheet on mobile, and show name and one key number first, then actions, then details.
9. Use the Mapbox building interaction (`addInteraction`, `buildings` featureset, `select` state) for selection. Set `colorBuildingSelect` to match the app accent.
10. Show a skeleton while loading and a retry message on error. No official source defines these states, so this is a design choice.
