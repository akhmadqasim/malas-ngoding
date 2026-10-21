import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The chat's stylesheet follows the same rule as styles.css (00-direction rule 12): tokens only.

const lines = readFileSync("src/web/chat/chat.css", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
  .split("\n")
  .map((text, i) => ({ line: i + 1, text }));
const offenders = (bad: RegExp) => lines.filter((l) => bad.test(l.text)).map((l) => `${l.line}: ${l.text.trim()}`);

describe("chat.css uses tokens only", () => {
  test("no colour literals", () => {
    expect(offenders(/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color-mix)\(/i)).toEqual([]);
  });
  test("font sizes, radii and shadows come from tokens", () => {
    expect(offenders(/font-size:(?!\s*(var\(--text-|inherit))/)).toEqual([]);
    expect(offenders(/border-radius:(?!\s*(var\(--radius-|0;|inherit))/)).toEqual([]);
    expect(offenders(/box-shadow:(?!\s*(var\(--(shadow-|surface-shadow|overlay-shadow)|none))/)).toEqual([]);
  });
  test("no raw durations, no pixel spacing, no glass, glow or gradients", () => {
    expect(offenders(/(^|[\s:,(])\d*\.?\d+m?s\b/)).toEqual([]);
    // Hairline borders (1px) and @media breakpoints are fine; sizes and spacing go through --spacing.
    const sizes = /^\s*(padding|margin|gap|row-gap|column-gap|top|right|bottom|left|width|height|min-height|max-height)[\w-]*:[^;]*\b\d+(\.\d+)?px/;
    expect(offenders(sizes)).toEqual([]);
    expect(offenders(/backdrop-filter|text-shadow|gradient\(/)).toEqual([]);
  });
});
