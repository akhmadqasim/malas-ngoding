import { createHash } from "node:crypto";
import {
  ACTION_RULES,
  APPLICATION_STATUSES,
  CONTACT_WINDOWS,
  FILE_KINDS,
  MAX_FILES_PER_APPLICATION,
  type ApplicationAction,
  type ApplicationActionInput,
  type ApplicationContact,
  type ApplicationEvent,
  type ApplicationFile,
  type ApplicationStatus,
  type ComplianceType,
  type ContactWindow,
  type EstimateSnapshot,
  type FileKind,
  type HomeSnapshot,
  type InstallationReport,
  type Ownership,
  type PemdaApplicationSummary,
  type PemdaSolarApplication,
  type SolarApplication,
  type SolarApplicationSummary,
  allowedActions,
  hasComplianceEvidence,
} from "../../shared/applications.ts";
import type { Home, Role } from "../../shared/auth.ts";
import { SOLAR_MODEL_VERSION } from "../../shared/solar.ts";
import type { ApplicationDecision, ApplicationDraft, ApplicationFailure, ApplicationRecord } from "../db.ts";
import type { AppDeps } from "../index.ts";
import { simulateSolarAt } from "../routes/solar.ts";
import { isObject } from "./session.ts";

// Validation, transitions and views of solar installation reports. Everything here is pure except
// `buildDraft` (it asks the solar simulation for the estimate), so the routes, the database transaction and
// the test fakes all apply the same rules.

const MAX_KWP = 10_000;
const MAX_PANELS = 20_000;
const MAX_NOTES = 500;
const MAX_PUBLIC_NOTE = 500;
const MAX_INTERNAL_NOTE = 1000;
const MAX_DOC_NUMBER = 60;
/** Longest survey visit, and how far ahead one may be booked. */
const MAX_SURVEY_MS = 12 * 3600_000;
const MAX_SURVEY_AHEAD_MS = 365 * 24 * 3600_000;
/** WITA is UTC+8 all year (no daylight saving). */
const WITA_OFFSET_MS = 8 * 3600_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
type Problem = { problem: string };

/** Trimmed text of min..max characters, or null. */
function text(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}

/** Optional text: undefined/null/"" give null; too long or not text gives undefined. */
function optText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t === "" ? null : t;
}

/** An Indonesian mobile or landline number as 08..., 0xx...; accepts +62, 62, spaces, dots and dashes. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let d = v.replace(/[\s.()-]/g, "");
  if (d.startsWith("+62")) d = `0${d.slice(3)}`;
  else if (d.startsWith("62")) d = `0${d.slice(2)}`;
  return /^0\d{8,12}$/.test(d) ? d : null;
}

/** Today's date in WITA, YYYY-MM-DD. */
export const todayWita = (now: Date): string => new Date(now.getTime() + WITA_OFFSET_MS).toISOString().slice(0, 10);

function parseDay(v: unknown, now: Date): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return v >= "2000-01-01" && v <= todayWita(now) ? v : null;
}

/** The report and contact fields shared by create and edit (edit validates the merged result). */
interface ReportFields {
  installedKwp: unknown;
  panelCount: unknown;
  installedOn: unknown;
  installerName: unknown;
  plnApprovalNumber: unknown;
  complianceType: unknown;
  complianceNumber: unknown;
  contactName: unknown;
  phone: unknown;
  ownership: unknown;
  ownerPermissionConfirmed: unknown;
  preferredContactWindow: unknown;
  notes: unknown;
}
const REPORT_KEYS: (keyof ReportFields)[] = [
  "installedKwp", "panelCount", "installedOn", "installerName", "plnApprovalNumber", "complianceType", "complianceNumber",
  "contactName", "phone", "ownership", "ownerPermissionConfirmed", "preferredContactWindow", "notes",
];

