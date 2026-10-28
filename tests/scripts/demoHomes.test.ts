import { describe, expect, test } from "bun:test";
import {
  CITIES,
  buildQuery,
  footprintOf,
  homeRecord,
  mulberry32,
  polygonAreaM2,
  polygonCentroid,
  sampleSpread,
  type Footprint,
  type OsmWay,
} from "../../scripts/build-demo-homes";

const M = 1 / 111_195; // degrees of arc per metre near the equator

/** A closed square way of `side` metres whose south-west corner is at (lat0, lon0). */
function square(id: number, side: number, building = "house", lat0 = 0, lon0 = 117): OsmWay {
  const d = side * M;
  const ring = [
    { lat: lat0, lon: lon0 },
    { lat: lat0, lon: lon0 + d },
    { lat: lat0 + d, lon: lon0 + d },
    { lat: lat0 + d, lon: lon0 },
    { lat: lat0, lon: lon0 },
  ];
  return { type: "way", id, tags: { building }, geometry: ring };
}

describe("polygonAreaM2", () => {
  test("a 10 x 10 m square near the equator is about 100 m2", () => {
    const ring = square(1, 10).geometry!.slice(0, -1);
    expect(polygonAreaM2(ring)).toBeCloseTo(100, 0);
  });

  test("a 12 x 5 m rectangle is 60 m2, whichever way it winds", () => {
    const ring = [
      { lat: 0, lon: 117 },
      { lat: 0, lon: 117 + 12 * M },
      { lat: 5 * M, lon: 117 + 12 * M },
      { lat: 5 * M, lon: 117 },
    ];
    expect(polygonAreaM2(ring)).toBeCloseTo(60, 0);
    expect(polygonAreaM2([...ring].reverse())).toBeCloseTo(60, 0);
  });

  test("an L shape (20 x 10 m minus a 10 x 5 m corner) is 150 m2; fewer than 3 points is 0", () => {
    const pts = [[0, 0], [20, 0], [20, 5], [10, 5], [10, 10], [0, 10]].map(([x, y]) => ({ lon: 117 + x! * M, lat: y! * M }));
    expect(polygonAreaM2(pts)).toBeCloseTo(150, 0);
    expect(polygonAreaM2(pts.slice(0, 2))).toBe(0);
  });

  test("stays about right at 1 degree south", () => {
    const ring = square(1, 10, "house", -1, 116.8).geometry!.slice(0, -1);
    expect(polygonAreaM2(ring)).toBeCloseTo(100, 0);
  });
});

describe("polygonCentroid", () => {
  test("is the middle of a square", () => {
    const w = square(1, 20, "house", -0.5, 117.1);
    const [lng, lat] = polygonCentroid(w.geometry!.slice(0, -1));
    expect(lng).toBeCloseTo(117.1 + 10 * M, 7);
    expect(lat).toBeCloseTo(-0.5 + 10 * M, 7);
  });
});

describe("footprintOf", () => {
  test("keeps a residential closed way and names it way/<id>", () => {
    const f = footprintOf(square(123, 10));
    expect(f?.osmId).toBe("way/123");
    expect(f?.areaM2).toBeCloseTo(100, 0);
  });

  test("accepts every residential-looking building tag", () => {
    for (const b of ["house", "residential", "detached", "semidetached_house", "terrace", "yes"]) {
      expect(footprintOf(square(1, 10, b))).not.toBeNull();
    }
  });

  test("drops other building kinds and ways without a tag", () => {
    expect(footprintOf(square(1, 10, "commercial"))).toBeNull();
    expect(footprintOf(square(1, 10, "school"))).toBeNull();
    expect(footprintOf({ ...square(1, 10), tags: {} })).toBeNull();
  });

  test("keeps 40 to 250 m2 only", () => {
    expect(footprintOf(square(1, 6))).toBeNull(); // 36 m2
    expect(footprintOf(square(1, 7))).not.toBeNull(); // 49 m2
    expect(footprintOf(square(1, 15))).not.toBeNull(); // 225 m2
    expect(footprintOf(square(1, 16))).toBeNull(); // 256 m2
  });

  test("drops open ways and ways with fewer than 4 points", () => {
    const w = square(1, 10);
    expect(footprintOf({ ...w, geometry: w.geometry!.slice(0, -1) })).toBeNull(); // not closed
    expect(footprintOf({ ...w, geometry: w.geometry!.slice(0, 3) })).toBeNull();
    expect(footprintOf({ ...w, geometry: undefined })).toBeNull();
  });
});

describe("mulberry32", () => {
  test("the same seed gives the same sequence in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(xs[0]!);
  });
});

