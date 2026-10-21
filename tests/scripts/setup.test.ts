import { describe, expect, test } from "bun:test";
import { mapboxTokenProblem, runSetup, type SetupDeps } from "../../scripts/setup.ts";

/** Deps that record every call, so a test can check the order and what was skipped. */
function fakeDeps(over: Partial<SetupDeps> = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  const deps: SetupDeps = {
    ping: async () => {
      calls.push("ping");
    },
    migrate: async () => {
      calls.push("migrate");
      return ["001_init.sql"];
    },
    seed: async () => {
      calls.push("seed");
      return { regions: 10, power_plants: 13, grid_mix: 7, building_types: 12, equivalents: 5 };
    },
    warmScript: async () => "/repo/scripts/warm.ts",
    runWarm: async () => {
      calls.push("warm");
      return 0;
    },
    close: async () => {
      calls.push("close");
    },
    log: (line) => out.push(line),
    error: (line) => out.push(line),
    target: "localhost:5433",
    port: 3000,
    mapboxToken: "pk.test-token",
    ...over,
  };
  return { deps, calls, out, text: () => out.join("\n") };
}

const FAST = { dbWaitMs: 40, dbRetryMs: 5 };

describe("runSetup", () => {
  test("runs migrate, seed and warm in that order and exits 0", async () => {
    const t = fakeDeps();
    expect(await runSetup(t.deps, FAST)).toBe(0);
    expect(t.calls).toEqual(["ping", "migrate", "seed", "close", "warm"]);
    expect(t.text()).toContain("[1/3] Migrasi");
    expect(t.text()).toContain("[2/3]");
    expect(t.text()).toContain("[3/3]");
    expect(t.text()).toContain("001_init.sql");
    expect(t.text()).toContain("10 wilayah");
    expect(t.text()).toContain("13 pembangkit");
    expect(t.text()).toContain("bun dev");
    expect(t.text()).toContain("http://localhost:3000");
  });

  test("says when the schema is already up to date", async () => {
    const t = fakeDeps({ migrate: async () => [] });
    expect(await runSetup(t.deps, FAST)).toBe(0);
    expect(t.text()).toContain("sudah terbaru");
  });

  test("skips warm with a clear note when scripts/warm.ts does not exist", async () => {
    const t = fakeDeps({ warmScript: async () => null });
    expect(await runSetup(t.deps, FAST)).toBe(0);
    expect(t.calls).not.toContain("warm");
    expect(t.text()).toContain("scripts/warm.ts belum ada");
    expect(t.text()).toContain("dilewati");
  });

  test("waits for a database that is still starting", async () => {
    let attempts = 0;
    const t = fakeDeps({
      ping: async () => {
        attempts++;
        if (attempts < 3) throw new Error("connection refused");
      },
    });
    expect(await runSetup(t.deps, FAST)).toBe(0);
    expect(attempts).toBe(3);
    expect(t.text().match(/belum menjawab/g)).toHaveLength(1);
    expect(t.calls).toContain("migrate");
  });

  test("a database that never answers stops the setup and points to docker compose", async () => {
    const t = fakeDeps({
      ping: async () => {
        throw new Error("connection refused");
      },
    });
    expect(await runSetup(t.deps, FAST)).toBe(1);
    expect(t.calls).not.toContain("migrate");
    expect(t.calls).not.toContain("seed");
    expect(t.calls).not.toContain("warm");
    expect(t.calls).toContain("close");
    expect(t.text()).toContain("localhost:5433");
    expect(t.text()).toContain("docker compose up -d");
    expect(t.text()).toContain("connection refused");
  });

  test("a failing migration stops the setup before seed and warm", async () => {
    const t = fakeDeps({
      migrate: async () => {
        throw new Error('syntax error at or near "CREATE"');
      },
    });
    expect(await runSetup(t.deps, FAST)).toBe(1);
    expect(t.calls).not.toContain("seed");
    expect(t.calls).not.toContain("warm");
    expect(t.calls).toContain("close");
    expect(t.text()).toContain("migrasi");
    expect(t.text()).toContain("syntax error");
  });

  test("a failing seed stops the setup before warm", async () => {
    const t = fakeDeps({
      seed: async () => {
        throw new Error("no boundary for region paser");
      },
    });
    expect(await runSetup(t.deps, FAST)).toBe(1);
    expect(t.calls).not.toContain("warm");
    expect(t.calls).toContain("close");
    expect(t.text()).toContain("seed");
    expect(t.text()).toContain("no boundary for region paser");
  });

  test("a failing warm exits non-zero but says the app can still start", async () => {
    const t = fakeDeps({
      runWarm: async () => {
        t.calls.push("warm");
        return 3;
      },
    });
    expect(await runSetup(t.deps, FAST)).toBe(1);
    expect(t.text()).toContain("kode keluar 3");
    expect(t.text()).toContain("bun dev");
    expect(t.text()).toContain("bun run warm");
  });

  test("warns when the Mapbox token is missing, but still succeeds", async () => {
    const t = fakeDeps({ mapboxToken: "" });
    expect(await runSetup(t.deps, FAST)).toBe(0);
    expect(t.text()).toContain("MAPBOX_TOKEN");
  });

  test("never prints the token or the connection string", async () => {
    const t = fakeDeps({ mapboxToken: "pk.secret-value-123" });
    await runSetup(t.deps, FAST);
    expect(t.text()).not.toContain("secret-value-123");
    expect(t.text()).not.toContain("postgres://");
  });
});

describe("mapboxTokenProblem", () => {
  test("accepts a public token", () => {
    expect(mapboxTokenProblem("pk.eyJ1IjoiYSJ9.abc")).toBeNull();
  });

  test("flags an empty token and the .env.example placeholder", () => {
    expect(mapboxTokenProblem("")).toContain("belum diisi");
    expect(mapboxTokenProblem("pk.your-public-token")).toContain("belum diisi");
  });

  test("flags a secret token, which would be sent to every browser", () => {
    const message = mapboxTokenProblem("sk.eyJ1IjoiYSJ9.abc");
    expect(message).toContain("pk.");
    expect(message).toContain("browser");
  });
});
