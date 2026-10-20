# Design tokens in Tailwind v4 for Malas Ngoding

Date: 2026-10-21. Source labels: **[docs]** = official page I read; **[snippet]** = search result only, not opened; **[not found]** = I could not confirm it.

## 1. How `@theme` works (Tailwind v4)

- **[docs]** Theme variables "influence which utility classes exist". Defining `--color-mint-500` gives `bg-mint-500`, `text-mint-500`, and `fill-mint-500`.
- **[docs]** "Tailwind also generates regular CSS variables for your theme variables so you can reference your design tokens in arbitrary values or inline styles." These land on `:root`.
- **[docs]** `--*: initial` inside `@theme` removes all default theme variables. `--color-*: initial` removes the default palette, so `bg-red-500` stops existing.
- **[docs]** Use `@theme inline` when a token points to a runtime variable. The utility then outputs `var(...)` and follows changes at runtime. The docs example is `@theme inline { --color-canvas: var(--acme-canvas-color); }` with a `[data-theme="dark"]` override.
- **[docs]** `@theme static` forces every variable into the build. The default is to emit only the variables that are used.
- **[docs]** In custom `@layer components` CSS, use `var(--text-base)`, `var(--color-gray-700)`, and `var(--font-weight-semibold)`.
- **[docs]** Font sizes can carry a line height: `--text-2xl--line-height` is the companion of `--text-2xl`.

## 2. Scales

- **Spacing:** one base variable, `--spacing`. Each `p-N` / `gap-N` is a multiple of it. **[docs]** the docs example uses `--spacing: 4px`. Keep to a 4px grid and avoid `p-[13px]`.
- **Type:** a small named set (`--text-*`), not raw sizes. Each step is a size plus a line height.
- **Radius:** a few named steps (`--radius-*`). **[snippet]** Radix Themes uses a 6-step radius scale; **[docs]** `var(--radius-1)` through `var(--radius-6)`, with a `radius` prop of none, small, medium, large, or full.
- **Colour:** two layers. Raw values (`--color-ink`, `--color-ember`) and semantic roles (`text-muted`, `border-line`, `bg-surface`). Components use only the semantic names.
- **Elevation:** 2 levels (`--shadow-glass`, `--shadow-pop`). Put glows in a named token too (`--shadow-glow`).

## 3. How the four systems structure tokens

- **Radix Themes** [docs for radius; snippet for accent]: each colour is a 12-step scale (`--accent-1` to `--accent-12`), plus functional variables such as `--accent-surface` and `--accent-contrast`. A gray is paired with each accent. Layout values such as radius are their own scale. Structure: scale, then role.
- **GitHub Primer** [docs]: three tiers.
  - Base: "the lowest level tokens and map directly to a raw value", e.g. `base-size-4`, `base-fontWeight-semibold`.
  - Functional: "represent global UI patterns", e.g. `bgColor-inset`, `borderColor-default`, `boxShadow-inset-thick`. These are the names components should use.
  - Component/pattern: "should only be used in component CSS", e.g. `button-primary-bgColor-hover`.
- **Vercel Geist** [snippet]: an official `vercel.com/design.md` file lists a gray scale (100 to 1000), alpha variants, and a blue scale. I did not open it. **[not found]** official CSS variable names. Third-party "Vercel-inspired" files are reconstructions; ignore their counts.
- **IBM Carbon** [snippet from carbondesignsystem.com]: tokens use a `$` prefix (e.g. `$layer-01`), can reference other tokens, and are grouped as color, spacing, typography, and global. Depth comes mainly from background layers, not shadows (third-party summary). **[not found]** elevation tokens in official docs. Values live in the `@carbon/themes` package.

Common pattern across all four: raw values at the bottom, semantic names for use in components, and a rule that components never reach past the semantic layer.

## 4. Enforcing "only use tokens"

- **Remove the defaults first.** With `--color-*: initial` and `--spacing` the only spacing source, a stray `bg-blue-500` produces no CSS. Missing styles show up in the browser fast.
- **ESLint:** `eslint-plugin-better-tailwindcss` lists `no-unknown-classes` and `no-restricted-classes` [docs page read]. I did not confirm its option syntax for banning `[...]` values. Check the rule page before relying on it.
- **Biome:** `noTailwindArbitraryValue` exists [snippet]. Not opened.
- **Zero-dependency fallback (reliable):** a CI grep that fails on square-bracket values and raw colours in components. Example: `rg -n "\[(#|\d|rgb|oklch)|rgba?\(|#[0-9a-fA-F]{3,8}" src/web --glob "*.tsx"`. Allow `src/web/theme.css` and the Mapbox style file in an explicit list.
- **Not found:** a built-in Tailwind v4 switch that forbids arbitrary values.

## 5. What the current code shows

`src/web/styles.css` is plain CSS, not utilities. It already has good variables (`--ink`, `--accent`, `--line`), but:

- About 14 fixed font sizes (10.5px to 40px) plus two `clamp()` sizes.
- Radius literals (6, 9, 12, 14, 20, 22, 99px) next to the `--radius-*` variables.
- `rgba(255, 255, 255, 0.06)`-style literals repeated across the file.
- Several effects stacked on the same panels: glass blur, inset highlight, outer shadow, gradient fills, and glow.
- Gradient text on the intro title, a glow on the hero number, and a glowing brand mark.

My read, not sourced: the "AI-ish" feel comes from many near-identical sizes and from effects used everywhere, not from the palette. Fewer steps and fewer effects fix most of it.

## 6. Concrete rules for Malas Ngoding

1. Type: 7 steps only (xs 11, sm 13, base 14, lg 17, xl 22, 2xl 28, display 40). No other `font-size`.
2. Spacing: 4px grid through `--spacing`. No arbitrary `px` in JSX or CSS.
3. Radius: `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill`. Nothing else.
4. Colour: components use `bg-ink`, `bg-glass`, `border-line`, `text-text`, `text-text-muted`, `text-accent`. Raw hex or `rgba()` only inside the token block.
5. Accent: only through `--color-accent`, which follows `[data-metric]`. Never write `ember` or `arus` into components.
6. Elevation: `shadow-glass` for panels, `shadow-pop` for tooltips and popups. `shadow-glow` only on the one active element.
7. One decorative effect per surface. A panel does not get gradient, glow, and blur together.
8. Enforce with the CI grep above. Add ESLint `no-unknown-classes` if the team wants editor feedback.
9. Migrate in order: move values into `@theme`, replace literals one block at a time, then compare screenshots before and after.

### Ready-to-adapt `@theme` block

```css
@import "tailwindcss";

@theme {
  --color-*: initial; /* drop the default palette so only these colours exist */

  --color-ink: #0d1524; /* page canvas */
  --color-ink-raised: #142038; /* raised surface */
  --color-glass: rgb(12 20 36 / 0.66);
  --color-glass-strong: rgb(12 20 36 / 0.82);
  --color-line: rgb(170 200 240 / 0.14);
  --color-line-strong: rgb(170 200 240 / 0.26);
  --color-text: #eaf0f7;
  --color-text-muted: #93a3b8;
  --color-text-faint: #66768c;
  --color-ember: #ff6a3d;
  --color-ember-soft: #ffc65c;
  --color-arus: #3fd6e0;
  --color-arus-soft: #c8fbff;
  --color-surya: #ffd23f;
  --color-warning: #ffd38a;
  --color-on-accent: #10131c;

  --font-sans: "Plus Jakarta Sans Variable", "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;

  --spacing: 4px;

  --text-xs: 0.6875rem;   /* 11px */
  --text-xs--line-height: 1.5;
  --text-sm: 0.8125rem;   /* 13px */
  --text-sm--line-height: 1.5;
  --text-base: 0.875rem;  /* 14px */
  --text-base--line-height: 1.5;
  --text-lg: 1.0625rem;   /* 17px */
  --text-lg--line-height: 1.3;
  --text-xl: 1.375rem;    /* 22px */
  --text-xl--line-height: 1.2;
  --text-2xl: 1.75rem;    /* 28px */
  --text-2xl--line-height: 1.1;
  --text-display: 2.5rem; /* 40px */
  --text-display--line-height: 1;

  --radius-sm: 9px;
  --radius-md: 14px;
  --radius-lg: 22px;
  --radius-pill: 999px;

  --shadow-glass: 0 1px 0 rgb(255 255 255 / 0.05) inset, 0 24px 60px -28px rgb(0 0 0 / 0.7);
  --shadow-pop: 0 18px 40px -18px rgb(0 0 0 / 0.8);

  --blur-glass: 18px;
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
}

/* Runtime tokens: resolve to var() so they follow [data-metric]. */
@theme inline {
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --shadow-glow: 0 0 24px -4px var(--accent);
}

:root {
  --accent: var(--ember);
  --accent-soft: var(--ember-soft);
}

[data-metric="kwh"] {
  --accent: var(--arus);
  --accent-soft: var(--arus-soft);
}
```

Caveats: the `--radius-lg` / `--radius-md` / `--radius-sm` names already exist in `styles.css` with different values. Remove the old `:root` copies when you move them into `@theme`. The `--blur-glass` name is my choice and is not checked against the blur namespace docs. Verify the generated utility names in the built CSS.

Sources:
- Tailwind v4 theme docs (via Context7 `/tailwindlabs/tailwindcss.com`, file `src/docs/theme.mdx` and `src/docs/colors.mdx`): https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/docs/theme.mdx
- Primer token names: https://primer.style/product/primitives/token-names/
- Radix Themes radius: https://www.radix-ui.com/themes/docs/theme/radius
- Radix Themes colour (snippet): https://radix-ui.com/themes/docs/theme/color
- Vercel Geist (snippet): https://vercel.com/design.md
- IBM Carbon tokens (snippet): https://carbondesignsystem.com/elements/themes/overview/
- eslint-plugin-better-tailwindcss: https://github.com/schoero/eslint-plugin-better-tailwindcss
- Biome noTailwindArbitraryValue (snippet): https://biomejs.dev/linter/rules/no-tailwind-arbitrary-value/