describe("sampleSpread", () => {
  const box = { south: 0, west: 117, north: 0.04, east: 117.04 };
  const items: Footprint[] = Array.from({ length: 400 }, (_, i) => ({
    osmId: `way/${1000 + i}`,
    lng: 117 + ((i % 20) + 0.5) * 0.002,
    lat: Math.floor(i / 20) * 0.002 + 0.001,
    areaM2: 100,
  }));

  test("the same seed gives the same picks, in any input order", () => {
    const a = sampleSpread(items, 50, box, 7);
    const b = sampleSpread([...items].reverse(), 50, box, 7);
    expect(a.map((f) => f.osmId)).toEqual(b.map((f) => f.osmId));
    expect(sampleSpread(items, 50, box, 8).map((f) => f.osmId)).not.toEqual(a.map((f) => f.osmId));
  });

  test("picks the target without duplicates, or all there is", () => {
    const a = sampleSpread(items, 50, box, 7);
    expect(a).toHaveLength(50);
    expect(new Set(a.map((f) => f.osmId)).size).toBe(50);
    expect(sampleSpread(items.slice(0, 5), 50, box, 7)).toHaveLength(5);
    expect(sampleSpread([], 50, box, 7)).toEqual([]);
  });

  test("spreads the picks over the box instead of one corner", () => {
    const picked = sampleSpread(items, 36, box, 7, 6);
    const cells = new Set(picked.map((f) => `${Math.floor(((f.lng - 117) / 0.04) * 6)},${Math.floor((f.lat / 0.04) * 6)}`));
    expect(cells.size).toBe(36);
  });
});

describe("homeRecord", () => {
  const f: Footprint = { osmId: "way/55", lng: 117.1234567891, lat: -0.5, areaM2: 87.654 };

  test("is deterministic", () => {
    expect(homeRecord(f, "Samarinda")).toEqual(homeRecord(f, "Samarinda"));
  });

  test("rounds, labels the city and keeps floors and kWh plausible", () => {
    const h = homeRecord(f, "Samarinda");
    expect(h.footprintM2).toBe(87.7);
    expect(h.city).toBe("Samarinda");
    expect(h.lng).toBe(117.1234568);
    for (let i = 0; i < 300; i++) {
      const r = homeRecord({ ...f, osmId: `way/${i}`, areaM2: 40 + (i % 210) }, "X");
      expect(r.floors).toBeGreaterThanOrEqual(r.buildingType === "ruko" ? 2 : 1);
      expect(r.floors).toBeLessThanOrEqual(r.buildingType === "ruko" ? 3 : 2);
      if (r.kwhMonth !== null) {
        expect(Number.isInteger(r.kwhMonth)).toBe(true);
        expect(r.kwhMonth).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test("the shares are close to the targets over many homes", () => {
    const n = 4000;
    const hs = Array.from({ length: n }, (_, i) => homeRecord({ ...f, osmId: `way/${i}`, areaM2: 120 }, "X"));
    const share = (p: (h: (typeof hs)[number]) => boolean) => hs.filter(p).length / n;
    expect(share((h) => h.kwhMonth !== null)).toBeGreaterThan(0.55);
    expect(share((h) => h.kwhMonth !== null)).toBeLessThan(0.65);
    expect(share((h) => h.consentMap)).toBeGreaterThan(0.8);
    expect(share((h) => h.consentMap)).toBeLessThan(0.9);
    expect(share((h) => h.buildingType === "ruko")).toBeGreaterThan(0.12);
    expect(share((h) => h.buildingType === "ruko")).toBeLessThan(0.18);
    expect(share((h) => h.interestedPv)).toBeGreaterThan(0.3);
    expect(share((h) => h.interestedPv)).toBeLessThan(0.5);
  });
});

describe("queries and cities", () => {
  test("the query asks Overpass for building ways in the box (south, west, north, east) with geometry", () => {
    expect(buildQuery({ south: -0.52, west: 117.13, north: -0.48, east: 117.17 })).toBe(
      '[out:json][timeout:90];way["building"](-0.52,117.13,-0.48,117.17);out geom;',
    );
  });

  test("the five cities sum to 300 homes and have boxes of 3 to 5 km", () => {
    expect(CITIES.reduce((s, c) => s + c.target, 0)).toBe(300);
    for (const c of CITIES) {
      const km = (c.box.east - c.box.west) * 111.195;
      expect(km).toBeGreaterThan(3);
      expect(km).toBeLessThan(5);
    }
  });
});

describe("data/seed/demo-homes.json", () => {
  test("has a source with the licence and homes with unique OSM ids", async () => {
    const seed = (await Bun.file("data/seed/demo-homes.json").json()) as { source: string; homes: { osmId: string }[] };
    expect(seed.source).toContain("ODbL");
    expect(seed.homes.length).toBeGreaterThan(0);
    expect(new Set(seed.homes.map((h) => h.osmId)).size).toBe(seed.homes.length);
    expect(seed.homes.every((h) => /^way\/\d+$/.test(h.osmId))).toBe(true);
  });
});