function parseReportFields(b: ReportFields, now: Date): { report: InstallationReport; contact: ApplicationContact } | Problem {
  if (!isNum(b.installedKwp) || b.installedKwp <= 0 || b.installedKwp > MAX_KWP) {
    return { problem: "Kapasitas terpasang (installedKwp) harus lebih dari 0 sampai 10.000 kWp." };
  }
  if (!isNum(b.panelCount) || !Number.isInteger(b.panelCount) || b.panelCount < 1 || b.panelCount > MAX_PANELS) {
    return { problem: "Jumlah panel (panelCount) harus bilangan bulat 1 sampai 20.000." };
  }
  const installedOn = parseDay(b.installedOn, now);
  if (!installedOn) return { problem: "Tanggal selesai pasang (installedOn) harus berformat YYYY-MM-DD dan tidak di masa depan." };
  const installerName = text(b.installerName, 2, 120);
  if (!installerName) return { problem: "Nama pemasang (installerName) wajib diisi, 2 sampai 120 karakter." };
  const plnApprovalNumber = optText(b.plnApprovalNumber, MAX_DOC_NUMBER);
  if (plnApprovalNumber === undefined) return { problem: "Nomor persetujuan PLN paling panjang 60 karakter." };
  const complianceType = b.complianceType as ComplianceType;
  if (complianceType !== "slo" && complianceType !== "registration" && complianceType !== "pending") {
    return { problem: 'Jenis bukti keamanan (complianceType) harus "slo", "registration", atau "pending".' };
  }
  const complianceNumber = optText(b.complianceNumber, MAX_DOC_NUMBER);
  if (complianceNumber === undefined) return { problem: "Nomor SLO atau registrasi paling panjang 60 karakter." };
  if (complianceType === "pending" && complianceNumber !== null) {
    return { problem: "Kosongkan nomor SLO atau registrasi bila masih dalam proses (pending)." };
  }
  const name = text(b.contactName, 2, 80);
  if (!name) return { problem: "Nama kontak (contactName) wajib diisi, 2 sampai 80 karakter." };
  const phone = normalizePhone(b.phone);
  if (!phone) return { problem: "Nomor telepon tidak valid. Contoh: 081234567890." };
  const ownership = b.ownership as Ownership;
  if (ownership !== "owner" && ownership !== "authorized_resident") {
    return { problem: 'Hubungan dengan pemilik (ownership) harus "owner" atau "authorized_resident".' };
  }
  if (typeof b.ownerPermissionConfirmed !== "boolean") return { problem: "ownerPermissionConfirmed harus berupa true atau false." };
  if (ownership === "authorized_resident" && !b.ownerPermissionConfirmed) {
    return { problem: "Penghuni yang bukan pemilik harus menyatakan sudah mendapat izin pemilik." };
  }
  if (!CONTACT_WINDOWS.includes(b.preferredContactWindow as ContactWindow)) {
    return { problem: 'Waktu dihubungi harus "weekday_morning", "weekday_afternoon", atau "weekend".' };
  }
  const notes = optText(b.notes, MAX_NOTES);
  if (notes === undefined) return { problem: "Catatan paling panjang 500 karakter." };
  return {
    report: { installedKwp: b.installedKwp, panelCount: b.panelCount, installedOn, installerName, plnApprovalNumber, complianceType, complianceNumber },
    contact: {
      name,
      phone,
      ownership,
      ownerPermissionConfirmed: ownership === "owner" ? true : b.ownerPermissionConfirmed,
      preferredContactWindow: b.preferredContactWindow as ContactWindow,
      notes: notes ?? "",
    },
  };
}

function parseFileIds(v: unknown, min: number): string[] | null {
  if (v === undefined && min === 0) return [];
  if (!Array.isArray(v) || v.length < min || v.length > MAX_FILES_PER_APPLICATION || !v.every(isUuid)) return null;
  const ids = v.map((id) => id.toLowerCase());
  return new Set(ids).size === ids.length ? ids : null;
}

export interface CreateInput {
  expectedHomeUpdatedAt: string;
  report: InstallationReport;
  contact: ApplicationContact;
  fileIds: string[];
}

