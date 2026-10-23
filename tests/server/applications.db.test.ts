import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { runMigrations } from "../../scripts/migrate.ts";
import * as db from "../../src/server/db.ts";
import { type ApplicationDraft, type NewApplicationEvent, sql } from "../../src/server/db.ts";
import { createServer } from "../../src/server/index.ts";
import { COOKIE_NAME, createSession } from "../../src/server/services/session.ts";
import type { SolarApplication } from "../../src/shared/applications.ts";
import type { HomeAnswer } from "../../src/shared/auth.ts";
import { fakeDeps } from "./fakes.ts";

// The same rules as applications.test.ts, against Postgres: the transaction, the user lock and the partial
// unique index must hold under concurrent requests. Creates its own users (apptest-*@example.test) and
// deletes them afterwards (reports, photos and homes go with them); it does not run the seed.

async function dbReachable(): Promise<boolean> {
  try {
    await sql`SELECT 1 FROM regions LIMIT 1`;
    return true;
  } catch {
    return false;
  }
}
const reachable = await dbReachable();
if (!reachable) console.warn("SKIP tests/server/applications.db.test.ts: database unreachable or not migrated");

const RUN = crypto.randomUUID().slice(0, 8);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const HOME = {
  featureId: `apptest-${RUN}`,
  lng: 117.1473,
  lat: -0.4954,
  footprintM2: 120,
  heightM: null,
  buildingType: "rumah" as const,
  floors: 1,
  kwhMonth: 300,
  billRpMonth: null,
  interestedPv: true,
  consentMap: false,
};

let server: Server<undefined>;
let n = 0;

async function user(role: "warga" | "pemda" = "warga") {
  const u = await db.createUser({ email: `apptest-${RUN}-${n++}@example.test`, name: `Uji ${n}`, passwordHash: "x", role });
  const { token } = await createSession(db, u!.id);
  return { id: u!.id, cookie: `${COOKIE_NAME}=${token}` };
}

