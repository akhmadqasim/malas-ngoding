# Editorial map design: what newsroom teams do (research note)

Date: 2026-10-21. Scope: NYT Graphics, Reuters Graphics, Bloomberg Green, The Pudding, Washington Post, Katadata, Kompas, Jakarta Satu / Indonesia One Map.

Evidence labels: **[Official]** = vendor or org page I fetched. **[Interview]** = transcript I fetched. **[Secondary]** = third-party article or search snippet, unverified. **Not found** = no usable source after search.

## Coverage summary

- NYT Graphics: found an interview transcript with two NYT graphics editors (Mike Bostock, Shan Carter). No NYT style guide found.
- Pudding: found a Storybench article about its story structure. Its process page returned 404. Typography and annotation practice: not found.
- Washington Post: found a Felt blog post (2021) written by a Post graphics editor. The fetched text is thin on labels and annotation.
- Reuters: found only old coverage (2007 NewsMap, 2016 Graphiq partnership, 2020 scrollytelling). No current map style guide found.
- Bloomberg Green: **Not found.** Search returned nothing on its map design.
- Katadata: **Not found.** No kompas.id pages surfaced either.
- Kompas data: **Not found.**
- Indonesia One Map (KSP Geoportal): functional facts only. No design guidance found.

## 1. NYT Graphics (interview, Datastori episode 22)

