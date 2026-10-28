import { createHash, randomBytes } from "node:crypto";
import type { Role, User } from "../../shared/auth.ts";
import { error } from "../http.ts";
import type { AppDeps } from "../index.ts";

// Sessions, passwords and the checks every state-changing account route shares.
//
// A session is a random 32-byte token in the `malas_session` cookie (HttpOnly, SameSite=Lax). The database
// keeps only its sha256, so a leaked table cannot be replayed as cookies. SameSite=Lax plus the Origin check
// below (`sameOriginProblem`) is the CSRF defence for the POST/PUT/DELETE routes.

export const COOKIE_NAME = "malas_session";
export const SESSION_DAYS = 7;
const SESSION_SECONDS = SESSION_DAYS * 24 * 3600;

export type SessionDb = Pick<AppDeps["db"], "sessionCreate" | "sessionUser" | "sessionDelete">;

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Starts a session for the user; the token goes into the cookie, only its hash into the database. */
export async function createSession(db: SessionDb, userId: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await db.sessionCreate(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

/** The Set-Cookie value that carries the session. `Secure` only in production, where the site is https. */
export function sessionCookie(token: string, nodeEnv = Bun.env.NODE_ENV): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}${nodeEnv === "production" ? "; Secure" : ""}`;
}

/** The Set-Cookie value that removes the session cookie. */
export function clearedCookie(nodeEnv = Bun.env.NODE_ENV): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${nodeEnv === "production" ? "; Secure" : ""}`;
}

/** The session token in the request's Cookie header, or null. */
export function sessionToken(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE_NAME) {
      const value = part.slice(eq + 1).trim();
      return value === "" ? null : value;
    }
  }
  return null;
}

/** The signed-in user of the request, or null (no cookie, unknown or expired session). */
export async function currentUser(db: SessionDb, req: Request): Promise<User | null> {
  const token = sessionToken(req);
  return token ? db.sessionUser(hashToken(token)) : null;
}

/** Ends the request's session, if it has one. */
export async function endSession(db: SessionDb, req: Request): Promise<void> {
  const token = sessionToken(req);
  if (token) await db.sessionDelete(hashToken(token));
}

/** The signed-in user when they have the role, otherwise the 401 (signed out) or 403 (other role) response. */
export async function requireRole(db: SessionDb, req: Request, role: Role): Promise<{ user: User } | { res: Response }> {
  const user = await currentUser(db, req);
  if (!user) return { res: error("Silakan masuk dulu.", 401) };
  if (user.role !== role) {
    return { res: error(role === "pemda" ? "Halaman ini hanya untuk akun pemerintah daerah." : "Halaman ini hanya untuk akun warga.", 403) };
  }
  return { user };
}

// ---------- request checks ----------

/**
 * A 403 response when the request names another origin than the one it was sent to (a form on some other
 * site posting with the visitor's cookie), otherwise null. Requests without an Origin header (curl, tests,
 * same-origin GET) pass; browsers always send it on cross-site POST, PUT and DELETE.
 */
export function sameOriginProblem(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin === null) return null;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    // "null" or garbage: not our page.
  }
  const own = req.headers.get("host") ?? new URL(req.url).host;
  return host === own ? null : error("Permintaan ditolak karena berasal dari situs lain.", 403);
}

/** The JSON body, or the 400 response when the content type is not JSON or the body does not parse. */
export async function readJson(req: Request): Promise<{ body: unknown } | { res: Response }> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return { res: error("Permintaan harus berformat JSON (Content-Type: application/json).", 400) };
  try {
    return { body: await req.json() };
  } catch {
    return { res: error("Isi permintaan bukan JSON yang valid.", 400) };
  }
}

// ---------- passwords and account fields ----------

export const MIN_PASSWORD = 8;
/** Longer passwords are refused so one request cannot make the server hash a huge string. */
export const MAX_PASSWORD = 200;
const MAX_EMAIL = 254;
const MAX_NAME = 80;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, { algorithm: "argon2id" });

/** False for a wrong password and for a stored value that is not a valid hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Verifies against a throwaway hash, so a login for an unknown email costs about as much as a wrong password. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("tidak-pernah-dipakai");
  await verifyPassword(password, await dummyHash);
}

/** The email trimmed and lower-cased, or null when it does not look like an email. */
export function parseEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  return email.length <= MAX_EMAIL && EMAIL_SHAPE.test(email) ? email : null;
}

/** The name trimmed (1 to 80 characters), or null. */
export function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.trim();
  return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
