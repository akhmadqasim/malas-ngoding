import { describe, expect, test } from "bun:test";

describe("docker-compose.yml", () => {
  test("publishes Postgres on the loopback address only", async () => {
    const text = await Bun.file("docker-compose.yml").text();
    expect(text).toContain('"127.0.0.1:5433:5432"');
    expect(text).not.toMatch(/"5433:5432"/);
  });
});

describe("package.json", () => {
  test("bun start runs in production mode", async () => {
    const pkg = (await Bun.file("package.json").json()) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toContain("NODE_ENV=production");
    expect(pkg.scripts.dev).not.toContain("NODE_ENV=production");
  });
});
