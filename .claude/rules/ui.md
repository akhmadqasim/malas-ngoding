# UI components

- UI components come from HeroUI v3 (`@heroui/react`, styles from `@heroui/styles`). Read the docs before using a component: https://heroui.com/react/llms.txt. v3 differs from v2; do not rely on memory of v2.
- Component pages are `.mdx`, for example https://heroui.com/en/docs/react/components/switch.mdx. They list the props and the BEM classes (`.button`, `.button--ghost`, ...).
- Theming goes through the token bridge in `src/web/atlas-theme.css`: raw values live only in the theme block of `src/web/styles.css`, the bridge maps them onto HeroUI's variables (`--surface`, `--accent`, `--border`, `--field-*`, ...) per `data-theme` on `<html>` (`atlas-night`, `atlas-day`). Never style a HeroUI component with raw values or Tailwind arbitrary values; set its variables or BEM classes in the bridge. `tests/web/tokens.test.ts` enforces it.
- Visual rules: `docs/research/design/00-direction.md` (binding).
