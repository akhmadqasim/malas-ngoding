import { afterAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import type {
  ApplicationFileAnswer,
  ApplicationPage,
  PemdaApplicationSummary,
  PemdaSolarApplication,
  SolarApplication,
  SolarApplicationSummary,
} from "../../src/shared/applications.ts";
import type { HomeAnswer, HomeInput, PemdaSummary } from "../../src/shared/auth.ts";
import { type FakeDeps, fakeDeps } from "./fakes.ts";

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

type Ctx = { server: Server<undefined>; fake: FakeDeps };
function start(): Ctx {
  const fake = fakeDeps();
  const server = createServer({ port: 0, deps: fake.deps });
  servers.push(server);
  return { server, fake };
}

const HOME: HomeInput = {
  featureId: "b-1",
  lng: 117.15,
  lat: -0.5,
  footprintM2: 120,
  heightM: null,
  buildingType: "rumah",
  floors: 1,
  kwhMonth: 300,
  billRpMonth: null,
  interestedPv: true,
  consentMap: false,
};

/** The smallest bytes that pass the PNG signature check. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function call(s: Ctx, method: string, path: string, cookie?: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(new URL(path, s.server.url), {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A resident with a saved home; returns their cookie and the home's updatedAt. */
async function resident(s: Ctx, name = "Warga A") {
  const { cookie, user } = await s.fake.signIn("warga", { name, email: `${name.replace(/\s/g, "").toLowerCase()}@example.test` });
  const res = await call(s, "PUT", "/api/me/home", cookie, HOME);
  expect(res.status).toBe(200);
  const { home } = (await res.json()) as HomeAnswer;
  return { cookie, user, updatedAt: home!.updatedAt };
}

async function upload(s: Ctx, cookie: string, kind = "installation", bytes: Uint8Array<ArrayBuffer> = PNG): Promise<Response> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new Blob([bytes]), "foto.png");
  return fetch(new URL("/api/me/solar-application-files", s.server.url), { method: "POST", headers: { cookie }, body: form });
}

async function photo(s: Ctx, cookie: string, kind = "installation"): Promise<string> {
  const res = await upload(s, cookie, kind);
  expect(res.status).toBe(201);
  return ((await res.json()) as ApplicationFileAnswer).file.id;
}

function report(updatedAt: string, fileIds: string[], patch: Record<string, unknown> = {}) {
  return {
    expectedHomeUpdatedAt: updatedAt,
    installedKwp: 2.2,
    panelCount: 4,
    installedOn: "2026-09-30",
    installerName: "CV Surya Mahakam",
    plnApprovalNumber: null,
    complianceType: "registration",
    complianceNumber: null,
    contactName: "Budi Santoso",
    phone: "+62 812-3456-7890",
    ownership: "owner",
    ownerPermissionConfirmed: true,
    preferredContactWindow: "weekday_afternoon",
    notes: "Hubungi sebelum datang",
    consentApplicationProcessing: true,
    fileIds,
    ...patch,
  };
}

const create = (s: Ctx, cookie: string, body: unknown, key: string = crypto.randomUUID()) =>
  call(s, "POST", "/api/me/solar-applications", cookie, body, { "idempotency-key": key });

/** A resident who has sent one report (with an installation photo and a compliance photo). */
async function sent(s: Ctx, name = "Warga A", patch: Record<string, unknown> = {}) {
  const r = await resident(s, name);
  const ids = [await photo(s, r.cookie), await photo(s, r.cookie, "compliance")];
  const res = await create(s, r.cookie, report(r.updatedAt, ids, patch));
  expect(res.status).toBe(201);
  const { application } = (await res.json()) as { application: SolarApplication };
  return { ...r, app: application };
}

const act = (s: Ctx, who: "me" | "pemda", id: string, cookie: string, body: Record<string, unknown>) =>
  call(s, "POST", `/api/${who}/solar-applications/${id}/actions`, cookie, body);

