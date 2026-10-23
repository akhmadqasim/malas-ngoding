import type { AuthAnswer, Role, User } from "../../shared/auth.ts";
import type { AppDeps } from "../index.ts";
import { type Handler, error } from "../http.ts";
import { type RateLimiter, createRateLimiter, rateLimited } from "../services/rateLimit.ts";
import {
  MAX_PASSWORD,
  MIN_PASSWORD,
  burnPasswordCheck,
  clearedCookie,
  createSession,
  currentUser,
  endSession,
  hashPassword,
  isObject,
  parseEmail,
  parseName,
  readJson,
  sameOriginProblem,
  sessionCookie,
  verifyPassword,
} from "../services/session.ts";

/** The seeded demo accounts (scripts/seed.ts); POST /api/auth/demo signs in as one of them. */
export const DEMO_EMAILS: Record<Role, string> = { warga: "demo@warga.local", pemda: "demo@pemda.local" };

const WRONG_LOGIN = "Email atau kata sandi salah.";
/** Register, login and demo share one budget per client address: about 10 a minute. */
export const AUTH_LIMIT = { limit: 10, windowMs: 60_000 };

/** Only what the web app may see of a user: never the password hash. */
const publicUser = (u: User): User => ({ id: u.id, name: u.name, email: u.email, role: u.role });

/** An AuthAnswer response, with the session cookie when `token` is given. */
function answer(user: User | null, status = 200, cookie?: string): Response {
  const body: AuthAnswer = { user: user ? publicUser(user) : null };
  return Response.json(body, { status, headers: cookie ? { "Set-Cookie": cookie } : undefined });
}

async function signIn(deps: AppDeps, user: User, status = 200): Promise<Response> {
  const { token } = await createSession(deps.db, user.id);
  return answer(user, status, sessionCookie(token));
}

/**
 * Wraps a state-changing handler: Origin check first, then the shared rate limit when given. Errors become
 * the usual friendly 500.
 */
function guarded(limiter: RateLimiter | null, handler: Handler): Handler {
  return async (req, server) => {
    const origin = sameOriginProblem(req);
    if (origin) return origin;
    const limited = limiter ? rateLimited(limiter, req, server) : null;
    if (limited) return limited;
    try {
      return await handler(req, server);
    } catch (err) {
      console.error(`${req.method} ${new URL(req.url).pathname} failed:`, err instanceof Error ? err.message : "unknown error");
      return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
    }
  };
}

export function authRoutes(deps: AppDeps, opts: { demoLogin: boolean }) {
  const limiter = createRateLimiter(AUTH_LIMIT);
  return {
    "/api/auth/register": {
      POST: guarded(limiter, async (req) => {
        const parsed = await readJson(req);
        if ("res" in parsed) return parsed.res;
        const b = isObject(parsed.body) ? parsed.body : {};
        const name = parseName(b.name);
        if (name === null) return error("Nama harus berisi 1 sampai 80 karakter.", 400);
        const email = parseEmail(b.email);
        if (email === null) return error("Format email tidak valid.", 400);
        const password = b.password;
        if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
          return error(`Kata sandi harus berisi ${MIN_PASSWORD} sampai ${MAX_PASSWORD} karakter.`, 400);
        }
        const user = await deps.db.createUser({ email, name, passwordHash: await hashPassword(password), role: "warga" });
        if (!user) return error("Email ini sudah terdaftar. Silakan masuk.", 409);
        return signIn(deps, user, 201);
      }),
    },
    "/api/auth/login": {
      POST: guarded(limiter, async (req) => {
        const parsed = await readJson(req);
        if ("res" in parsed) return parsed.res;
        const b = isObject(parsed.body) ? parsed.body : {};
        const email = parseEmail(b.email);
        const password = typeof b.password === "string" && b.password.length <= MAX_PASSWORD ? b.password : null;
        if (email === null || password === null) {
          if (password !== null) await burnPasswordCheck(password);
          return error(WRONG_LOGIN, 401);
        }
        const record = await deps.db.userByEmail(email);
        if (!record) {
          await burnPasswordCheck(password);
          return error(WRONG_LOGIN, 401);
        }
        if (!(await verifyPassword(password, record.passwordHash))) return error(WRONG_LOGIN, 401);
        return signIn(deps, record);
      }),
    },
    "/api/auth/demo": {
      POST: guarded(limiter, async (req) => {
        if (!opts.demoLogin) return error("Masuk demo tidak tersedia.", 404);
        const parsed = await readJson(req);
        if ("res" in parsed) return parsed.res;
        const role = isObject(parsed.body) ? parsed.body.role : undefined;
        if (role !== "warga" && role !== "pemda") return error('Peran (role) harus "warga" atau "pemda".', 400);
        const record = await deps.db.userByEmail(DEMO_EMAILS[role]);
        if (!record || !record.demo || record.role !== role) return error("Akun demo belum tersedia. Jalankan `bun run seed`.", 404);
        return signIn(deps, record);
      }),
    },
    "/api/auth/logout": {
      POST: guarded(null, async (req) => {
        await endSession(deps.db, req);
        return new Response(null, { status: 204, headers: { "Set-Cookie": clearedCookie() } });
      }),
    },
    "/api/auth/me": {
      GET: async (req: Parameters<Handler>[0]) => {
        try {
          return answer(await currentUser(deps.db, req));
        } catch (err) {
          console.error("GET /api/auth/me failed:", err instanceof Error ? err.message : "unknown error");
          return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
        }
      },
    },
  };
}
