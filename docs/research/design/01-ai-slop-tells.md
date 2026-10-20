# AI slop UI tells (2025-2026) and what good designers do instead

Research date: 2026-10-21. Scope: visual tells of AI-generated web UI, according to designers and design critics, plus fixes, for the Malas Ngoding map app.

## Source quality notes

- Most sources are practitioner blogs, opinion pieces, and tool vendor pages. I found no survey that measures how common these tells are.
- The Anthropic `frontend-design` skill quotes below come from a WebFetch of the official GitHub file. The fetch went through a summarizing model, so check the wording against the raw file before you quote it in public.
- Items marked **[unverified]** come from search snippets or pages I could not open (one returned HTTP 403).
- Items marked **[not found]** had no designer source in my searches. Do not treat them as established tells.

## Findings

### 1. Indigo-to-purple and blue-to-purple gradients, gradient text

- 925 Studios (Yusuf, Lead Designer): "The blue-to-purple gradient is the single loudest AI tell in 2026." Fix: "a deliberate palette built from something true about the product." Source: https://www.925studios.co/blog/ai-slop-design-tells
- Kosta Canatselis (23 Jul 2026) flags "Purple-to-blue gradients (including gradient text)" and says: "Use colour semantically, not decoratively." Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/
- Anthropic `frontend-design` skill, purple gradients on white listed as a cliche. Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Origin claim: Alan West (DEV Community) argues the purple comes from training data. Tailwind UI's indigo-500 "worked well in demos", and models return the "median of every Tailwind-based landing page". Source: https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- Adam Wathan's apology tweet (Aug 2025) is cited only second-hand here. **[unverified]**

### 2. Inter as the default face, and single-word accents in headlines

- 925 Studios: Inter is "the safest possible answer". Fix: "pairs Inter with something that does [carry a feeling]". Source: https://www.925studios.co/blog/ai-slop-design-tells
- Canatselis: "Inter paired with a system fallback and nothing else." Fix: "Change the font before you change anything else." Pair one display face with one readable body face. Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/
- Anthropic skill: "Choose your typefaces deliberately, not the default families you would reach for on any other project." It also lists as tells: "Accenting just a single word or phrase in a headline", "Using all caps for labels", and "Adding unnecessary typographic labels above content." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

### 3. Gradient buttons and gradient washes used as decoration

- 925 Studios: a landing page with "a gradient button that says" its call to action. Source: https://www.925studios.co/blog/ai-slop-design-tells
- Anthropic skill: "gradient washes as decoration" are part of the "SaaS-card kit". Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

### 4. Three identical rounded feature cards, thin-line icon on top

- 925 Studios: "a row of three feature cards, rounded corners, soft shadow, thin-line icon at the top of each." Fix: "asymmetry, a different rhythm". Source: https://www.925studios.co/blog/ai-slop-design-tells
- Canatselis: "Same padding, same radius, same card height across the whole screen." Fix: "Break the uniformity on purpose." Make the primary element larger and heavier, and let secondary ones recede. Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/

### 5. Same radius and same soft shadow on everything

- Anthropic skill: "one border-radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each". Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Specific class names like `rounded-2xl`: **[not found]** as a named tell by a designer. The point is the uniform radius, not the class.

### 6. Emoji and generic line icons

- 925 Studios: "a set of thin, interchangeable line icons that could illustrate any product." Fix: "a real decision where the model left a default." Source: https://www.925studios.co/blog/ai-slop-design-tells
- Lucide, Inter, shadcn, and Tailwind spacing as the shared default kit: UX Design article snippet, "ai design isnt ugly it s fluent and thats the problem". **[unverified]** (page returned 403). https://uxdesign.cc/ai-design-isnt-ugly-it-s-fluent-and-that-s-the-problem-131b2f4eb78c
- Emoji used as feature icons: one landing-page guide snippet. **[unverified]** https://superdesign.dev/blog/fix-generic-ai-landing-page

### 7. Glassmorphism and glowing borders

- Clay: contrast, legibility, and performance are "the three failure points most teams discover after launch". Use the effect on supporting surfaces, not as a full-screen language. Source: https://clay.global/blog/glassmorphism-ui (from search snippet; page not fetched) **[unverified]**
- Web Designer Depot (opinion) on Apple's Liquid Glass: text over busy imagery can become "functionally invisible". Source: https://webdesignerdepot.com/how-liquid-design-broke-the-iphone-and-forced-apples-great-reset/ **[unverified]**
- Designer calling glassmorphism "dead": **[not found]**. Glassmorphism is still widely shipped. Critics attack legibility, not the trend itself.
- Glowing borders: **[not found]** as a named tell by a designer in my searches.

### 8. Centered dark hero with stats, gradient accent

- Anthropic skill: "a big number with a small label, supporting stats, and a gradient accent is the default treatment, so only use it if that's truly the best option." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- 925 Studios: "a hero section that could belong to any of ten thousand other products." Source: https://www.925studios.co/blog/ai-slop-design-tells
- Canatselis describes a "badge and vanity stats" hero with headline "Build the Future With AI Magic" (image caption). Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/

### 9. Dark mode and near-black backgrounds with one neon accent

- Anthropic skill flags "a near-black background with a single bright acid-green or vermilion accent" and "tinted near-black (#0B0B0B, #111) standing in for black" as defaults. Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- "Permanent dark mode as the default reflex": search snippet of 925 Studios, not in the fetched page. **[unverified]**
- Counterpoint: the same skill asks for "atmosphere and depth" rather than flat solid colors. Dark is not the tell. Dark by reflex, with one glowing accent, is.

### 10. Pill badges, eyebrow labels, vanity stats

