import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Enforces docs/research/design/00-direction.md rule 12: raw design values live only in the @theme block.

const WEB = "src/web";
const css = readFileSync(join(WEB, "styles.css"), "utf8");
/** Every other stylesheet of the app (the HeroUI theme bridge, the fonts) holds no @theme block at all. */
const otherCss = readdirSync(WEB)
  .filter((f) => f.endsWith(".css") && f !== "styles.css")
  .map((f) => readFileSync(join(WEB, f), "utf8"));

/** Splits styles.css into the `@theme static { ... }` block and everything else. */
function splitTheme(source: string): { theme: string; rest: string } {
  const start = source.indexOf("@theme static {");
  if (start < 0) return { theme: "", rest: source };
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return { theme: source.slice(start, i + 1), rest: source.slice(0, start) + source.slice(i + 1) };
  }
  throw new Error("unclosed @theme block");
}

const { theme, rest: stylesRest } = splitTheme(css);
const rest = [stylesRest, ...otherCss].join("\n");
const restLines = rest
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
  .split("\n")
  .map((text, i) => ({ line: i + 1, text }));

/** Lines of the non-theme CSS that match `bad`, for a readable failure. */
const offenders = (bad: RegExp) => restLines.filter((l) => bad.test(l.text)).map((l) => `${l.line}: ${l.text.trim()}`);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe("stylesheets use tokens only", () => {
  test("the HeroUI theme bridge exists and holds no @theme block", () => {
    expect(otherCss.some((c) => c.includes('[data-theme="atlas-night"]'))).toBe(true);
    expect(otherCss.every((c) => !c.includes("@theme"))).toBe(true);
  });
  test("there is a @theme static block with the colour, type and radius scales", () => {
    expect(theme).toContain("--color-ink");
    expect(theme).toContain("--text-base");
    expect(theme).toContain("--radius-md");
    expect(theme).toContain("--spacing: 4px");
  });
  test("no colour literals outside @theme", () => {
    expect(offenders(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color-mix)\(/i)).toEqual([]);
  });
  test("font sizes, radii and shadows come from tokens", () => {
    expect(offenders(/font-size:(?!\s*(var\(--text-|inherit))/)).toEqual([]);
    expect(offenders(/border-radius:(?!\s*(var\(--radius-|0;|inherit))/)).toEqual([]);
    expect(offenders(/box-shadow:(?!\s*(var\(--shadow-|none))/)).toEqual([]);
  });
  test("durations come from tokens", () => {
    expect(offenders(/(^|[\s:,(])\d*\.?\d+m?s\b/)).toEqual([]);
  });
  test("spacing uses the 4 px scale, not raw pixels", () => {
    expect(offenders(/\b(padding|margin|gap|row-gap|column-gap)[\w-]*:[^;]*\b\d+(\.\d+)?px/)).toEqual([]);
  });
  test("no glass, no glow", () => {
    expect(offenders(/backdrop-filter|text-shadow/)).toEqual([]);
  });
  test("gradients only on the legend ramp and the intro scrim", () => {
    const gradientRules = [...rest.matchAll(/([^{}]+)\{[^{}]*gradient\(/g)].map((m) => m[1]!.trim());
    expect(gradientRules.every((sel) => /gauge__ramp|intro__scrim/.test(sel))).toBe(true);
  });
});

describe("components use tokens only", () => {
  const forbidden = [
    /["'`(:\s]#[0-9a-f]{3,8}\b/i, // hex colour
    /\b(rgba?|hsla?)\(/, // rgb()/hsl() colour
    /\b[\w:-]+-\[[^\]]+\]/, // Tailwind arbitrary value such as p-[13px]
    /backdrop-?filter|textShadow|text-shadow/i, // glass and glow
  ];
  for (const file of sourceFiles(WEB)) {
    test(file.replaceAll("\\", "/"), () => {
      const lines = readFileSync(file, "utf8").split("\n");
      const hits = lines.flatMap((text, i) => (forbidden.some((re) => re.test(text)) ? [`${i + 1}: ${text.trim()}`] : []));
      expect(hits).toEqual([]);
    });
  }
});