async function ok<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const r = await res;
  const text = await r.text();
  expect({ status: r.status, text }).toEqual({ status, text: expect.any(String) });
  return JSON.parse(text) as T;
}

async function code(res: Response | Promise<Response>): Promise<{ status: number; code: string | undefined }> {
  const r = await res;
  const body = (await r.json()) as { error: string; code?: string };
  expect(body.error.length).toBeGreaterThan(0);
  return { status: r.status, code: body.code };
}

describe("full flow: report, request changes, fix, verify", () => {
  test("a resident's report reaches the queue, comes back for a fix and is verified", async () => {
    const s = start();
    const a = await sent(s, "Warga A", { complianceType: "pending" });
    expect(a.app.reference).toMatch(/^PLTS-\d{4}-000001$/);
    expect(a.app.status).toBe("submitted");
    expect(a.app.version).toBe(1);
    expect(a.app.contact.phone).toBe("081234567890");
    expect(a.app.allowedActions).toEqual(["cancel"]);
    expect(a.app.events.map((e) => e.title)).toEqual(["Laporan pemasangan dikirim"]);
    expect(a.app.estimate.modelVersion).toBe("solar-2026-10");
    expect(a.app.warnings).toContain("compliance_pending");
    expect(a.app.files).toHaveLength(2);

    // The resident's list and the government queue both show it after a "refresh".
    const mine = await ok<ApplicationPage<SolarApplicationSummary>>(call(s, "GET", "/api/me/solar-applications", a.cookie));
    expect(mine.items.map((i) => i.reference)).toEqual([a.app.reference]);
    const pemda = await s.fake.signIn("pemda", { name: "Petugas Dinas", email: "petugas@example.test" });
    const queue = await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", "/api/pemda/solar-applications?status=submitted", pemda.cookie));
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]!.contactName).toBe("Budi Santoso");

    let p = (await ok<{ application: PemdaSolarApplication }>(act(s, "pemda", a.app.id, pemda.cookie, { action: "start_review", expectedVersion: 1 }))).application;
    expect(p.status).toBe("under_review");
    // Proof of SLO/registration is pending, so verify is not offered and is refused.
    expect(p.allowedActions).toEqual(["request_changes", "schedule_survey", "reject"]);
    expect(await code(act(s, "pemda", a.app.id, pemda.cookie, { action: "verify", expectedVersion: 2, verifiedKwp: 2.2 }))).toEqual({ status: 409, code: "compliance_missing" });
    // A reason is required to send it back.
    expect(await code(act(s, "pemda", a.app.id, pemda.cookie, { action: "request_changes", expectedVersion: 2 }))).toEqual({ status: 400, code: "validation" });
    p = (
      await ok<{ application: PemdaSolarApplication }>(
        act(s, "pemda", a.app.id, pemda.cookie, { action: "request_changes", expectedVersion: 2, publicNote: "Lengkapi nomor registrasi ESDM.", internalNote: "Foto SLO buram" }),
      )
    ).application;
    expect(p.status).toBe("needs_changes");
    expect(p.events.at(-1)).toMatchObject({ actorRole: "pemda", actorName: "Petugas Dinas", internalNote: "Foto SLO buram" });

    // The resident sees the reason but not the internal note or who did it.
    const raw = await (await call(s, "GET", `/api/me/solar-applications/${a.app.id}`, a.cookie)).text();
    expect(raw).not.toContain("Foto SLO buram");
    expect(raw).not.toContain("Petugas Dinas");
    let w = (JSON.parse(raw) as { application: SolarApplication }).application;
    expect(w.status).toBe("needs_changes");
    expect(w.events.at(-1)!.publicNote).toBe("Lengkapi nomor registrasi ESDM.");
    expect(w.allowedActions).toEqual(["edit", "resubmit", "cancel"]);

    // A stale version is refused; the fix keeps the home snapshot and the old events.
    expect(await code(call(s, "PATCH", `/api/me/solar-applications/${a.app.id}`, a.cookie, { expectedVersion: 1, complianceType: "registration", complianceNumber: "REG-123" }))).toEqual({ status: 409, code: "version_conflict" });
    w = (await ok<{ application: SolarApplication }>(call(s, "PATCH", `/api/me/solar-applications/${a.app.id}`, a.cookie, { expectedVersion: 3, complianceType: "registration", complianceNumber: "REG-123" }))).application;
    expect(w.report.complianceNumber).toBe("REG-123");
    expect(w.status).toBe("needs_changes");
    expect(w.homeSnapshot).toEqual(a.app.homeSnapshot);
    expect(w.events).toHaveLength(4);
    w = (await ok<{ application: SolarApplication }>(act(s, "me", a.app.id, a.cookie, { action: "resubmit", expectedVersion: 4 }))).application;
    expect(w.status).toBe("submitted");

    await ok(act(s, "pemda", a.app.id, pemda.cookie, { action: "start_review", expectedVersion: 5 }));
    p = (await ok<{ application: PemdaSolarApplication }>(act(s, "pemda", a.app.id, pemda.cookie, { action: "verify", expectedVersion: 6, verifiedKwp: 2.2 }))).application;
    expect(p.status).toBe("verified");
    expect(p.verification).toMatchObject({ kWp: 2.2, method: "document" });
    expect(p.allowedActions).toEqual([]);

    // Only now does the home carry the verified capacity, and the government summary count it.
    const { home } = await ok<HomeAnswer>(call(s, "GET", "/api/me/home", a.cookie));
    expect(home!.verifiedKwp).toBe(2.2);
    expect(home!.installedPv).toBe(false);
    const summary = await ok<PemdaSummary>(call(s, "GET", "/api/pemda/summary", pemda.cookie));
    expect(summary.totals).toMatchObject({ verified: 1, verifiedKwp: 2.2 });
  });

  test("survey path: schedule with a zoned time, reschedule, verify by survey", async () => {
    const s = start();
    const a = await sent(s);
    const pemda = await s.fake.signIn("pemda");
    await ok(act(s, "pemda", a.app.id, pemda.cookie, { action: "start_review", expectedVersion: 1 }));
    const day = new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10);
    expect(await code(act(s, "pemda", a.app.id, pemda.cookie, { action: "schedule_survey", expectedVersion: 2, survey: { startsAt: `${day}T09:00:00`, endsAt: `${day}T10:00:00` } }))).toEqual({ status: 400, code: "validation" });
    let p = (await ok<{ application: PemdaSolarApplication }>(act(s, "pemda", a.app.id, pemda.cookie, { action: "schedule_survey", expectedVersion: 2, survey: { startsAt: `${day}T09:00:00+08:00`, endsAt: `${day}T11:00:00+08:00` } }))).application;
    expect(p.status).toBe("survey_scheduled");
    expect(p.survey).toEqual({ startsAt: `${day}T01:00:00.000Z`, endsAt: `${day}T03:00:00.000Z` });
    p = (await ok<{ application: PemdaSolarApplication }>(act(s, "pemda", a.app.id, pemda.cookie, { action: "reschedule_survey", expectedVersion: 3, survey: { startsAt: `${day}T13:00:00+08:00`, endsAt: `${day}T14:00:00+08:00` }, publicNote: "Petugas datang siang." }))).application;
    expect(p.status).toBe("survey_scheduled");
    expect(p.version).toBe(4);
    p = (await ok<{ application: PemdaSolarApplication }>(act(s, "pemda", a.app.id, pemda.cookie, { action: "verify", expectedVersion: 4, verifiedKwp: 2 }))).application;
    expect(p.verification?.method).toBe("survey");
  });

  test("a rejected report needs a reason and frees the resident to send a new one", async () => {
    const s = start();
    const a = await sent(s);
    const pemda = await s.fake.signIn("pemda");
    await ok(act(s, "pemda", a.app.id, pemda.cookie, { action: "start_review", expectedVersion: 1 }));
    expect(await code(act(s, "pemda", a.app.id, pemda.cookie, { action: "reject", expectedVersion: 2 }))).toEqual({ status: 400, code: "validation" });
    await ok(act(s, "pemda", a.app.id, pemda.cookie, { action: "reject", expectedVersion: 2, publicNote: "Foto tidak menunjukkan panel." }));
    const again = await create(s, a.cookie, report(a.updatedAt, [await photo(s, a.cookie)]));
    expect(again.status).toBe(201);
  });
});

