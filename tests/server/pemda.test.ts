import { afterAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { HomeInput, PemdaHomes, PemdaSummary } from "../../src/shared/auth.ts";
import { type FakeDeps, fakeDeps } from "./fakes.ts";

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps();
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const get = (s: Server<undefined>, path: string, cookie?: string) =>
  fetch(new URL(path, s.url), { headers: cookie ? { cookie } : {} });

const HOME: HomeInput = {
  featureId: "b",
  lng: 117.15,
  lat: -0.5,
  footprintM2: 120,
  heightM: null,
  buildingType: "rumah",
  floors: 1,
  kwhMonth: 200,
  billRpMonth: null,
  interestedPv: false,
  consentMap: false,
};

/** A resident with a saved home, through the real PUT route. */
async function resident(s: { server: Server<undefined>; fake: FakeDeps }, patch: Partial<HomeInput>, who: { name: string; email: string }) {
  const { cookie } = await s.fake.signIn("warga", who);
  const res = await fetch(new URL("/api/me/home", s.server.url), {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...HOME, ...patch }),
  });
  expect(res.status).toBe(200);
}

describe("government routes need a government account", () => {
  test.each(["/api/pemda/summary", "/api/pemda/homes"])("%s: 401 signed out, 403 for a resident, 200 for pemda", async (path) => {
    const { server, fake } = start();
    const guest = await get(server, path);
    expect(guest.status).toBe(401);
    expect(((await guest.json()) as { error: string }).error.length).toBeGreaterThan(0);
    const warga = await fake.signIn("warga");
    expect((await get(server, path, warga.cookie)).status).toBe(403);
    const pemda = await fake.signIn("pemda");
    expect((await get(server, path, pemda.cookie)).status).toBe(200);
  });
});

describe("GET /api/pemda/summary", () => {
  test("installed status is independent of interest; unknown capacities do not become estimated capacity", async () => {
    const s = start();
    await resident(s, { installedPv: true, installedKwp: 2.2, interestedPv: false, consentMap: true }, { name: "A", email: "pv1@example.com" });
    await resident(s, { installedPv: false, interestedPv: true, consentMap: true }, { name: "B", email: "pv2@example.com" });
    await resident(s, { installedPv: true, installedKwp: null, consentMap: false }, { name: "C", email: "pv3@example.com" });
    const { cookie } = await s.fake.signIn("pemda");
    const body = await (await get(s.server, "/api/pemda/summary", cookie)).json() as PemdaSummary;
    expect(body.totals.installed).toBe(2);
    expect(body.totals.interested).toBe(1);
    expect(body.totals.installedKwp).toBe(2.2);
    const points = await (await get(s.server, "/api/pemda/homes", cookie)).json() as PemdaHomes;
    expect(points.features).toHaveLength(2);
    expect(points.features.filter(f => f.properties.installed)).toHaveLength(1);
    expect(points.features[0]!.properties.installedKwp).toBe(2.2);
  });
  test("is empty when no home is registered", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("pemda");
    expect(await (await get(server, "/api/pemda/summary", cookie)).json()).toEqual({
      regions: [],
      totals: { homes: 0, interested: 0, installed: 0, installedKwp: 0, verified: 0, verifiedKwp: 0, potentialKwp: 0, kwhYear: 0 },
      demoHomes: 0,
    });
  });

  test("counts every registered home, consenting or not, and sums the totals", async () => {
    const s = start();
    await resident(s, { interestedPv: true, consentMap: true, kwhMonth: 100, footprintM2: 100 }, { name: "A", email: "a@example.com" });
    await resident(s, { interestedPv: false, consentMap: false, kwhMonth: 200, footprintM2: 100 }, { name: "B", email: "b@example.com" });
    const { cookie } = await s.fake.signIn("pemda");
    const body = (await (await get(s.server, "/api/pemda/summary", cookie)).json()) as PemdaSummary;
    expect(body.regions).toEqual([
      { regionId: "samarinda", regionName: "Samarinda", homes: 2, interested: 1, installed: 0, installedKwp: 0, verified: 0, verifiedKwp: 0, potentialKwp: 20.9, kwhYear: 3600 },
    ]);
    expect(body.totals).toEqual({ homes: 2, interested: 1, installed: 0, installedKwp: 0, verified: 0, verifiedKwp: 0, potentialKwp: 20.9, kwhYear: 3600 });
    expect(body.demoHomes).toBe(0);
  });

  test("counts how many of the homes are demo homes", async () => {
    const s = start();
    await resident(s, {}, { name: "A", email: "a@example.com" });
    const demo = await s.fake.signIn("warga", { demo: true });
    const built = [...s.fake.homes.values()][0]!.home;
    await s.fake.deps.db.homeUpsert(demo.user.id, built, true);
    const { cookie } = await s.fake.signIn("pemda");
    const body = (await (await get(s.server, "/api/pemda/summary", cookie)).json()) as PemdaSummary;
    expect(body.totals.homes).toBe(2);
    expect(body.demoHomes).toBe(1);
  });
});

describe("GET /api/pemda/homes", () => {
  test("lists only homes whose owners agreed, as anonymous points", async () => {
    const s = start();
    await resident(s, { consentMap: true, interestedPv: true, lng: 117.2, lat: -0.45 }, { name: "Rahasia Satu", email: "rahasia1@example.com" });
    await resident(s, { consentMap: false, lng: 117.3, lat: -0.4 }, { name: "Rahasia Dua", email: "rahasia2@example.com" });
    const { cookie } = await s.fake.signIn("pemda", { name: "Petugas", email: "petugas@example.com" });
    const res = await get(s.server, "/api/pemda/homes", cookie);
    const text = await res.text();
    const body = JSON.parse(text) as PemdaHomes;

    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.features[0]).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [117.2, -0.45] },
      properties: { buildingType: "rumah", potentialKwp: 12.65, interested: true, installed: false, installedKwp: null, footprintM2: 120, heightM: null, regionId: "samarinda", demo: false },
    });
    // No identity anywhere in the answer, and the non-consenting home's point is absent.
    for (const secret of ["Rahasia", "rahasia", "@example.com", "email", "name", "userId", "117.3", "b-1"]) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(body.features[0]!.properties).sort()).toEqual(["buildingType", "demo", "footprintM2", "heightM", "installed", "installedKwp", "interested", "potentialKwp", "regionId"]);
  });

  test("a resident who withdraws consent disappears from the map", async () => {
    const s = start();
    const { cookie: warga } = await s.fake.signIn("warga");
    const put = (consentMap: boolean) =>
      fetch(new URL("/api/me/home", s.server.url), {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: warga },
        body: JSON.stringify({ ...HOME, consentMap }),
      });
    const { cookie } = await s.fake.signIn("pemda");
    await put(true);
    expect(((await (await get(s.server, "/api/pemda/homes", cookie)).json()) as PemdaHomes).features).toHaveLength(1);
    await put(false);
    expect(((await (await get(s.server, "/api/pemda/homes", cookie)).json()) as PemdaHomes).features).toHaveLength(0);
  });
});
