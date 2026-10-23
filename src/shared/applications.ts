import type { BuildingType } from "./types.ts";

/*
 * The contract between the server's solar installation reports (src/server/routes/applications.ts) and the
 * web app. A resident (warga) reports rooftop PV that is already installed, with photos; the local government
 * (pemda) checks the data, optionally visits, and marks it verified for its records ("pendataan"). It is not a
 * permit: PLN approves the connection and the SLO or ESDM registration covers safety (Permen ESDM 2/2024).
 *
 * Flow (docs/plans/2026-10-23-solar-verification-api.md):
 *   submitted -> under_review -> verified
 *                             -> survey_scheduled -> verified | needs_changes | rejected
 *                             -> needs_changes -> (resident edits) resubmit -> submitted
 *                             -> rejected
 *   The resident may cancel until the report is verified or rejected.
 */

export const APPLICATION_STATUSES = [
  "submitted",
  "under_review",
  "needs_changes",
  "survey_scheduled",
  "verified",
  "rejected",
  "cancelled",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses that end a report; any other status counts as the resident's one active report. */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = ["verified", "rejected", "cancelled"];
export const isActiveStatus = (s: ApplicationStatus): boolean => !TERMINAL_STATUSES.includes(s);

/** What the resident sees for each status. */
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Laporan diterima",
  under_review: "Data sedang diperiksa",
  needs_changes: "Lengkapi data",
  survey_scheduled: "Survei dijadwalkan",
  verified: "Terverifikasi pemda (pendataan)",
  rejected: "Belum dapat diverifikasi",
  cancelled: "Dibatalkan",
};

export type CitizenAction = "edit" | "resubmit" | "cancel";
export type PemdaAction = "start_review" | "request_changes" | "schedule_survey" | "reschedule_survey" | "verify" | "reject";
export type ApplicationAction = CitizenAction | PemdaAction;

export interface ActionRule {
  role: "warga" | "pemda";
  from: readonly ApplicationStatus[];
  /** The status after the action; null keeps the status (edit, reschedule). */
  to: ApplicationStatus | null;
  /** A public reason is required (it shows on the resident's timeline). */
  needsPublicNote: boolean;
  /** Title of the timeline event. */
  title: string;
}

/** Every action, who may run it, and from which statuses. `edit` is PATCH; the others are POST .../actions. */
export const ACTION_RULES: Record<ApplicationAction, ActionRule> = {
  edit: { role: "warga", from: ["needs_changes"], to: null, needsPublicNote: false, title: "Data laporan diperbarui" },
  resubmit: { role: "warga", from: ["needs_changes"], to: "submitted", needsPublicNote: false, title: "Laporan dikirim ulang" },
  cancel: {
    role: "warga",
    from: ["submitted", "under_review", "needs_changes", "survey_scheduled"],
    to: "cancelled",
    needsPublicNote: false,
    title: "Laporan dibatalkan",
  },
  start_review: { role: "pemda", from: ["submitted"], to: "under_review", needsPublicNote: false, title: "Pemeriksaan data dimulai" },
  request_changes: {
    role: "pemda",
    from: ["under_review", "survey_scheduled"],
    to: "needs_changes",
    needsPublicNote: true,
    title: "Perlu perbaikan data",
  },
  schedule_survey: { role: "pemda", from: ["under_review"], to: "survey_scheduled", needsPublicNote: false, title: "Survei lapangan dijadwalkan" },
  reschedule_survey: { role: "pemda", from: ["survey_scheduled"], to: null, needsPublicNote: false, title: "Jadwal survei diubah" },
  verify: { role: "pemda", from: ["under_review", "survey_scheduled"], to: "verified", needsPublicNote: false, title: "Pemasangan terverifikasi" },
  reject: { role: "pemda", from: ["under_review", "survey_scheduled"], to: "rejected", needsPublicNote: true, title: "Laporan belum dapat diverifikasi" },
};