describe("access", () => {
  test("another resident gets 404 for every route on someone else's report, without its contact", async () => {
    const s = start();
    const a = await sent(s, "Warga A");
    const b = await resident(s, "Warga B");
    for (const res of [
      call(s, "GET", `/api/me/solar-applications/${a.app.id}`, b.cookie),
      call(s, "PATCH", `/api/me/solar-applications/${a.app.id}`, b.cookie, { expectedVersion: 1, notes: "x" }),
      act(s, "me", a.app.id, b.cookie, { action: "cancel", expectedVersion: 1 }),
      call(s, "GET", a.app.files[0]!.url, b.cookie),
    ]) {
      const r = await res;
      expect(r.status).toBe(404);
      const text = await r.text();
      expect(text).not.toContain("0812");
      expect(text).not.toContain("Budi");
    }
    expect((await ok<ApplicationPage<SolarApplicationSummary>>(call(s, "GET", "/api/me/solar-applications", b.cookie))).items).toEqual([]);
    expect(s.fake.applications.get(a.app.id)!.version).toBe(1);
  });

  test("residents cannot reach government routes or run government actions; signed out is 401", async () => {
    const s = start();
    const a = await sent(s);
    expect((await call(s, "GET", "/api/pemda/solar-applications")).status).toBe(401);
    expect((await call(s, "GET", "/api/pemda/solar-applications", a.cookie)).status).toBe(403);
    expect((await call(s, "GET", `/api/pemda/solar-applications/${a.app.id}`, a.cookie)).status).toBe(403);
    expect((await act(s, "pemda", a.app.id, a.cookie, { action: "start_review", expectedVersion: 1 })).status).toBe(403);
    // A government action name on the resident route is refused, not run.
    expect(await code(act(s, "me", a.app.id, a.cookie, { action: "verify", expectedVersion: 1, verifiedKwp: 2 }))).toEqual({ status: 409, code: "invalid_transition" });
    const pemda = await s.fake.signIn("pemda");
    expect((await call(s, "GET", "/api/me/solar-applications", pemda.cookie)).status).toBe(403);
    expect((await call(s, "GET", a.app.files[0]!.url)).status).toBe(401);
  });

  test("photos: the owner and (once attached) the government can open them; others cannot", async () => {
    const s = start();
    const a = await resident(s);
    const loose = await photo(s, a.cookie);
    const pemda = await s.fake.signIn("pemda");
    expect((await call(s, "GET", `/api/solar-application-files/${loose}`, pemda.cookie)).status).toBe(404);
    const mine = await call(s, "GET", `/api/solar-application-files/${loose}`, a.cookie);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
    await ok(create(s, a.cookie, report(a.updatedAt, [loose])), 201);
    expect((await call(s, "GET", `/api/solar-application-files/${loose}`, pemda.cookie)).status).toBe(200);
  });

  test("cross-site writes are refused", async () => {
    const s = start();
    const a = await resident(s);
    const res = await call(s, "POST", "/api/me/solar-applications", a.cookie, report(a.updatedAt, []), { origin: "https://evil.example", "idempotency-key": crypto.randomUUID() });
    expect(res.status).toBe(403);
  });
});