- Anthropic skill: "Adding unnecessary typographic labels above content" is a listed tell. Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Canatselis: "badge and vanity stats" (see item 8).
- Pill badges as a named tell with a designer's fix: **[not found]**.

### 11. Generic copy that goes with the visuals

- Canatselis: "Scale without limits." "Your all-in-one platform." Fix: "Rewrite every line in a real person's voice." Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/
- 925 Studios: "Build faster. Ship smarter." says nothing about who the product is for. Source: https://www.925studios.co/blog/ai-slop-design-tells

### 12. Left-edge colored accent line on panels

- Canatselis: "That damn left-edge coloured line + curve on a panel!" No fix given. Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/

### 13. Motion: fade-up on every section, hover on every card

- Anthropic skill: "fade-and-slide-up entrances on each section and hover transitions on every card are the generic default". Fix: "A single orchestrated moment", and motion "that answers a person's action" is welcome. Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Canatselis: "Either nothing moves, or everything fades in with the same timing." Fix: "Delete anything that moves purely for decoration." Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/

### 14. Missing states, everything visible at once

- Canatselis: "AI nails the happy path every time." Fix: "Design the unhappy paths deliberately." Also "progressive disclosure" over showing "everything, all at once". Source: https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/

### 15. Shadcn, Tailwind, and the "same look"

- Critics say AI tools amplify one default kit. A feedback loop: AI generates shadcn code, that code ends up in training data, and the model gets better at it. Source: Northeast Times, 31 Jul 2026, https://northeasttimes.com/2026/07/31/ai-design-tools-are-making-every-website-look-the-same/ **[unverified, search snippet]**
- shadcn's default primary is neutral (oklch 0.205 in light mode), not purple. The sameness comes from the unfilled defaults. Source: Design Systems Collective, https://www.designsystemscollective.com/is-anyone-else-tired-of-every-tailwind-shadcn-app-looking-the-same-69c545e73114 **[unverified, snippet]**
- Fix: set your own design tokens (color, type, radius, spacing) before the first screen is generated. This is the advice in most sources above.

## Concrete rules for Malas Ngoding

Tags: (src) = backed by a source above. (inf) = my inference, not from a source.

1. Don't use the orange-pink gradient for accents or the logo. Use one accent hue, and tie each hue to one meaning (src, Canatselis "use colour semantically").
2. Don't use gradient text on stat numbers. Use solid color, size, and weight for hierarchy (src, Canatselis).
3. Don't use glass panels by default. Use solid surfaces with a 1px border. Add blur only where the map shows through, and check text contrast on it (src, Clay; inf for the exact ratio, aim for WCAG AA 4.5:1).
4. Don't add glowing borders on panels or the legend (src, Anthropic skill on glow-like accents as default; inf for the glow rule).
5. Don't use Inter plus nothing else. Pick one display face with character and one readable body face. Use tabular numerals for kWh and tCO2 values (src, Canatselis and 925 Studios; inf for tabular numerals).
6. Don't give every panel and card the same radius, shadow, and padding. Set radius by hierarchy: the main figure gets the most weight (src, Canatselis and Anthropic skill).
7. Don't use emoji as icons. Use no icon, or a small custom set drawn for energy and emissions (src, 925 Studios on generic icons; inf for emoji).
8. Don't open on a centered splash with a hero headline, badge, and stats. Open on the map, with the first sentence of the left panel stating a real East Kalimantan figure (src, 925 Studios and Anthropic skill; inf for the specific opening).
9. Don't add pill badges or eyebrow labels above titles. Put the year and the source as a plain line under the figure (src, Anthropic skill on unnecessary labels above content).
10. Don't show vanity numbers. Each number needs unit, year, and source, and must answer a question a user has (src, Anthropic skill on stats; inf for the unit/year/source rule).
11. Don't use a colored left-edge line on panels (src, Canatselis).
12. Don't fade every panel in with the same timing. Use one map fly-to on load, and hover or click states that show what changed (src, Anthropic skill and Canatselis).
13. Write copy about this region in plain words: named kabupaten, real numbers, the year. No "Power your future" lines (src, Canatselis and 925 Studios).
14. Design the no-data, loading, and error states for each region and year, not just the happy path (src, Canatselis).
15. Set your own color, type, radius, and spacing tokens before adding components. Don't keep the default kit untouched (src, Northeast Times and Design Systems Collective, both unverified snippets).

Also check: dark is fine for a map, but avoid a flat near-black with one neon accent as the default look (src, Anthropic skill). Test the choropleth palette on the dark Mapbox style for contrast and for color-blind viewers (inf).

## Sources

- https://www.925studios.co/blog/ai-slop-design-tells
- https://www.925studios.co/blog/ai-slop-web-design-guide (listed, not fetched)
- https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/
- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- https://dev.to/alanwest/why-every-ai-built-website-looks-the-same-blame-tailwinds-indigo-500-3h2p
- https://clay.global/blog/glassmorphism-ui (snippet only)
- https://webdesignerdepot.com/how-liquid-design-broke-the-iphone-and-forced-apples-great-reset/ (snippet only)
- https://northeasttimes.com/2026/07/31/ai-design-tools-are-making-every-website-look-the-same/ (snippet only)
- https://www.designsystemscollective.com/is-anyone-else-tired-of-every-tailwind-shadcn-app-looking-the-same-69c545e73114 (snippet only)
- https://uxdesign.cc/ai-design-isnt-ugly-it-s-fluent-and-that-s-the-problem-131b2f4eb78c (403, snippet only)
- https://superdesign.dev/blog/fix-generic-ai-landing-page (snippet only)
