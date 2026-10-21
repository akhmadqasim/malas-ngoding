import { afterEach, describe, expect, test } from "bun:test";
import { readSessionFlag } from "../../src/web/components/useSessionFlag.ts";

const g = globalThis as unknown as Record<string, unknown>;
const saved = g.sessionStorage;
afterEach(() => {
  g.sessionStorage = saved;
});

describe("a disclosure's state for the session", () => {
  test("a stored state wins over the default, both ways", () => {
    const store = new Map<string, string>([
      ["open", "1"],
      ["shut", "0"],
    ]);
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null };
    expect(readSessionFlag("open", false)).toBe(true);
    expect(readSessionFlag("shut", true)).toBe(false);
    expect(readSessionFlag("never-set", false)).toBe(false);
  });

  test("blocked storage falls back to the default", () => {
    g.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSessionFlag("open", true)).toBe(true);
  });
});
