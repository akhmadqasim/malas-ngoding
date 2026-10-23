import type { BunRequest } from "bun";
import {
  type ApplicationAnswer,
  type ApplicationFileAnswer,
  type ApplicationPage,
  MAX_FILE_BYTES,
  type PemdaApplicationSummary,
  type PemdaSolarApplication,
  type SolarApplicationSummary,
} from "../../shared/applications.ts";
import type { User } from "../../shared/auth.ts";
import { type ApplicationFailure, type ApplicationRecord, FILES_INVALID } from "../db.ts";
import { type Handler, error, failure, json } from "../http.ts";
import type { AppDeps } from "../index.ts";
import {
  buildDraft,
  buildEstimate,
  citizenSummary,
  citizenView,
  decideAction,
  decidePatch,
  decodeCursor,
  encodeCursor,
  isFileKind,
  isUuid,
  parseActionInput,
  parseCreateInput,
  parseLimit,
  parsePatchInput,
  parseStatuses,
  patchedPanelCount,
  pemdaSummaryItem,
  pemdaView,
  requestHash,
  sniffImage,
} from "../services/applications.ts";
import { createRateLimiter, rateLimited } from "../services/rateLimit.ts";
import { currentUser, readJson, requireRole, sameOriginProblem } from "../services/session.ts";

// Rooftop PV installation reports (contract: src/shared/applications.ts, flow: docs/plans/
// 2026-10-23-solar-verification-api.md). A resident sees and changes only their own reports; another
// resident's report answers 404, as if it did not exist. The government sees every report.

/** JSON bodies here are small; a bigger one is refused before it is read. */
const MAX_JSON_BYTES = 32 * 1024;
export const CREATE_LIMIT = { limit: 10, windowMs: 60_000 };
export const UPLOAD_LIMIT = { limit: 30, windowMs: 60_000 };

type Routes = Record<string, Partial<Record<"GET" | "POST" | "PATCH", Handler>>>;

const notFound = () => failure({ status: 404, code: "not_found", message: "Laporan tidak ditemukan." });
const invalid = (message: string) => failure({ status: 400, code: "validation", message });
const tooLarge = (req: Request, max: number) => Number(req.headers.get("content-length") ?? 0) > max;
const param = (req: Request, name: string): string => ((req as BunRequest).params as Record<string, string>)[name] ?? "";

/** The friendly 500, as the other route modules do. */
function safely(handler: Handler): Handler {
  return async (req, server) => {
    try {
      return await handler(req, server);
    } catch (err) {
      console.error(`${req.method} ${new URL(req.url).pathname} failed:`, err instanceof Error ? err.message : "unknown error");
      return error("Terjadi kesalahan di server. Coba lagi sebentar lagi.", 500);
    }
  };
}

/** Origin check (for writes), then the role; the handler gets the user. */
function as(deps: AppDeps, role: User["role"], write: boolean, handler: (req: Request, user: User, server: Parameters<Handler>[1]) => Promise<Response>): Handler {
  return safely(async (req, server) => {
    if (write) {
      const origin = sameOriginProblem(req);
      if (origin) return origin;
    }
    const auth = await requireRole(deps.db, req, role);
    if ("res" in auth) return auth.res;
    return handler(req, auth.user, server);
  });
}

/** A JSON body under the size limit, or the 400/413 answer. */
async function body(req: Request): Promise<{ body: unknown } | { res: Response }> {
  if (tooLarge(req, MAX_JSON_BYTES)) return { res: failure({ status: 413, code: "validation", message: "Isi permintaan terlalu besar." }) };
  return readJson(req);
}

/** The resident's own report by the :id in the path, or null (unknown id or someone else's). */
async function ownReport(deps: AppDeps, req: Request, user: User): Promise<ApplicationRecord | null> {
  const id = param(req, "id");
  if (!isUuid(id)) return null;
  const app = await deps.db.applicationGet(id.toLowerCase());
  return app && app.userId === user.id ? app : null;
}

/** Photos named in a request must be the user's own and not yet attached. */
async function ownPendingFiles(deps: AppDeps, user: User, ids: string[]) {
  const metas = await deps.db.applicationFilesMeta(ids);
  const ok = metas.length === ids.length && metas.every((f) => f.userId === user.id && f.applicationId === null);
  return ok ? metas : null;
}

const answer = <T>(application: T, status = 200) => json({ application } satisfies ApplicationAnswer<T>, status);
const fromFailure = (f: ApplicationFailure) => failure(f);