describe("sending a report", () => {
  test("same Idempotency-Key and body return the same report; a different body is 409", async () => {
    const s = start();
    const a = await resident(s);
    const body = report(a.updatedAt, [await photo(s, a.cookie)]);
    const key = crypto.randomUUID();
    const first = await ok<{ application: SolarApplication }>(create(s, a.cookie, body, key), 201);
    const retry = await ok<{ application: SolarApplication }>(create(s, a.cookie, body, key), 200);
    expect(retry.application.id).toBe(first.application.id);
    expect(await code(create(s, a.cookie, { ...body, notes: "lain" }, key))).toEqual({ status: 409, code: "idempotency_mismatch" });
    expect(await code(create(s, a.cookie, body, "bukan-uuid"))).toEqual({ status: 400, code: "idempotency_key_required" });
    expect(s.fake.applications.size).toBe(1);
  });

  test("concurrent sends: one report per resident, and repeats of one key share it", async () => {
    const s = start();
    const a = await resident(s);
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => photo(s, a.cookie)));
    const results = await Promise.all(ids.map((id) => create(s, a.cookie, report(a.updatedAt, [id]))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    const codes = await Promise.all(results.filter((r) => r.status === 409).map((r) => r.json() as Promise<{ code: string }>));
    expect(new Set(codes.map((c) => c.code))).toEqual(new Set(["active_application_exists"]));

    const b = await resident(s, "Warga B");
    const body = report(b.updatedAt, [await photo(s, b.cookie)]);
    const key = crypto.randomUUID();
    const same = await Promise.all([1, 2, 3].map(() => create(s, b.cookie, body, key)));
    const apps = await Promise.all(same.map((r) => r.json() as Promise<{ application: SolarApplication }>));
    expect(new Set(apps.map((x) => x.application.id)).size).toBe(1);
    expect(s.fake.applications.size).toBe(2);
  });

  test("a home saved after the form opened is 409 home_changed; no home is 409 home_missing", async () => {
    const s = start();
    const a = await resident(s);
    const id = await photo(s, a.cookie);
    await call(s, "PUT", "/api/me/home", a.cookie, { ...HOME, kwhMonth: 400 });
    expect(await code(create(s, a.cookie, report(a.updatedAt, [id])))).toEqual({ status: 409, code: "home_changed" });
    const { cookie } = await s.fake.signIn("warga");
    const other = await photo(s, cookie);
    expect(await code(create(s, cookie, report(a.updatedAt, [other])))).toEqual({ status: 409, code: "home_missing" });
  });

  test("validation: needs an installation photo, consent, a valid phone and no future date", async () => {
    const s = start();
    const a = await resident(s);
    const doc = await photo(s, a.cookie, "compliance");
    expect(await code(create(s, a.cookie, report(a.updatedAt, [doc])))).toEqual({ status: 400, code: "validation" });
    const pic = await photo(s, a.cookie);
    for (const patch of [
      { consentApplicationProcessing: false },
      { phone: "12345" },
      { installedOn: "2999-01-01" },
      { panelCount: 2.5 },
      { ownership: "authorized_resident", ownerPermissionConfirmed: false },
      { complianceType: "pending", complianceNumber: "X" },
    ]) {
      expect(await code(create(s, a.cookie, report(a.updatedAt, [pic], patch)))).toEqual({ status: 400, code: "validation" });
    }
    expect(s.fake.applications.size).toBe(0);
  });

  test("someone else's or an already used photo is files_invalid", async () => {
    const s = start();
    const a = await sent(s);
    const b = await resident(s, "Warga B");
    expect(await code(create(s, b.cookie, report(b.updatedAt, [a.app.files[0]!.id])))).toEqual({ status: 400, code: "files_invalid" });
  });

  test("uploads must be real JPEG, PNG or WebP", async () => {
    const s = start();
    const a = await resident(s);
    expect(await code(upload(s, a.cookie, "installation", new TextEncoder().encode("<svg></svg>")))).toEqual({ status: 415, code: "file_type" });
    expect(await code(upload(s, a.cookie, "selfie"))).toEqual({ status: 400, code: "validation" });
  });
});