const call = (method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(new URL(path, server.url), {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function residentWithHome() {
  const u = await user();
  const res = await call("PUT", "/api/me/home", u.cookie, HOME);
  expect(res.status).toBe(200);
  return { ...u, updatedAt: ((await res.json()) as HomeAnswer).home!.updatedAt };
}

async function photo(cookie: string, kind = "installation"): Promise<string> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new Blob([PNG]), "foto.png");
  const res = await fetch(new URL("/api/me/solar-application-files", server.url), { method: "POST", headers: { cookie }, body: form });
  expect(res.status).toBe(201);
  return ((await res.json()) as { file: { id: string } }).file.id;
}

const body = (updatedAt: string, fileIds: string[]) => ({
  expectedHomeUpdatedAt: updatedAt,
  installedKwp: 2.2,
  panelCount: 4,
  installedOn: "2026-09-30",
  installerName: "CV Uji",
  plnApprovalNumber: null,
  complianceType: "registration",
  complianceNumber: "REG-1",
  contactName: "Uji Kontak",
  phone: "081234567890",
  ownership: "owner",
  ownerPermissionConfirmed: true,
  preferredContactWindow: "weekend",
  consentApplicationProcessing: true,
  fileIds,
});

const create = (cookie: string, b: unknown, key: string = crypto.randomUUID()) =>
  call("POST", "/api/me/solar-applications", cookie, b, { "idempotency-key": key });

describe.skipIf(!reachable)("solar applications on Postgres", () => {
  beforeAll(async () => {
    await runMigrations();
  });
  // A server per test: each has its own send rate limit (10 a minute per address).
  beforeEach(() => {
    // Real database, faked upstreams (NASA sun hours) so no network is needed.
    server = createServer({ port: 0, deps: { ...fakeDeps().deps, db } });
  });
  afterEach(() => {
    server.stop(true);
  });
  afterAll(async () => {
    await sql`DELETE FROM users WHERE email LIKE ${`apptest-${RUN}-%`}`;
  });

  test("concurrent sends with different keys store exactly one active report", async () => {
    const a = await residentWithHome();
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => photo(a.cookie)));
    const results = await Promise.all(ids.map((id) => create(a.cookie, body(a.updatedAt, [id]))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const [row] = await sql`SELECT count(*)::int AS n FROM solar_applications WHERE user_id = ${a.id}`;
    expect(row!.n).toBe(1);
    // The losers' photos stay unattached.
    const [loose] = await sql`SELECT count(*)::int AS n FROM solar_application_files WHERE user_id = ${a.id} AND application_id IS NULL`;
    expect(loose!.n).toBe(4);
  });

  test("concurrent retries of one key return one report", async () => {
    const a = await residentWithHome();
    const b = body(a.updatedAt, [await photo(a.cookie)]);
    const key = crypto.randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => create(a.cookie, b, key)));
    const apps = await Promise.all(results.map((r) => r.json() as Promise<{ application: SolarApplication }>));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(apps.map((x) => x.application.id)).size).toBe(1);
    expect(apps[0]!.application.reference).toMatch(/^PLTS-\d{4}-\d{6}$/);
    const bad = await create(a.cookie, { ...b, notes: "lain" }, key);
    expect(((await bad.json()) as { code: string }).code).toBe("idempotency_mismatch");
  });

  test("home version check uses the same timestamp the home API returns", async () => {
    const a = await residentWithHome();
    const id = await photo(a.cookie);
    await call("PUT", "/api/me/home", a.cookie, { ...HOME, kwhMonth: 350 });
    const stale = await create(a.cookie, body(a.updatedAt, [id]));
    expect(((await stale.json()) as { code: string }).code).toBe("home_changed");
    const fresh = ((await (await call("GET", "/api/me/home", a.cookie)).json()) as HomeAnswer).home!.updatedAt;
    expect((await create(a.cookie, body(fresh, [id]))).status).toBe(201);
  });

  test("two officers on one version: one transition, one version_conflict; verify writes the home", async () => {
    const a = await residentWithHome();
    const sent = (await (await create(a.cookie, body(a.updatedAt, [await photo(a.cookie)]))).json()) as { application: SolarApplication };
    const id = sent.application.id;
    const p1 = await user("pemda");
    const p2 = await user("pemda");
    const act = (cookie: string, b: unknown) => call("POST", `/api/pemda/solar-applications/${id}/actions`, cookie, b);
    const [r1, r2] = await Promise.all([act(p1.cookie, { action: "start_review", expectedVersion: 1 }), act(p2.cookie, { action: "start_review", expectedVersion: 1 })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const [events] = await sql`SELECT count(*)::int AS n FROM solar_application_events WHERE application_id = ${id}`;
    expect(events!.n).toBe(2);

    const v = await act(p1.cookie, { action: "verify", expectedVersion: 2, verifiedKwp: 2.2, internalNote: "Dokumen lengkap" });
    expect(v.status).toBe(200);
    const home = ((await (await call("GET", "/api/me/home", a.cookie)).json()) as HomeAnswer).home!;
    expect(home.verifiedKwp).toBe(2.2);
    // Re-saving the same building keeps it; moving to another building drops it.
    await call("PUT", "/api/me/home", a.cookie, { ...HOME, kwhMonth: 310 });
    expect(((await (await call("GET", "/api/me/home", a.cookie)).json()) as HomeAnswer).home!.verifiedKwp).toBe(2.2);
    await call("PUT", "/api/me/home", a.cookie, { ...HOME, featureId: `${HOME.featureId}-baru` });
    expect(((await (await call("GET", "/api/me/home", a.cookie)).json()) as HomeAnswer).home!.verifiedKwp).toBeNull();

    // The resident's view hides the internal note; the photo bytes round-trip.
    const mine = (await (await call("GET", `/api/me/solar-applications/${id}`, a.cookie)).json()) as { application: SolarApplication };
    expect(JSON.stringify(mine)).not.toContain("Dokumen lengkap");
    const img = await call("GET", mine.application.files[0]!.url, p2.cookie);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  test("list filters, search and cursor run as SQL", async () => {
    const pemda = await user("pemda");
    const refs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = await residentWithHome();
      const r = (await (await create(a.cookie, body(a.updatedAt, [await photo(a.cookie)]))).json()) as { application: SolarApplication };
      refs.push(r.application.reference);
    }
    const q = await (await call("GET", `/api/pemda/solar-applications?q=${refs[1]}&status=submitted,under_review&regionId=samarinda`, pemda.cookie)).json();
    expect((q as { items: { reference: string }[] }).items.map((i) => i.reference)).toEqual([refs[1]!]);
    const page = (await (await call("GET", "/api/pemda/solar-applications?limit=1", pemda.cookie)).json()) as { items: unknown[]; nextCursor: string };
    expect(page.items).toHaveLength(1);
    const next = (await (await call("GET", `/api/pemda/solar-applications?limit=1&cursor=${page.nextCursor}`, pemda.cookie)).json()) as { items: { reference: string }[] };
    expect(next.items).toHaveLength(1);
  });

  test("the database refuses a second active report even without the route", async () => {
    const a = await residentWithHome();
    const draft: ApplicationDraft = {
      regionId: null,
      homeSnapshot: { featureId: "x", lng: 0, lat: 0, regionId: null, regionName: null, buildingType: "rumah", footprintM2: 1, kwhYear: 1, kwhSource: "perkiraan", potentialKwp: 1, homeUpdatedAt: a.updatedAt },
      estimate: { panelCount: 1, kWp: 0.55, kwhYear: 1, savingRpYear: 1, costRp: 1, peakSunHours: 4, assumptions: [], modelVersion: "t" },
      report: { installedKwp: 1, panelCount: 1, installedOn: "2026-01-01", installerName: "x", plnApprovalNumber: null, complianceType: "slo", complianceNumber: "1" },
      contact: { name: "x", phone: "081234567890", ownership: "owner", ownerPermissionConfirmed: true, preferredContactWindow: "weekend", notes: "" },
    };
    const event: NewApplicationEvent = { action: "create", title: "t", publicNote: null, internalNote: null, actorUserId: a.id, actorRole: "warga" };
    await db.applicationCreate({ userId: a.id, idempotencyKey: crypto.randomUUID(), requestHash: "a", homeUpdatedAt: a.updatedAt, draft, fileIds: [], event });
    let refused = "";
    try {
      await sql`
        INSERT INTO solar_applications (seq, reference, user_id, status, home_snapshot, estimate, report, contact)
        VALUES (nextval('solar_application_seq'), ${`UJI-${RUN}`}, ${a.id}, 'under_review', '{}', '{}', '{}', '{}')`;
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
    }
    expect(refused).toContain("solar_applications_one_active_ix");
  });
});