export function applicationRoutes(deps: AppDeps): Routes {
  const createLimiter = createRateLimiter(CREATE_LIMIT);
  const uploadLimiter = createRateLimiter(UPLOAD_LIMIT);

  return {
    // ---------- resident ----------
    "/api/me/solar-applications": {
      GET: as(deps, "warga", false, async (req, user) => {
        const url = new URL(req.url);
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        const limit = parseLimit(url.searchParams.get("limit"));
        if (cursor === undefined) return invalid("cursor tidak valid.");
        if (limit === undefined) return invalid("limit harus bilangan bulat 1 sampai 50.");
        const rows = await deps.db.applicationList({ userId: user.id, beforeSeq: cursor ?? undefined, limit: limit + 1 });
        const page: ApplicationPage<SolarApplicationSummary> = {
          items: rows.slice(0, limit).map(citizenSummary),
          nextCursor: rows.length > limit ? encodeCursor(rows[limit - 1]!.seq) : null,
        };
        return json(page);
      }),
      POST: as(deps, "warga", true, async (req, user, server) => {
        const limited = rateLimited(createLimiter, req, server);
        if (limited) return limited;
        const key = req.headers.get("idempotency-key");
        if (!isUuid(key)) {
          return failure({ status: 400, code: "idempotency_key_required", message: "Header Idempotency-Key berupa UUID wajib dikirim." });
        }
        const b = await body(req);
        if ("res" in b) return b.res;
        const parsed = parseCreateInput(b.body);
        if ("problem" in parsed) return invalid(parsed.problem);
        const { input } = parsed;

        const home = await deps.db.homeGet(user.id);
        if (!home) return failure({ status: 409, code: "home_missing", message: "Tandai rumah Anda di peta dulu sebelum melaporkan pemasangan." });
        const metas = await deps.db.applicationFilesMeta(input.fileIds);
        // A retry after success finds its photos attached already; the database answers with the stored report.
        const ownFiles = metas.length === input.fileIds.length && metas.every((f) => f.userId === user.id);
        if (!ownFiles) return fromFailure(FILES_INVALID);
        if (!metas.some((f) => f.kind === "installation")) {
          return invalid("Lampirkan minimal satu foto panel terpasang (kind: installation).");
        }

        const result = await deps.db.applicationCreate({
          userId: user.id,
          idempotencyKey: key.toLowerCase(),
          requestHash: requestHash(input),
          homeUpdatedAt: input.expectedHomeUpdatedAt,
          draft: await buildDraft(deps, home, input),
          fileIds: input.fileIds,
          event: { action: "create", title: "Laporan pemasangan dikirim", publicNote: null, internalNote: null, actorUserId: user.id, actorRole: "warga" },
        });
        switch (result.kind) {
          case "created":
            return answer(citizenView(result.app), 201);
          case "replayed":
            return answer(citizenView(result.app), 200);
          case "idempotency_mismatch":
            return failure({ status: 409, code: "idempotency_mismatch", message: "Idempotency-Key ini sudah dipakai untuk isi laporan yang berbeda." });
          case "active_exists":
            return failure({ status: 409, code: "active_application_exists", message: "Anda masih punya laporan yang sedang diproses. Selesaikan atau batalkan dulu." });
          case "home_missing":
            return failure({ status: 409, code: "home_missing", message: "Tandai rumah Anda di peta dulu sebelum melaporkan pemasangan." });
          case "home_changed":
            return failure({ status: 409, code: "home_changed", message: "Data rumah berubah sejak formulir dibuka. Muat ulang lalu periksa ringkasannya." });
          case "files_invalid":
            return fromFailure(FILES_INVALID);
        }
      }),
    },
    "/api/me/solar-applications/:id": {
      GET: as(deps, "warga", false, async (req, user) => {
        const app = await ownReport(deps, req, user);
        return app ? answer(citizenView(app)) : notFound();
      }),
      PATCH: as(deps, "warga", true, async (req, user) => {
        const app = await ownReport(deps, req, user);
        if (!app) return notFound();
        const b = await body(req);
        if ("res" in b) return b.res;
        const parsed = parsePatchInput(b.body);
        if ("problem" in parsed) return invalid(parsed.problem);
        const { input } = parsed;
        if (input.addFileIds.length && !(await ownPendingFiles(deps, user, input.addFileIds))) return fromFailure(FILES_INVALID);
        const count = patchedPanelCount(app, input);
        const estimate = count !== null && count !== app.report.panelCount ? await buildEstimate(deps, app.homeSnapshot, count) : null;
        const result = await deps.db.applicationUpdate(app.id, input.expectedVersion, (locked) => decidePatch(locked, input, user, estimate));
        if (!result) return notFound();
        return "fail" in result ? fromFailure(result.fail) : answer(citizenView(result.app));
      }),
    },
    "/api/me/solar-applications/:id/actions": {
      POST: as(deps, "warga", true, async (req, user) => {
        const app = await ownReport(deps, req, user);
        if (!app) return notFound();
        const b = await body(req);
        if ("res" in b) return b.res;
        const parsed = parseActionInput(b.body, "warga");
        if ("problem" in parsed) return invalid(parsed.problem);
        const result = await deps.db.applicationUpdate(app.id, parsed.input.expectedVersion, (locked) => decideAction(locked, parsed.input, user));
        if (!result) return notFound();
        return "fail" in result ? fromFailure(result.fail) : answer(citizenView(result.app));
      }),
    },
    "/api/me/solar-application-files": {
      POST: as(deps, "warga", true, async (req, user, server) => {
        const limited = rateLimited(uploadLimiter, req, server);
        if (limited) return limited;
        if (tooLarge(req, MAX_FILE_BYTES + 64 * 1024)) {
          return failure({ status: 413, code: "file_too_large", message: "Ukuran foto paling besar 5 MB." });
        }
        const type = (req.headers.get("content-type") ?? "").toLowerCase();
        if (!type.startsWith("multipart/form-data")) return invalid("Kirim foto sebagai multipart/form-data dengan kolom kind dan file.");
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          return invalid("Isi unggahan tidak dapat dibaca.");
        }
        const kind = form.get("kind");
        const file = form.get("file");
        if (!isFileKind(kind)) return invalid('Jenis foto (kind) harus "installation", "pln_approval", "compliance", atau "other".');
        if (!(file instanceof Blob) || file.size === 0) return invalid("Pilih satu foto (kolom file).");
        if (file.size > MAX_FILE_BYTES) return failure({ status: 413, code: "file_too_large", message: "Ukuran foto paling besar 5 MB." });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const contentType = sniffImage(bytes);
        if (!contentType) return failure({ status: 415, code: "file_type", message: "Foto harus berformat JPEG, PNG, atau WebP." });
        const meta = await deps.db.applicationFileCreate({ userId: user.id, kind, contentType, bytes });
        if (!meta) return failure({ status: 429, code: "files_invalid", message: "Terlalu banyak foto yang belum dikirim. Kirim laporan dulu atau coba lagi besok." });
        const out: ApplicationFileAnswer = {
          file: { id: meta.id, kind: meta.kind, contentType: meta.contentType, sizeBytes: meta.sizeBytes, createdAt: meta.createdAt, url: `/api/solar-application-files/${meta.id}` },
        };
        return json(out, 201);
      }),
    },

    // ---------- photos (owner, or the government once attached to a report) ----------
    "/api/solar-application-files/:id": {
      GET: safely(async (req) => {
        const user = await currentUser(deps.db, req);
        if (!user) return error("Silakan masuk dulu.", 401);
        const id = param(req, "id");
        const file = isUuid(id) ? await deps.db.applicationFileGet(id.toLowerCase()) : null;
        const visible = file && (user.role === "pemda" ? file.applicationId !== null : file.userId === user.id);
        if (!file || !visible) return failure({ status: 404, code: "not_found", message: "Foto tidak ditemukan." });
        return new Response(new Uint8Array(file.bytes), {
          headers: {
            "content-type": file.contentType,
            "cache-control": "private, max-age=3600",
            "x-content-type-options": "nosniff",
            "content-disposition": "inline",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      }),
    },

    // ---------- government ----------
    "/api/pemda/solar-applications": {
      GET: as(deps, "pemda", false, async (req) => {
        const url = new URL(req.url);
        const statuses = parseStatuses(url.searchParams.get("status"));
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        const limit = parseLimit(url.searchParams.get("limit"));
        const q = (url.searchParams.get("q") ?? "").trim();
        const regionId = (url.searchParams.get("regionId") ?? "").trim();
        if (statuses === undefined) return invalid("status tidak dikenal.");
        if (cursor === undefined) return invalid("cursor tidak valid.");
        if (limit === undefined) return invalid("limit harus bilangan bulat 1 sampai 50.");
        if (q.length > 60 || regionId.length > 60) return invalid("Pencarian paling panjang 60 karakter.");
        const rows = await deps.db.applicationList({
          statuses: statuses ?? undefined,
          regionId: regionId || undefined,
          q: q || undefined,
          beforeSeq: cursor ?? undefined,
          limit: limit + 1,
        });
        const page: ApplicationPage<PemdaApplicationSummary> = {
          items: rows.slice(0, limit).map(pemdaSummaryItem),
          nextCursor: rows.length > limit ? encodeCursor(rows[limit - 1]!.seq) : null,
        };
        return json(page);
      }),
    },
    "/api/pemda/solar-applications/:id": {
      GET: as(deps, "pemda", false, async (req) => {
        const id = param(req, "id");
        const app = isUuid(id) ? await deps.db.applicationGet(id.toLowerCase()) : null;
        return app ? answer<PemdaSolarApplication>(pemdaView(app)) : notFound();
      }),
    },
    "/api/pemda/solar-applications/:id/actions": {
      POST: as(deps, "pemda", true, async (req, user) => {
        const id = param(req, "id");
        if (!isUuid(id)) return notFound();
        const b = await body(req);
        if ("res" in b) return b.res;
        const parsed = parseActionInput(b.body, "pemda");
        if ("problem" in parsed) return invalid(parsed.problem);
        const result = await deps.db.applicationUpdate(id.toLowerCase(), parsed.input.expectedVersion, (locked) => decideAction(locked, parsed.input, user));
        if (!result) return notFound();
        return "fail" in result ? fromFailure(result.fail) : answer<PemdaSolarApplication>(pemdaView(result.app));
      }),
    },
  };
}
