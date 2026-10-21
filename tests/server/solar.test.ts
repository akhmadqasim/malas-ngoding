import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type { SolarSimulation } from "../../src/server/routes/solar.ts";
import { type FakeDeps, type FakeUpstreams, fakeDeps } from "./fakes.ts";

const BODY = { lat: -0.5, lng: 117.15, roofAreaM2: 100, kwhYear: 5000, backupHours: 4 };
const NASA = { pshByMonth: [4.5, 5, 5, 4.9, 4.7, 4.3, 4.6, 5, 5.1, 4.9, 4.6, 4.5], pshYear: 4.77 };

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(upstreams: FakeUpstreams = {}): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps(null, upstreams);
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const post = (s: Server<undefined>, body: unknown) =>
  fetch(new URL("/api/solar/simulate", s.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/solar/simulate", () => {
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  test("returns finite numbers and the peak sun hours from NASA", async () => {
    const { server, fake } = start({ nasa: NASA });
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    const out = (await res.json()) as SolarSimulation;
    expect(out.peakSunHours).toBe(4.77);
    expect(out.pshByMonth).toEqual(NASA.pshByMonth);
    for (const k of ["kWp", "panels", "kwhYear", "coveragePct", "batteryKwh", "costRp", "savingRpYear", "paybackYears", "co2AvoidedKgYear"] as const) {
      expect(Number.isFinite(out[k])).toBe(true);
    }
    expect(out.kWp).toBeGreaterThan(0);
    expect(out.co2AvoidedKgYear).toBeGreaterThan(0);
    expect(out.assumptions.some((a) => /NASA/.test(a))).toBe(false);
    expect(fake.nasaCalls).toEqual([[-0.5, 117.15]]);
    // Cached under coordinates rounded to 0.1 degree.
    expect(fake.stored.get("solar_climatology:-0.5,117.2")).toEqual(NASA);
  });

  test("uses the seed tariff, costs and the solar emission factor", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, BODY)).json()) as SolarSimulation;
    // No building type: tariff R-1 Rp 1.444,7, Rp 15 jt/kWp, and 1,13 kg CO2/kWh (Kepmen factor for PLTS).
    expect(out.co2AvoidedKgYear).toBeCloseTo(out.selfUseKwh * 1.13, 6);
    expect(out.savingRpYear).toBeCloseTo(out.selfUseKwh * 1444.7, 3);
    expect(out.costRp).toBeCloseTo(out.kWp * 15_000_000 + out.batteryKwh * 2_500_000, 3);
    expect(out.assumptions.some((a) => a.includes("1,13 kg CO2"))).toBe(true);
  });

  test("without a building type: R-1, 60% daytime use, and it says the type is unknown", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, BODY)).json()) as SolarSimulation;
    expect(out.selfUseKwh).toBeLessThanOrEqual(BODY.kwhYear * 0.6 + 1e-6);
    // 3.000 kWh by day needs 4,02 panels at 4,77 psh; rounded down to 4, so just under the 60% share.
    expect(out.coveragePct).toBeCloseTo(59.75, 2);
    expect(out.assumptions[0]).toContain("R-1/TR 1.300 VA");
    expect(out.assumptions[0]).toContain("jenis gedung tidak diketahui");
  });

  test.each([
    ["rumah", 5000, "R-1/TR 1.300 VA", 1444.7],
    ["kantor", 100_000, "B-2/TR 6.600 VA–200 kVA", 1444.7],
    ["mal", 100_000, "B-2/TR 6.600 VA–200 kVA", 1444.7],
    ["mal", 900_000, "B-3/TM di atas 200 kVA", 1114.74],
    ["hotel", 700_000, "B-3/TM di atas 200 kVA", 1114.74],
    ["pemerintahan", 100_000, "P-1/TR 6.600 VA–200 kVA", 1699.53],
    ["pemerintahan", 900_000, "P-2/TM di atas 200 kVA", 1522.88],
    ["industri", 900_000, "I-3/TM di atas 200 kVA", 1114.74],
  ])("a %s using %d kWh a year is priced as %s", async (buildingType, kwhYear, golongan, rp) => {
    const { server } = start({ nasa: NASA });
    const res = await post(server, { ...BODY, roofAreaM2: 5000, kwhYear, buildingType });
    expect(res.status).toBe(200);
    const out = (await res.json()) as SolarSimulation;
    expect(out.savingRpYear).toBeCloseTo(out.selfUseKwh * rp, 3);
    expect(out.assumptions[0]).toContain(`golongan ${golongan}`);
    // Written as PLN writes it: two decimals ("Rp 1.444,70").
    expect(out.assumptions[0]).toContain(`Rp ${rp.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per kWh`);
  });

  test.each(["sekolah", "ibadah", "rumah_sakit"])("a %s says plainly that the social tariff is not modelled", async (buildingType) => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, { ...BODY, buildingType })).json()) as SolarSimulation;
    expect(out.savingRpYear).toBeCloseTo(out.selfUseKwh * 1444.7, 3);
    expect(out.assumptions[0]).toContain("tarif sosial (golongan S)");
    expect(out.assumptions[0]).toContain("belum dimodelkan");
    expect(out.assumptions[0]).not.toContain("golongan R-1");
  });

  test("a house saves only what it uses while the sun shines (at most 40%), and the panels are sized to it", async () => {
    const { server } = start({ nasa: NASA });
    const house = (await (await post(server, { ...BODY, buildingType: "rumah" })).json()) as SolarSimulation;
    const office = (await (await post(server, { ...BODY, buildingType: "kantor" })).json()) as SolarSimulation;
    // 2.000 kWh by day is 2,68 panels, rounded down to 2 (1,1 kWp): 1.494 kWh, all used, 29,9% of the load.
    expect(house.coveragePct).toBeCloseTo(29.88, 1);
    expect(house.coveragePct).toBeLessThanOrEqual(40);
    // An office uses 85% in daylight but only on ~250 working days: 2,75 kWp make 10,23 kWh a day, all used on a
    // working day (15,90 kWh in daylight), but only 1,40 kWh of it on the 115 other days. 2.719 of 5.000 kWh.
    expect(office.coveragePct).toBeCloseTo(54.39, 1);
    expect(house.kWp).toBeLessThan(office.kWp);
    expect(house.assumptions.some((a) => a.includes("40%"))).toBe(true);
  });

  test("a school is open about 200 days: its ring shows about half, not the 85% daytime share", async () => {
    const { server } = start({ nasa: NASA });
    // 900 m2 footprint, 2 floors, 63.000 kWh a year.
    const school = (await (await post(server, { ...BODY, roofAreaM2: 900, kwhYear: 63_000, buildingType: "sekolah" })).json()) as SolarSimulation;
    expect(school.coveragePct).toBeGreaterThan(45);
    expect(school.coveragePct).toBeLessThan(56);
    expect(school.exportKwh).toBeGreaterThan(0.3 * school.kwhYear);
    const days = school.assumptions.find((a) => a.includes("hari setahun"));
    expect(days).toContain("sekitar 200 hari setahun");
    expect(days).toContain("15%");
  });

  test("each type names its operating days", async () => {
    const { server } = start({ nasa: NASA });
    const line = async (buildingType: string) =>
      ((await (await post(server, { ...BODY, buildingType })).json()) as SolarSimulation).assumptions.find((a) => a.includes("hari setahun"));
    expect(await line("kantor")).toContain("sekitar 250 hari setahun");
    expect(await line("rumah")).toContain("setiap hari");
    expect(await line("mal")).toContain("setiap hari");
  });

  test("names the missing export credit and what the battery does", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, { ...BODY, buildingType: "kantor" })).json()) as SolarSimulation;
    expect(out.assumptions).toContain("Kelebihan listrik ke jaringan PLN tidak mengurangi tagihan (Permen ESDM 2/2024).");
    const battery = out.assumptions.find((a) => a.startsWith("Baterai hanya cadangan"));
    expect(battery).toContain("tidak menambah penghematan");
    expect(battery).toContain(`Tanpa baterai, balik modal ${out.paybackPanelYears.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tahun`);
    const noBattery = (await (await post(server, { ...BODY, buildingType: "kantor", backupHours: 0 })).json()) as SolarSimulation;
    expect(noBattery.assumptions.some((a) => a.startsWith("Baterai"))).toBe(false);
  });

  test("a second call for a nearby point is served from the climatology cache", async () => {
    const { server, fake } = start({ nasa: NASA });
    await post(server, BODY);
    await post(server, { ...BODY, lat: -0.52, lng: 117.17 });
    expect(fake.nasaCalls).toHaveLength(1);
  });

  test("NASA down and nothing cached falls back to 4.2 peak sun hours with a note, and is not cached", async () => {
    const { server, fake } = start({ nasa: new Error("nasa down") });
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    const out = (await res.json()) as SolarSimulation;
    expect(out.peakSunHours).toBe(4.2);
    expect(out.pshByMonth).toEqual(Array(12).fill(4.2));
    expect(out.assumptions.some((a) => a.includes("NASA POWER") && a.includes("4,2"))).toBe(true);
    expect(Number.isFinite(out.kwhYear) && out.kWp > 0).toBe(true);
    expect(fake.stored.size).toBe(0);
  });

  test("a failing climatology cache still returns a result", async () => {
    const { server, fake } = start({ nasa: NASA });
    fake.deps.db.climatologyGet = async () => {
      throw new Error("db down");
    };
    fake.deps.db.climatologySet = async () => {
      throw new Error("db down");
    };
    const res = await post(server, BODY);
    expect(res.status).toBe(200);
    expect(((await res.json()) as SolarSimulation).peakSunHours).toBe(4.77);
  });

  test("an extreme roof is clamped and the result stays finite", async () => {
    const { server } = start({ nasa: NASA });
    const out = (await (await post(server, { ...BODY, roofAreaM2: 1e12, kwhYear: 1e15, backupHours: 1e9 })).json()) as SolarSimulation;
    for (const k of ["kWp", "kwhYear", "coveragePct", "batteryKwh", "costRp", "paybackYears"] as const) {
      expect(Number.isFinite(out[k])).toBe(true);
    }
    expect(out.kWp).toBeLessThanOrEqual((50_000 * 0.6) / 5.5);
  });

  test.each([
    ["lat out of range", { ...BODY, lat: 91 }],
    ["lng is a string", { ...BODY, lng: "x" }],
    ["roof is zero", { ...BODY, roofAreaM2: 0 }],
    ["roof is missing", { ...BODY, roofAreaM2: undefined }],
    ["kwhYear is negative", { ...BODY, kwhYear: -5 }],
    ["backupHours is null", { ...BODY, backupHours: null }],
    ["backupHours is negative", { ...BODY, backupHours: -1 }],
    ["buildingType is unknown", { ...BODY, buildingType: "kandang" }],
    ["buildingType is a number", { ...BODY, buildingType: 3 }],
    ["body is an array", [1]],
    ["body is not json", "nope{"],
  ])("invalid body (%s) returns 400 with an error", async (_n, body) => {
    const { server, fake } = start({ nasa: NASA });
    const res = await post(server, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.nasaCalls).toHaveLength(0);
  });
});