/** Validates POST /api/me/solar-applications. */
export function parseCreateInput(body: unknown, now = new Date()): { input: CreateInput } | Problem {
  if (!isObject(body)) return { problem: "Data laporan tidak valid." };
  const at = typeof body.expectedHomeUpdatedAt === "string" ? new Date(body.expectedHomeUpdatedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return { problem: "expectedHomeUpdatedAt harus berupa waktu ISO dari data rumah." };
  if (body.consentApplicationProcessing !== true) {
    return { problem: "Persetujuan pemrosesan data laporan (consentApplicationProcessing) wajib dicentang." };
  }
  const parsed = parseReportFields(body as unknown as ReportFields, now);
  if ("problem" in parsed) return parsed;
  const fileIds = parseFileIds(body.fileIds, 1);
  if (!fileIds) return { problem: "fileIds harus berisi 1 sampai 10 id foto yang berbeda." };
  return { input: { expectedHomeUpdatedAt: at.toISOString(), ...parsed, fileIds } };
}

/** Same body, same hash: what the Idempotency-Key compares. */
export function requestHash(input: CreateInput): string {
  const canonical = { ...input, fileIds: [...input.fileIds].sort() };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface PatchInput {
  expectedVersion: number;
  /** The fields sent, still raw; merged with the stored report and validated in `decidePatch`. */
  fields: Partial<ReportFields>;
  addFileIds: string[];
}

function parseVersion(v: unknown): number | null {
  return isNum(v) && Number.isInteger(v) && v >= 1 ? v : null;
}

/** Validates the shape of PATCH /api/me/solar-applications/:id; the values are checked after merging. */
export function parsePatchInput(body: unknown): { input: PatchInput } | Problem {
  if (!isObject(body)) return { problem: "Data perbaikan tidak valid." };
  const expectedVersion = parseVersion(body.expectedVersion);
  if (!expectedVersion) return { problem: "expectedVersion wajib berupa bilangan bulat dari data laporan terakhir." };
  const fields: Partial<ReportFields> = {};
  for (const k of REPORT_KEYS) if (k in body) fields[k] = body[k];
  const addFileIds = parseFileIds(body.addFileIds, 0);
  if (!addFileIds) return { problem: "addFileIds harus berisi paling banyak 10 id foto yang berbeda." };
  if (Object.keys(fields).length === 0 && addFileIds.length === 0) return { problem: "Tidak ada data yang diperbaiki." };
  return { input: { expectedVersion, fields, addFileIds } };
}

export interface ActionInput {
  action: Exclude<ApplicationAction, "edit">;
  expectedVersion: number;
  publicNote: string | null;
  internalNote: string | null;
  survey: { startsAt: string; endsAt: string } | null;
  verifiedKwp: number | null;
}

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/i;

/** Validates POST .../actions for the role (an action of the other role is a 403-like 409 later). */
export function parseActionInput(body: unknown, role: Role, now = new Date()): { input: ActionInput } | Problem {
  if (!isObject(body)) return { problem: "Data tindakan tidak valid." };
  const action = body.action as ApplicationActionInput["action"];
  if (typeof action !== "string" || !(action in ACTION_RULES) || action === ("edit" as string)) {
    return { problem: "Tindakan (action) tidak dikenal." };
  }
  const expectedVersion = parseVersion(body.expectedVersion);
  if (!expectedVersion) return { problem: "expectedVersion wajib berupa bilangan bulat dari data laporan terakhir." };
  const publicNote = optText(body.publicNote, MAX_PUBLIC_NOTE);
  if (publicNote === undefined) return { problem: "Catatan untuk warga paling panjang 500 karakter." };
  const internalNote = optText(body.internalNote, MAX_INTERNAL_NOTE);
  if (internalNote === undefined) return { problem: "Catatan internal paling panjang 1.000 karakter." };
  if (role === "warga" && internalNote !== null) return { problem: "Catatan internal hanya untuk akun pemda." };

  let survey: ActionInput["survey"] = null;
  if (action === "schedule_survey" || action === "reschedule_survey") {
    const s = body.survey;
    if (!isObject(s) || typeof s.startsAt !== "string" || typeof s.endsAt !== "string" || !OFFSET.test(s.startsAt) || !OFFSET.test(s.endsAt)) {
      return { problem: "Jadwal survei (survey.startsAt, survey.endsAt) wajib berupa waktu ISO 8601 dengan zona, mis. 2026-11-02T09:00:00+08:00." };
    }
    const start = new Date(s.startsAt);
    const end = new Date(s.endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { problem: "Waktu survei tidak valid." };
    if (end <= start || end.getTime() - start.getTime() > MAX_SURVEY_MS) {
      return { problem: "Waktu selesai survei harus setelah waktu mulai, paling lama 12 jam." };
    }
    if (start.getTime() < now.getTime() - 3600_000 || start.getTime() > now.getTime() + MAX_SURVEY_AHEAD_MS) {
      return { problem: "Survei harus dijadwalkan mulai sekarang sampai satu tahun ke depan." };
    }
    survey = { startsAt: start.toISOString(), endsAt: end.toISOString() };
  }

  let verifiedKwp: number | null = null;
  if (action === "verify") {
    if (!isNum(body.verifiedKwp) || body.verifiedKwp <= 0 || body.verifiedKwp > MAX_KWP) {
      return { problem: "Kapasitas terverifikasi (verifiedKwp) wajib, lebih dari 0 sampai 10.000 kWp." };
    }
    verifiedKwp = body.verifiedKwp;
  }
  return { input: { action, expectedVersion, publicNote, internalNote, survey, verifiedKwp } };
}

// ---------- building a report ----------

/** The home snapshot and the app's estimate for the reported panels ("perkiraan"). */
export async function buildEstimate(deps: Pick<AppDeps, "db" | "nasa">, home: HomeSnapshot, panelCount: number): Promise<EstimateSnapshot> {
  const sim = await simulateSolarAt(deps, {
    lat: home.lat,
    lng: home.lng,
    roofAreaM2: home.footprintM2,
    kwhYear: home.kwhYear,
    backupHours: 0,
    buildingType: home.buildingType,
    panelCount,
  });
  return {
    panelCount: sim.panels,
    kWp: sim.kWp,
    kwhYear: sim.kwhYear,
    savingRpYear: sim.savingRpYear,
    costRp: sim.costRp,
    peakSunHours: sim.peakSunHours,
    assumptions: sim.assumptions,
    modelVersion: SOLAR_MODEL_VERSION,
  };
}

export function homeSnapshot(home: Home): HomeSnapshot {
  return {
    featureId: home.featureId,
    lng: home.lng,
    lat: home.lat,
    regionId: home.regionId,
    regionName: home.regionName,
    buildingType: home.buildingType,
    footprintM2: home.footprintM2,
    kwhYear: home.kwhYear,
    kwhSource: home.kwhSource,
    potentialKwp: home.potentialKwp,
    homeUpdatedAt: home.updatedAt,
  };
}

export async function buildDraft(deps: Pick<AppDeps, "db" | "nasa">, home: Home, input: CreateInput): Promise<ApplicationDraft> {
  const snap = homeSnapshot(home);
  return {
    regionId: home.regionId,
    homeSnapshot: snap,
    estimate: await buildEstimate(deps, snap, input.report.panelCount),
    report: input.report,
    contact: input.contact,
  };
}

// ---------- transitions ----------

export interface Actor {
  id: number;
  role: Role;
}

const fail = (status: number, code: ApplicationFailure["code"], message: string): { fail: ApplicationFailure } => ({ fail: { status, code, message } });

const notAllowed = () => fail(409, "invalid_transition", "Tindakan ini tidak tersedia untuk status laporan sekarang. Muat ulang laporan.");

/** POST .../actions for either role, against the locked report. */
export function decideAction(app: ApplicationRecord, input: ActionInput, actor: Actor, now = new Date()): ApplicationDecision {
  const rule = ACTION_RULES[input.action];
  if (rule.role !== actor.role || !rule.from.includes(app.status)) return notAllowed();
  if (rule.needsPublicNote && !input.publicNote) return fail(400, "validation", "Alasan untuk warga (publicNote) wajib diisi untuk tindakan ini.");
  const set: Extract<ApplicationDecision, { set: unknown }>["set"] = {};
  if (rule.to) set.status = rule.to;
  let verifyHome: { featureId: string; kWp: number } | undefined;
  switch (input.action) {
    case "schedule_survey":
    case "reschedule_survey":
      set.survey = input.survey;
      break;
    case "request_changes":
      set.survey = null;
      break;
    case "verify": {
      if (!hasComplianceEvidence(app.report, app.files)) {
        return fail(409, "compliance_missing", "Belum ada bukti SLO atau nomor registrasi. Minta warga melengkapi data dulu.");
      }
      const kWp = input.verifiedKwp!;
      set.verification = { kWp, method: app.status === "survey_scheduled" ? "survey" : "document", at: now.toISOString() };
      verifyHome = { featureId: app.homeSnapshot.featureId, kWp };
      break;
    }
  }
  return {
    set,
    event: {
      action: input.action,
      title: rule.title,
      publicNote: input.publicNote,
      internalNote: actor.role === "pemda" ? input.internalNote : null,
      actorUserId: actor.id,
      actorRole: actor.role,
    },
    ...(verifyHome ? { verifyHome } : {}),
  };
}

/** The stored report and contact as create-style fields, so an edit can be merged and validated whole. */
function storedFields(app: ApplicationRecord): ReportFields {
  return {
    ...app.report,
    contactName: app.contact.name,
    phone: app.contact.phone,
    ownership: app.contact.ownership,
    ownerPermissionConfirmed: app.contact.ownerPermissionConfirmed,
    preferredContactWindow: app.contact.preferredContactWindow,
    notes: app.contact.notes,
  };
}

/** The panel count an edit would leave, or null when the merged edit does not name a valid one. */
export function patchedPanelCount(app: ApplicationRecord, input: PatchInput): number | null {
  const n = input.fields.panelCount ?? app.report.panelCount;
  return isNum(n) && Number.isInteger(n) && n >= 1 && n <= MAX_PANELS ? n : null;
}

/**
 * PATCH while needs_changes. `estimate` is the estimate computed for the new panel count before the
 * transaction (null when the count did not change); the home snapshot never changes.
 */
export function decidePatch(app: ApplicationRecord, input: PatchInput, actor: Actor, estimate: EstimateSnapshot | null, now = new Date()): ApplicationDecision {
  if (actor.role !== "warga" || !ACTION_RULES.edit.from.includes(app.status)) return notAllowed();
  const parsed = parseReportFields({ ...storedFields(app), ...input.fields }, now);
  if ("problem" in parsed) return fail(400, "validation", parsed.problem);
  const set: Extract<ApplicationDecision, { set: unknown }>["set"] = { report: parsed.report, contact: parsed.contact };
  if (parsed.report.panelCount !== app.report.panelCount) {
    // The route estimates the new count before the transaction; a stale version already failed above.
    if (!estimate) return notAllowed();
    set.estimate = estimate;
  }
  return {
    set,
    event: {
      action: "edit",
      title: ACTION_RULES.edit.title,
      publicNote: null,
      internalNote: null,
      actorUserId: actor.id,
      actorRole: actor.role,
      data: { before: { report: app.report, contact: app.contact }, addedFileIds: input.addFileIds },
    },
    ...(input.addFileIds.length ? { attachFileIds: input.addFileIds } : {}),
  };
}

// ---------- views ----------

export const fileUrl = (id: string): string => `/api/solar-application-files/${id}`;

function files(app: ApplicationRecord): ApplicationFile[] {
  return app.files.map((f) => ({ id: f.id, kind: f.kind, contentType: f.contentType, sizeBytes: f.sizeBytes, createdAt: f.createdAt, url: fileUrl(f.id) }));
}

/** Non-blocking hints for both sides. */
export function warnings(app: Pick<ApplicationRecord, "report" | "homeSnapshot">): string[] {
  const out: string[] = [];
  if (app.report.installedKwp > app.homeSnapshot.potentialKwp) out.push("exceeds_roof_estimate");
  if (app.report.complianceType === "pending") out.push("compliance_pending");
  return out;
}

function base(app: ApplicationRecord, role: Role): Omit<SolarApplication, "events"> {
  return {
    id: app.id,
    reference: app.reference,
    status: app.status,
    version: app.version,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    homeSnapshot: app.homeSnapshot,
    estimate: app.estimate,
    report: app.report,
    contact: app.contact,
    survey: app.survey,
    verification: app.verification,
    files: files(app),
    allowedActions: allowedActions(role, app),
    warnings: warnings(app),
  };
}

/** What the resident sees: the public timeline only, no internal notes or who did what. */
export function citizenView(app: ApplicationRecord): SolarApplication {
  const events: ApplicationEvent[] = app.events.map((e) => ({ id: e.id, at: e.at, action: e.action, status: e.status, title: e.title, publicNote: e.publicNote }));
  return { ...base(app, "warga"), events };
}

/** What the government sees: the full audit trail. */
export function pemdaView(app: ApplicationRecord): PemdaSolarApplication {
  return {
    ...base(app, "pemda"),
    events: app.events.map((e) => ({ ...e })),
    demo: app.demo,
  };
}

export function citizenSummary(app: ApplicationRecord): SolarApplicationSummary {
  return {
    id: app.id,
    reference: app.reference,
    status: app.status,
    version: app.version,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    regionId: app.regionId,
    regionName: app.homeSnapshot.regionName,
    installedKwp: app.report.installedKwp,
    surveyStartsAt: app.survey?.startsAt ?? null,
  };
}

export function pemdaSummaryItem(app: ApplicationRecord): PemdaApplicationSummary {
  return { ...citizenSummary(app), contactName: app.contact.name, demo: app.demo };
}

// ---------- lists ----------

export const encodeCursor = (seq: number): string => Buffer.from(String(seq)).toString("base64url");
export function decodeCursor(v: string | null): number | null | undefined {
  if (v === null || v === "") return null;
  const s = Buffer.from(v, "base64url").toString();
  return /^\d{1,15}$/.test(s) ? Number(s) : undefined;
}

export function parseStatuses(v: string | null): ApplicationStatus[] | null | undefined {
  if (v === null || v === "") return null;
  const list = v.split(",").map((s) => s.trim());
  return list.every((s) => (APPLICATION_STATUSES as readonly string[]).includes(s)) ? (list as ApplicationStatus[]) : undefined;
}

export function parseLimit(v: string | null): number | undefined {
  if (v === null || v === "") return 20;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : undefined;
}

// ---------- uploads ----------

/** The image type from the first bytes (the client's Content-Type is not trusted), or null. */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export const isFileKind = (v: unknown): v is FileKind => typeof v === "string" && (FILE_KINDS as readonly string[]).includes(v);