describe("home and snapshot", () => {
  test("later home edits do not change the report; the home cannot be deleted while it is active", async () => {
    const s = start();
    const a = await sent(s);
    await ok(call(s, "PUT", "/api/me/home", a.cookie, { ...HOME, footprintM2: 300, kwhMonth: 900 }));
    const { application } = await ok<{ application: SolarApplication }>(call(s, "GET", `/api/me/solar-applications/${a.app.id}`, a.cookie));
    expect(application.homeSnapshot).toEqual(a.app.homeSnapshot);
    expect(application.estimate).toEqual(a.app.estimate);
    expect(await code(call(s, "DELETE", "/api/me/home", a.cookie))).toEqual({ status: 409, code: "active_application_exists" });
    await ok(act(s, "me", a.app.id, a.cookie, { action: "cancel", expectedVersion: 1 }));
    expect((await call(s, "DELETE", "/api/me/home", a.cookie)).status).toBe(204);
    // The cancelled report keeps its snapshot after the home is gone.
    const after = await ok<{ application: SolarApplication }>(call(s, "GET", `/api/me/solar-applications/${a.app.id}`, a.cookie));
    expect(after.application.status).toBe("cancelled");
    expect(after.application.homeSnapshot.featureId).toBe("b-1");
  });

  test("a resident's self-reported installation does not count as verified", async () => {
    const s = start();
    const a = await resident(s);
    const { home } = await ok<HomeAnswer>(call(s, "PUT", "/api/me/home", a.cookie, { ...HOME, installedPv: true, installedKwp: 3 }));
    expect(home!.verifiedKwp).toBeNull();
  });
});

