import { afterAll, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { createServer } from "../../src/server/index.ts";
import { AUTH_LIMIT } from "../../src/server/routes/auth.ts";
import { clearedCookie, hashToken, parseEmail, sessionCookie } from "../../src/server/services/session.ts";
import type { AuthAnswer } from "../../src/shared/auth.ts";
import { type FakeDeps, fakeDeps } from "./fakes.ts";

const servers: Server<undefined>[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
});

function start(opts: { demoLogin?: boolean } = {}): { server: Server<undefined>; fake: FakeDeps } {
  const fake = fakeDeps();
  const server = createServer({ port: 0, deps: fake.deps, demoLogin: opts.demoLogin ?? true });
  servers.push(server);
  return { server, fake };
}

const JSON_HEADERS = { "content-type": "application/json" };
const post = (s: Server<undefined>, path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  fetch(new URL(path, s.url), { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const me = (s: Server<undefined>, cookie?: string) =>
  fetch(new URL("/api/auth/me", s.url), { headers: cookie ? { cookie } : {} });

/** "malas_session=TOKEN" from a response's Set-Cookie, or null. */
function cookieOf(res: Response): string | null {
  const set = res.headers.get("set-cookie");
  return set ? (set.split(";")[0] ?? null) : null;
}

const PERSON = { name: "Siti Aminah", email: "Siti@Example.com", password: "kata-sandi-aman" };

describe("register, login, me, logout", () => {
  test("a full round trip: register signs in, me reads the cookie, logout ends it, login signs in again", async () => {
    const { server, fake } = start();
    const reg = await post(server, "/api/auth/register", PERSON);
    expect(reg.status).toBe(201);
    const regBody = (await reg.json()) as AuthAnswer;
    expect(regBody.user).toMatchObject({ name: "Siti Aminah", email: "siti@example.com", role: "warga" });
    expect(JSON.stringify(regBody)).not.toContain("passwordHash");
    expect(JSON.stringify(regBody)).not.toContain("password_hash");

    const set = reg.headers.get("set-cookie")!;
    expect(set).toContain("malas_session=");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain(`Max-Age=${7 * 24 * 3600}`);
    const cookie = cookieOf(reg)!;

    // The database keeps the hash of the token, never the token.
    const token = cookie.split("=")[1]!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify([...fake.users.values()])).not.toContain(token);
    expect((await me(server, cookie).then((r) => r.json())) as AuthAnswer).toEqual(regBody);

    // The stored password is an argon2id hash, not the password.
    const stored = [...fake.users.values()][0]!;
    expect(stored.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(stored.passwordHash).not.toContain(PERSON.password);

    const out = await post(server, "/api/auth/logout", "", { cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(((await (await me(server, cookie)).json()) as AuthAnswer).user).toBeNull();

    const login = await post(server, "/api/auth/login", { email: "SITI@example.com ", password: PERSON.password });
    expect(login.status).toBe(200);
    const again = cookieOf(login)!;
    expect(((await (await me(server, again)).json()) as AuthAnswer).user?.email).toBe("siti@example.com");
  });

  test("me without a cookie, with a garbage cookie or an expired session answers user null", async () => {
    const { server, fake } = start();
    expect(await (await me(server)).json()).toEqual({ user: null });
    expect(await (await me(server, "malas_session=nope")).json()).toEqual({ user: null });
    // An expired session no longer signs anyone in.
    const { cookie, user } = await fake.signIn("warga");
    expect(((await (await me(server, cookie)).json()) as AuthAnswer).user?.id).toBe(user.id);
    await fake.deps.db.sessionCreate(hashToken("old"), user.id, new Date(Date.now() - 1000));
    expect(await (await me(server, "malas_session=old")).json()).toEqual({ user: null });
  });

  test("a wrong password and an unknown email both answer the same generic 401", async () => {
    const { server } = start();
    await post(server, "/api/auth/register", PERSON);
    const wrong = await post(server, "/api/auth/login", { email: PERSON.email, password: "salah-sekali" });
    const unknown = await post(server, "/api/auth/login", { email: "tidak-ada@example.com", password: "salah-sekali" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const a = (await wrong.json()) as { error: string };
    const b = (await unknown.json()) as { error: string };
    expect(a.error.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  test("a duplicate email (in any case) is a 409", async () => {
    const { server } = start();
    expect((await post(server, "/api/auth/register", PERSON)).status).toBe(201);
    const dup = await post(server, "/api/auth/register", { ...PERSON, email: "SITI@EXAMPLE.COM", name: "Lain" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error.length).toBeGreaterThan(0);
  });

  test.each([
    ["no name", { ...PERSON, name: "  " }],
    ["a name over 80 characters", { ...PERSON, name: "a".repeat(81) }],
    ["a bad email", { ...PERSON, email: "bukan-email" }],
    ["a short password", { ...PERSON, password: "pendek1" }],
    ["a password over 200 characters", { ...PERSON, password: "p".repeat(201) }],
    ["a non-string password", { ...PERSON, password: 12345678 }],
    ["a body that is not an object", [1, 2]],
  ])("register with %s is a 400", async (_what, body) => {
    const { server, fake } = start();
    const res = await post(server, "/api/auth/register", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.users.size).toBe(0);
  });

  test("register always makes a resident, whatever role the body asks for", async () => {
    const { server } = start();
    const res = await post(server, "/api/auth/register", { ...PERSON, role: "pemda" });
    expect(((await res.json()) as AuthAnswer).user?.role).toBe("warga");
  });

  test("a body that is not JSON, or sent with another content type, is a 400", async () => {
    const { server } = start();
    expect((await post(server, "/api/auth/register", "{nope")).status).toBe(400);
    expect((await post(server, "/api/auth/login", JSON.stringify(PERSON), { "content-type": "text/plain" })).status).toBe(400);
    expect((await post(server, "/api/auth/login", JSON.stringify(PERSON), {})).status).toBe(400);
  });

  test("a demo account cannot sign in with a password", async () => {
    const { server, fake } = start();
    fake.addUser({ email: "demo@warga.local", name: "Warga Demo", role: "warga", demo: true, passwordHash: "bukan-hash" });
    const res = await post(server, "/api/auth/login", { email: "demo@warga.local", password: "apa-saja-1234" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/demo", () => {
  function seeded(opts: { demoLogin?: boolean } = {}) {
    const s = start(opts);
    s.fake.addUser({ email: "demo@warga.local", name: "Warga Demo", role: "warga", demo: true });
    s.fake.addUser({ email: "demo@pemda.local", name: "Pemda Demo Kaltim", role: "pemda", demo: true });
    return s;
  }

  test.each(["warga", "pemda"] as const)("signs in as the demo %s", async (role) => {
    const { server } = seeded();
    const res = await post(server, "/api/auth/demo", { role });
    expect(res.status).toBe(200);
    const cookie = cookieOf(res)!;
    expect(((await res.json()) as AuthAnswer).user?.role).toBe(role);
    expect(((await (await me(server, cookie)).json()) as AuthAnswer).user?.email).toBe(`demo@${role}.local`);
  });

  test("is a 404 when DEMO_LOGIN is off", async () => {
    const { server } = seeded({ demoLogin: false });
    const res = await post(server, "/api/auth/demo", { role: "warga" });
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("is a 404 when the demo accounts are not seeded, and a 400 for an unknown role", async () => {
    const { server } = start();
    expect((await post(server, "/api/auth/demo", { role: "warga" })).status).toBe(404);
    const { server: s2 } = seeded();
    expect((await post(s2, "/api/auth/demo", { role: "admin" })).status).toBe(400);
    expect((await post(s2, "/api/auth/demo", {})).status).toBe(400);
  });

  test("does not sign in a non-demo account that has the demo email", async () => {
    const { server, fake } = start();
    fake.addUser({ email: "demo@pemda.local", name: "Bukan demo", role: "pemda", demo: false });
    expect((await post(server, "/api/auth/demo", { role: "pemda" })).status).toBe(404);
  });
});

describe("same-origin guard", () => {
  test("a POST naming another origin is a 403 and does nothing", async () => {
    const { server, fake } = start();
    const res = await post(server, "/api/auth/register", PERSON, { ...JSON_HEADERS, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
    expect(fake.users.size).toBe(0);
    expect((await post(server, "/api/auth/logout", "", { origin: "null" })).status).toBe(403);
  });

  test("a POST from the server's own origin passes", async () => {
    const { server } = start();
    const res = await post(server, "/api/auth/register", PERSON, { ...JSON_HEADERS, origin: server.url.origin });
    expect(res.status).toBe(201);
  });

  test("logout from another origin does not end the session", async () => {
    const { server, fake } = start();
    const { cookie } = await fake.signIn("warga");
    const res = await post(server, "/api/auth/logout", "", { cookie, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(((await (await me(server, cookie)).json()) as AuthAnswer).user).not.toBeNull();
  });
});

describe("rate limit", () => {
  test("the 11th attempt in a minute is a 429 with Retry-After, shared by register, login and demo", async () => {
    const { server } = start();
    expect(AUTH_LIMIT.limit).toBe(10);
    for (let i = 0; i < 10; i++) {
      const path = ["/api/auth/login", "/api/auth/demo", "/api/auth/register"][i % 3]!;
      const res = await post(server, path, { email: "x@example.com", password: "salah-sekali", role: "warga" });
      expect(res.status).not.toBe(429);
    }
    const res = await post(server, "/api/auth/login", { email: "x@example.com", password: "salah-sekali" });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Terlalu banyak percobaan. Coba lagi sebentar lagi." });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Reading who is signed in is not limited.
    expect((await me(server)).status).toBe(200);
  });
});

describe("session helpers", () => {
  test("the cookie is Secure only in production", () => {
    expect(sessionCookie("abc", "production")).toContain("; Secure");
    expect(sessionCookie("abc", "development")).not.toContain("Secure");
    expect(sessionCookie("abc", undefined)).not.toContain("Secure");
    expect(clearedCookie("production")).toContain("; Secure");
    expect(clearedCookie("production")).toContain("Max-Age=0");
  });

  test("parseEmail trims, lower-cases and checks the shape", () => {
    expect(parseEmail("  A@B.co ")).toBe("a@b.co");
    for (const bad of ["a@b", "a b@c.d", "@b.co", "a@@b.co", 5, null, `${"a".repeat(250)}@b.co`]) expect(parseEmail(bad)).toBeNull();
  });
});
