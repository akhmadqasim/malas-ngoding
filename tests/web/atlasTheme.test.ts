import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The HeroUI theme bridge (src/web/atlas-theme.css): both atlas themes must set the same variables, and
// every token they point at must exist in the theme block of styles.css.

const bridge = readFileSync("src/web/atlas-theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const styles = readFileSync("src/web/styles.css", "utf8");

/** The variables declared inside the rule whose selector is exactly `selector`. */
function declared(selector: string): Set<string> {
  // Skip the shared rule (both selectors, comma-separated): the selector must open its own rule.
  let start = bridge.indexOf(`${selector} {`);
  while (start >= 0 && bridge.slice(0, start).trimEnd().endsWith(",")) start = bridge.indexOf(`${selector} {`, start + 1);
  if (start < 0) return new Set();
  const body = bridge.slice(bridge.indexOf("{", start) + 1, bridge.indexOf("}", start));
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
}

const night = declared('[data-theme="atlas-night"]');
const day = declared('[data-theme="atlas-day"]');

describe("HeroUI theme bridge", () => {
  test("both themes set the same variables, so a component never falls back to a HeroUI default", () => {
    expect(night.size).toBeGreaterThan(20);
    expect([...day].sort()).toEqual([...night].sort());
  });

  test("the bridge covers the variables HeroUI's components read", () => {
    for (const v of ["--background", "--foreground", "--surface", "--overlay", "--muted", "--default", "--accent", "--accent-foreground", "--border", "--separator", "--focus", "--field-background", "--field-border", "--surface-shadow", "--overlay-shadow"]) {
      expect(night.has(v)).toBe(true);
    }
  });

  test("every design token the bridge points at exists", () => {
    const used = new Set([...bridge.matchAll(/var\((--(?:color|shadow|radius|duration)-[\w-]+)\)/g)].map((m) => m[1]!));
    const missing = [...used].filter((t) => !new RegExp(`${t}:`).test(styles));
    expect(missing).toEqual([]);
  });

  test("the page starts in a bridge theme", () => {
    expect(readFileSync("src/web/index.html", "utf8")).toContain('data-theme="atlas-night"');
  });
});