export const CITIZEN_ACTIONS: readonly CitizenAction[] = ["edit", "resubmit", "cancel"];
export const PEMDA_ACTIONS: readonly PemdaAction[] = ["start_review", "request_changes", "schedule_survey", "reschedule_survey", "verify", "reject"];

/** Kinds of uploaded photo. At least one `installation` photo is required. */
export const FILE_KINDS = ["installation", "pln_approval", "compliance", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABELS: Record<FileKind, string> = {
  installation: "Foto panel terpasang",
  pln_approval: "Foto persetujuan PLN",
  compliance: "Foto SLO atau nomor registrasi",
  other: "Foto lain",
};
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_FILES_PER_APPLICATION = 10;

/** Safety proof after installation: an SLO, an ESDM registration number, or not yet (pending). */
export type ComplianceType = "slo" | "registration" | "pending";
export type Ownership = "owner" | "authorized_resident";
export const CONTACT_WINDOWS = ["weekday_morning", "weekday_afternoon", "weekend"] as const;
export type ContactWindow = (typeof CONTACT_WINDOWS)[number];

/** Times are stored in UTC and shown in Kaltim time (WITA). */
export const APPLICATION_TIME_ZONE = "Asia/Makassar";

/** What the resident reports about the installation. */
export interface InstallationReport {
  /** Nameplate capacity, kWp. */
  installedKwp: number;
  panelCount: number;
  /** Day the installation finished, YYYY-MM-DD (WITA). */
  installedOn: string;
  installerName: string;
  /** Optional when a `pln_approval` photo is attached. */
  plnApprovalNumber: string | null;
  complianceType: ComplianceType;
  /** Optional when a `compliance` photo is attached; null when the type is `pending`. */
  complianceNumber: string | null;
}

export interface ApplicationContact {
  name: string;
  /** Normalised to 08... */
  phone: string;
  ownership: Ownership;
  ownerPermissionConfirmed: boolean;
  preferredContactWindow: ContactWindow;
  notes: string;
}

/** POST /api/me/solar-applications, with header `Idempotency-Key: <uuid>`. */
export interface SolarApplicationCreateInput extends InstallationReport {
  /** `home.updatedAt` the form was built from; 409 home_changed when the home was saved since. */
  expectedHomeUpdatedAt: string;
  contactName: string;
  phone: string;
  ownership: Ownership;
  ownerPermissionConfirmed: boolean;
  preferredContactWindow: ContactWindow;
  notes?: string;
  consentApplicationProcessing: true;
  /** Ids from POST /api/me/solar-application-files; at least one `installation` photo. */
  fileIds: string[];
}

/** PATCH /api/me/solar-applications/:id while needs_changes: any of the report and contact fields, plus new photos. */
export type SolarApplicationPatchInput = Partial<Omit<SolarApplicationCreateInput, "expectedHomeUpdatedAt" | "consentApplicationProcessing" | "fileIds">> & {
  expectedVersion: number;
  /** Photos to add; photos already attached stay (they are part of the record). */
  addFileIds?: string[];
};

/** POST /api/me/solar-applications/:id/actions and POST /api/pemda/solar-applications/:id/actions. */
export interface ApplicationActionInput {
  action: Exclude<ApplicationAction, "edit">;
  expectedVersion: number;
  /** Shown on the resident's timeline. Required for request_changes and reject. */
  publicNote?: string;
  /** Pemda only; never shown to the resident. */
  internalNote?: string;
  /** schedule_survey and reschedule_survey: ISO 8601 with an offset, e.g. 2026-11-02T09:00:00+08:00. */
  survey?: { startsAt: string; endsAt: string };
  /** verify: the capacity the government checked, kWp. */
  verifiedKwp?: number;
}

export interface ApplicationFile {
  id: string;
  kind: FileKind;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  /** GET this (with the session cookie) for the image. */
  url: string;
}

export interface ApplicationEvent {
  id: string;
  at: string;
  action: ApplicationAction | "create";
  /** Status after the event. */
  status: ApplicationStatus;
  title: string;
  publicNote: string | null;
}

/** The home as it was when the report was sent; later home edits do not change it. */
export interface HomeSnapshot {
  featureId: string;
  lng: number;
  lat: number;
  regionId: string | null;
  regionName: string | null;
  buildingType: BuildingType;
  footprintM2: number;
  kwhYear: number;
  kwhSource: "tagihan" | "perkiraan";
  potentialKwp: number;
  homeUpdatedAt: string;
}

/** The app's estimate for the reported panels at send time ("perkiraan"), to compare with the real system. */
export interface EstimateSnapshot {
  panelCount: number;
  kWp: number;
  kwhYear: number;
  savingRpYear: number;
  costRp: number;
  peakSunHours: number;
  assumptions: string[];
  modelVersion: string;
}

export interface SolarApplication {
  id: string;
  /** Human reference, e.g. PLTS-2026-000123. */
  reference: string;
  status: ApplicationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  homeSnapshot: HomeSnapshot;
  estimate: EstimateSnapshot;
  report: InstallationReport;
  contact: ApplicationContact;
  survey: null | { startsAt: string; endsAt: string };
  verification: null | { kWp: number; method: "document" | "survey"; at: string };
  files: ApplicationFile[];
  events: ApplicationEvent[];
  /** What the signed-in account may do now; the UI shows only these buttons. */
  allowedActions: ApplicationAction[];
  /** Non-blocking notes, e.g. "exceeds_roof_estimate". */
  warnings: string[];
}

export interface PemdaApplicationEvent extends ApplicationEvent {
  actorRole: "warga" | "pemda" | null;
  actorName: string | null;
  internalNote: string | null;
}

/** GET /api/pemda/solar-applications/:id: the same record with the internal audit trail. */
export interface PemdaSolarApplication extends Omit<SolarApplication, "events"> {
  events: PemdaApplicationEvent[];
  /** Report from a seeded demo account. */
  demo: boolean;
}

export interface SolarApplicationSummary {
  id: string;
  reference: string;
  status: ApplicationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  regionId: string | null;
  regionName: string | null;
  installedKwp: number;
  surveyStartsAt: string | null;
}
export interface PemdaApplicationSummary extends SolarApplicationSummary {
  contactName: string;
  demo: boolean;
}

/** GET list answers. Pass `nextCursor` back as `cursor` for the next page; null means no more. */
export interface ApplicationPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface ApplicationAnswer<T = SolarApplication> {
  application: T;
}
export interface ApplicationFileAnswer {
  file: ApplicationFile;
}

/** `code` in error answers `{ error, code }` from these routes. */
export type ApplicationErrorCode =
  | "validation"
  | "home_missing"
  | "home_changed"
  | "active_application_exists"
  | "idempotency_key_required"
  | "idempotency_mismatch"
  | "version_conflict"
  | "invalid_transition"
  | "compliance_missing"
  | "files_invalid"
  | "file_too_large"
  | "file_type"
  | "not_found";

/** True when the report carries proof of SLO or registration: a number or a `compliance` photo. */
export function hasComplianceEvidence(report: InstallationReport, files: readonly { kind: FileKind }[]): boolean {
  if (report.complianceType === "pending") return false;
  return report.complianceNumber !== null || files.some((f) => f.kind === "compliance");
}

/** Actions the role may run on a report now. `verify` also needs SLO or registration proof. */
export function allowedActions(
  role: "warga" | "pemda",
  app: { status: ApplicationStatus; report: InstallationReport; files: readonly { kind: FileKind }[] },
): ApplicationAction[] {
  const all: ApplicationAction[] = role === "warga" ? [...CITIZEN_ACTIONS] : [...PEMDA_ACTIONS];
  return all.filter((a) => {
    if (!ACTION_RULES[a].from.includes(app.status)) return false;
    return a !== "verify" || hasComplianceEvidence(app.report, app.files);
  });
}
