# Human craft vs templated UI: research notes

Date: 2026-10-21. Scope: techniques that make a web UI look designed by a person, not generated from a Tailwind/shadcn/v0 template.

Sourcing rule: quotes are from fetched pages. Items marked **not found** could not be verified from a primary source, so treat them as my judgment, not as sourced fact.

## What the templated look is

Anthropic's `frontend-design` skill describes the default AI look and says these are defaults, not choices:

> "For calibration, AI-generated design right now clusters around some traits:"

Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md (fetched via summary; the exact trait list was cut off, so I quote only what I read).

The same skill names the "SaaS-card kit" as a tell: "content chopped into identical rounded cards, one border-radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each, and gradient washes as decoration." Source: same URL.

Third-party write-ups (unverified, practitioner opinion): purple gradients, Inter, three icon boxes, centred hero, three feature cards. Sources: https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website and https://maven.com/p/af8a3f (course marketing, treat as opinion).

## 1. Restraint: fewer colours, fewer containers

- Refactoring UI: "Not all elements are equal" and "Labels are a last resort" are chapter headings on hierarchy. Source: https://refactoringui.com/
- Linear's redesign: the team says they changed the sidebar, tabs, headers and panels "to reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements." They also limited "how much chrome (blue in our case) was used in the calculations applied to our color system." Source: https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear derives the whole theme from few inputs: "instead of having to define 98 specific variables for each theme, we defined three." Source: same URL.
- Anthropic skill: "Let one element be the memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

## 2. Hairline borders vs drop shadows

- Refactoring UI on borders: "using too many of them can make your design feel busy and cluttered." Instead, "try adding a box shadow, using contrasting background colors, or simply adding more space between elements." Source: https://refactoringui.com/ (chapter "Finishing Touches" and "Creating Depth").
- Josh Comeau on shadows: "The web is covered in fuzzy grey boxes that don't really look much like shadows." And: "By layering multiple shadows, we create a bit of the subtlety present in real-life shadows." Source: https://www.joshwcomeau.com/css/designing-shadows
- Comeau on colour: "When we layer black over our background color, it doesn't just make it darker; it also desaturates it quite a bit." Fix: "By matching the hue and lowering the saturation/lightness, we can create an authentic shadow." Source: same URL.
- Practical reading: use one hairline (1px, low-contrast) where a boundary is needed. Use tinted, layered shadows only for real elevation (menus, dialogs). Do not put the same grey shadow on every card.

## 3. Flat surfaces vs glass blur

- Not found: a named designer's rule on glass vs flat. I found no primary source I could verify.
- Anthropic skill (applies to the templated look): gradient washes as decoration are a listed tell. Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Judgment: glass panels stacked on a dark 3D map add a second depth layer that competes with the map. Keep one surface treatment across the app.

## 4. Strict grid and alignment

- Linear: "aligning labels, icons, and buttons, both vertically and horizontally in the sidebar and tabs." Source: https://linear.app/now/how-we-redesigned-the-linear-ui
- Refactoring UI, "Layout and Spacing" chapter: establish a spacing and sizing system and avoid ambiguous spacing. Source: https://refactoringui.com/
- Judgment: pick one spacing scale and use it for every gap. Align edges of panels to the same few x-positions.

## 5. Asymmetry

- Not found: a named-designer source on asymmetry specifically.
- Anthropic skill: "Spend your boldness in one place." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

## 6. Real content hierarchy

- Refactoring UI: "Size isn't everything"; "De-emphasize to emphasize." Source: https://refactoringui.com/
- Anthropic skill on the hero: "a big number with a small label, supporting stats, and a gradient accent is the default treatment, so only use it if that's truly the best option." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Judgment: a stats panel where every number has the same size and weight is a flat list, not a hierarchy. Rank the one number the user needs first.

## 7. Icon set choice and consistency

- Lucide: "Designed with a strict set of design rules for consistency in style and readability." Released under ISC. Source: https://lucide.dev/
- Rule: use one icon family for the whole app. Mixing filled and outline icons, or icons from two libraries, is the usual tell. The Lucide page does not give a grid size, so I did not state one.

## 8. Microcopy

- Anthropic skill: avoid "adding unnecessary typographic labels above content" and "all caps for labels." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Refactoring UI: "Labels are a last resort." Source: https://refactoringui.com/
- Not found: a named-designer microcopy guide I could verify.

## 9. Density

- Linear's redesign explicitly raises "density of navigation elements" as a goal (see section 1). Source: https://linear.app/now/how-we-redesigned-the-linear-ui
- Refactoring UI has no density chapter; its "Layout and Spacing" chapter is the closest match. Source: https://refactoringui.com/

## 10. One signature detail

- Anthropic skill: "A single orchestrated moment — one page-load sequence or one reveal — lands better than scattered effects; fade-and-slide-up entrances on each section and hover transitions on every card are the generic default and read as AI-generated." Source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Rauno Freiberg, "Invisible Details of Interaction Design": "Analyzing and making sense of design details beyond just 'it feels nice' helps nurture taste, amplify level of execution, and grow appreciation for how hard the pursuit of excellence is." He also writes that "Sometimes we can get away with not animating mouse or keyboard interactions, without it feeling jarring." Source: https://rauno.me/craft/interaction-design
- Restraint on motion, per the same essay: "I removed motion from core interactions and suddenly felt like I was moving much faster." Source: same URL.

## Not verified

- Rauno's concentric border radius post: the page returned HTTP 500 and a search did not find it. The formula (outer radius = inner radius + padding) comes from third-party pages only: https://jakub.kr/work/concentric-border-radius
- Brian Lovin and Paco Coursey: no article found in search. Not verified.
- Refactoring UI shadow chapter body text: only chapter titles were visible on the fetched page.

## Concrete rules for Malas Ngoding

- Pick one background tone for the panels and one accent colour. Remove the gradient accents.
- Remove the glass blur from the stats panel and the legend bar. Use a solid surface with a 1px low-contrast hairline.
- Use one border radius for the app, and nest inner radii to match outer ones.
- Use shadows only for floating layers (popups, the legend when it overlays the map). Tint them to the surface hue.
- Put the stats panel on one grid: same left edge, same padding, same spacing scale for every block.
- Give the headline number a clear size and weight. Make the other numbers smaller and quieter.
- Drop the labels above each section. Let the value speak, and keep the unit beside it.
- Use one icon family only. Match stroke width and size everywhere.
- Limit the palette to the map colours plus one accent. Count the colours on screen and cut any that do not carry meaning.
- Keep density high in the stats panel, but keep the map area empty.
- Add one signature detail (one entrance animation or one map transition) and remove every other decorative effect.
- Write short, specific labels. Replace vague text such as "Overview" with the actual metric name and time range.
- Check the result against a blank screenshot: if you cannot find the main number in two seconds, the hierarchy is wrong.

Sources:
- https://refactoringui.com/
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://www.joshwcomeau.com/css/designing-shadows
- https://rauno.me/craft/interaction-design
- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- https://lucide.dev/
