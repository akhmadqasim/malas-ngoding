import { describe, expect, test } from "bun:test";
import { resolveRegion } from "../../src/shared/regionAlias.ts";

describe("resolveRegion", () => {
  test("aliases and prefixes", () => {
    expect(resolveRegion("Kab. Kukar")).toBe("kutai-kartanegara");
    expect(resolveRegion("Kota Samarinda")).toBe("samarinda");
    expect(resolveRegion("balikpapan")).toBe("balikpapan");
    expect(resolveRegion("Kabupaten Kutai Barat")).toBe("kutai-barat");
    expect(resolveRegion("PPU")).toBe("penajam-paser-utara");
    expect(resolveRegion("Mahulu")).toBe("mahakam-ulu");
    expect(resolveRegion("kutim")).toBe("kutai-timur");
    expect(resolveRegion("kubar")).toBe("kutai-barat");
    expect(resolveRegion("bpp")).toBe("balikpapan");
    expect(resolveRegion("smd")).toBe("samarinda");
    expect(resolveRegion("Bontang")).toBe("bontang");
    expect(resolveRegion("Berau")).toBe("berau");
    expect(resolveRegion("Paser")).toBe("paser");
  });
  test("unknown gives null", () => {
    expect(resolveRegion("jakarta")).toBeNull();
    expect(resolveRegion("")).toBeNull();
    expect(resolveRegion("Kota")).toBeNull();
  });
});

describe("resolveRegion against the seed", () => {
  test("every seeded region id resolves to itself, so the slug list in regionAlias.ts cannot drift", async () => {
    const seed = (await Bun.file("data/seed/regions.json").json()) as { id: string }[];
    expect(seed).toHaveLength(10);
    for (const { id } of seed) expect(resolveRegion(id)).toBe(id);
  });
});