Source: [Datastori episode 22 transcript](https://archive.datastori.es/episode/22/) [Interview]. Speakers are Mike Bostock and Shan Carter. Quotes below are from that transcript.

- Restraint: Carter, "as simply as we can convey the essence of the core truth" is the aim for unusual graphics.
- Static first: Bostock, "the static view of the graphic is supposed to convey all of the important points." Interaction adds depth; it does not carry the main point.
- Controls must be visible: Bostock says users missed that the 512 Paths graphic was interactive because its controls "weren't sort of very visually salient."
- Custom UI over defaults: on the NFL Draft graphic, the team debated a native slider versus "write a custom slider that looks better and is sort of more integrated with the design."
- Learning cost: Carter, "time spent learning how to use a graphic is kind of time wasted," so confusing UI gets watched closely in feedback.
- Prototype in code: Carter says sketching on paper fails for data work, so the team prototypes with real data. Screenshots are sometimes moved to Illustrator to test annotation placement and UI elements (paraphrased).
- Iterate: attributed to Amanda Cox, "it's easier to kind of make a thousand graphics and pick the best one."
- Auditable pipeline: Bostock aims "to have a fairly well automated process for going from the raw data from the primary source" so edits can be audited.
- Basemap: Bostock says a border map he found was distorted, "stretched vertically by 12%." Lesson: check the source geometry before styling it.

Annotation, label, and colour rules were not discussed in the transcript I read (I read about 100k of 110k characters).

Also see the NYT "annotation layer" idea (text added to clarify data, highlight key points, add context). Source is a course handout, [Secondary], unverified: [Knight Center handout](https://knightcenter.utexas.edu/JC/courses/DATA0819/Eng/The-annotation-layer.pdf). Not fetched.

## 2. The Pudding (Storybench, secondary)

Source: [Storybench: How The Pudding structures stories](https://www.storybench.org/?p=8613) [Secondary, but it quotes the team].

- "data and design have to work together to carry the narrative"
- "Visual stories really need clear, hard, underlying conclusions in order to be interesting to people."
- "there is no one narrative shape that defines visual essays."
- The team shapes a story's arc after learning the data. Example shapes: a symmetrical V that narrows to a few points, then widens; a lopsided inverted V that opens broadly and narrows to state-level detail.

Scrollytelling pattern (pinned section plus a chart that redraws as you scroll): [Secondary] only, from a vendor blog. The Pudding process page (pudding.cool/process/) returned 404. Typography and annotation: **not found**.

## 3. Washington Post (Felt blog, 2021)

Source: [Felt: Mapping climate change at the Washington Post](https://www.felt.com/blog/climate-change-mapping-at-the-washington-post) [Interview-style blog, by a Post graphics editor].

- Colour ramp was chosen jointly with the Capital Weather Gang, asking "what type of color ramp would really communicate what was happening."
- Uncertainty is shown on purpose: "We also need to be able to show the uncertainty, and we have done a lot of work to represent this visually."
- Purpose stated early: "People need to know this, and our role is to show it as clearly as we can."
- Hurricane maps centre the path and "who will be impacted."
- Labels, annotation, basemap, and typography: not discussed in the text I fetched.

WaPo Climate Lab uses a "What's at stake" module and a "Check my work" feature ([Secondary], from a search snippet; not fetched). Source snippet came from a search result, and the Mapbox showcase page for WaPo was not read.

## 4. Reuters Graphics

- 2007 NewsMap plotted stories by the places they mention. Hovering a pinpoint showed "a location and news headline linked to the article." Source: [journalism.co.uk](https://www.journalism.co.uk/reuters-plots-news-stories-on-interactive-map/) [Secondary, a 2007 news report, fetched].
- Team now produces scroll-driven pieces (for example, the 2020 Beirut blast and Australian bushfire graphics). Source: [Design Week, 2020](https://www.designweek.co.uk/issues/27-january-2-february-2020/in-house-teams-how-reuters-graphics-visualises-catastrophic-world-events/) [Secondary, search snippet, not fetched].
- Current style guide: **not found**.

## 5. Mapbox basemap facts (official)

Source: [Mapbox Dark style reference](https://docs.mapbox.com/map-styles/reference/dark/) [Official, fetched].

- "is a classic style that is no longer actively maintained"
- "For new projects, use Mapbox Standard," which "includes continuously improving cartography, 3D features, and dynamic lighting."
- Dark style is described as "a minimal, dark-colored basemap designed to provide a rich backdrop for data visualizations and night-mode interfaces."
- "Its dark background makes brightly colored data layers highly legible."

Label and road styling advice from a community skill (Mapbox cartography) is [Secondary] and unverified: neutral grey roads on dark themes, and avoid coloured base roads because they compete with data layers.

## 6. Indonesian sources

- Indonesia One Map (KSP Geoportal): a reference map for government planning, relaunched as KSP Geoportal 2.0 in July 2024 at onemap.big.go.id. Source: [CNBC Indonesia, July 2024](https://www.cnbcindonesia.com/news/20240712145852-4-554123/begini-cara-gunakan-peta-canggih-geoportal-milik-indonesia) [Secondary, search snippet]. Its design: **not found**. Current status (October 2026): not verified.
- Academic reference for interactive statistical maps (Banyumas study, Geoid journal 2021): [iptek.its.ac.id](https://iptek.its.ac.id/index.php/geoid/article/view/7842). Describes interactive maps as a channel between data owners and users. Not a design guide.
- Katadata, Kompas data pages: **not found**.

## 7. Patterns that look human (synthesis)

These are inferences from the sources above, not rules stated by any one outlet.

1. One question or conclusion per graphic. The Pudding says visual stories need "clear, hard, underlying conclusions."
2. The default view carries the story. Interaction is extra (Bostock).
3. Controls are visible and styled to match the design, not browser defaults (Bostock, NFL Draft).
4. Uncertainty and purpose are stated in the piece (WaPo).
5. Basemap recedes; data colour is the only loud thing (Mapbox Dark intent).
6. Annotation is placed by hand after a test render, not left to automatic placement (Carter, Illustrator note).
7. Data is traceable: an auditable pipeline and visible source notes (Bostock).

## Gaps

- No primary typography or colour guidance from NYT, Reuters, Bloomberg, Pudding, or WaPo was found in the sources I could reach.
- Bloomberg Green and Indonesian outlets: no usable sources.
- I did not inspect the current Malas Ngoding code or screenshots.

## Concrete rules for Malas Ngoding

- Move off Mapbox `dark-v11` to Mapbox Standard, since Dark is no longer maintained (official). Tune its light preset so the basemap stays quiet.
- Write one headline finding for the map (a claim, not a topic), such as "East Kalimantan's grid is X percent coal," and put it above the map.
- Use a grey basemap and two data hues at most: one for electricity, one for CO2. Drop the glow and neon.
- Use one 3D extrusion only, for the quantity that needs height. Keep other layers flat so the reader can compare them.
- Add 3 to 5 hand-placed callouts with short finding-style text and a number with unit and year. Place them after a screenshot check.
- Put the data source, year, and last-updated date in a visible footer, not in a modal.
- Make the legend a short sentence-like key next to the data, not a default floating box.
- Style every control (slider, toggle) with a visible label and the app's own type and colour. Avoid browser-default inputs.
- Show missing or uncertain data with a hatch pattern and a plain-language note.
- Set type hierarchy with three levels: a display face for the headline, a sans for labels, tabular numerals for figures.
- Remove AI tells: gradient text, glowing borders, emoji icons, the equal-size stat-card grid, and the generic dark dashboard frame.
- For the demo, add a 3-step guided path: each step moves the camera once and shows one annotation. Keep the free-explore mode after the guided path.
- Write one sentence on what the map does not show (scope and limits), near the footer.
- Prototype with the real East Kalimantan data from the first build, not placeholder numbers.
- Test the live demo once on a laptop screen and once on a phone-width window before the judging day.