describe("government queue", () => {
  test("filters by status, region and reference; pages with a cursor", async () => {
    const s = start();
    const refs: string[] = [];
    for (const n of ["A", "B", "C"]) refs.push((await sent(s, `Warga ${n}`)).app.reference);
    const pemda = await s.fake.signIn("pemda");
    const page1 = await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", "/api/pemda/solar-applications?limit=2", pemda.cookie));
    expect(page1.items.map((i) => i.reference)).toEqual([refs[2]!, refs[1]!]);
    const page2 = await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", `/api/pemda/solar-applications?limit=2&cursor=${page1.nextCursor}`, pemda.cookie));
    expect(page2.items.map((i) => i.reference)).toEqual([refs[0]!]);
    expect(page2.nextCursor).toBeNull();
    const q = await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", `/api/pemda/solar-applications?q=${refs[1]!.slice(-6)}`, pemda.cookie));
    expect(q.items.map((i) => i.reference)).toEqual([refs[1]!]);
    expect((await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", "/api/pemda/solar-applications?regionId=samarinda", pemda.cookie))).items).toHaveLength(3);
    expect((await ok<ApplicationPage<PemdaApplicationSummary>>(call(s, "GET", "/api/pemda/solar-applications?status=verified", pemda.cookie))).items).toHaveLength(0);
    expect(await code(call(s, "GET", "/api/pemda/solar-applications?status=selesai", pemda.cookie))).toEqual({ status: 400, code: "validation" });
  });

  test("two officers acting on one version: one wins, the other gets version_conflict", async () => {
    const s = start();
    const a = await sent(s);
    const p1 = await s.fake.signIn("pemda");
    const p2 = await s.fake.signIn("pemda");
    const [r1, r2] = await Promise.all([
      act(s, "pemda", a.app.id, p1.cookie, { action: "start_review", expectedVersion: 1 }),
      act(s, "pemda", a.app.id, p2.cookie, { action: "start_review", expectedVersion: 1 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(s.fake.applications.get(a.app.id)!.events).toHaveLength(2);
  });
});
