import type { UpgradePrompt } from "@/lib/billing/upgrade-prompt";

/** Client-safe constants and DTO shapes for the employer job UI. */
export const JOB_TYPES = [
  "PERMANENT",
  "TEMPORARY",
  "FREELANCE",
  "INTERNSHIP",
  "APPRENTICESHIP",
  "HOLIDAY_JOB",
] as const;
export const REMOTE_TYPES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"] as const;
export const SALARY_PERIODS = ["YEARLY", "MONTHLY", "HOURLY"] as const;
export const APPLICATION_EFFORTS = ["SIMPLE", "MEDIUM", "LONG"] as const;
export const APPLICATION_CONTACT_KINDS = ["EMAIL", "PHONE", "APPLY_URL"] as const;
export const REQUIRED_DOCUMENT_KINDS = [
  "NONE",
  "CV",
  "COVER_LETTER",
  "CERTIFICATES",
  "REFERENCES",
  "PORTFOLIO",
  "OTHER",
] as const;
export const JOB_BENEFIT_CODES = [
  "FLEXIBLE_WORK",
  "HOME_OFFICE",
  "PAID_TRAINING",
  "PENSION_TOP_UP",
  "PARENTAL_LEAVE",
  "CHILDCARE_SUPPORT",
  "PUBLIC_TRANSPORT_SUPPORT",
  "MEAL_SUPPORT",
  "HEALTH_WELLBEING",
  "EXTRA_LEAVE",
  "PERFORMANCE_BONUS",
] as const;

export type EmployerJobFormState = Readonly<{
  status: "idle" | "success" | "error" | "conflict";
  message?: string;
  nextIdempotencyKey?: string;
  suggestion?: string;
  upgradePrompt?: UpgradePrompt;
}>;

export const INITIAL_EMPLOYER_JOB_FORM_STATE: EmployerJobFormState = Object.freeze({ status: "idle" });

export type EmployerJobCapabilities = Readonly<{
  assignmentRole: "EDITOR" | "PIPELINE" | "REVIEWER" | null;
  readSummary: boolean;
  readFullRevision: boolean;
  mutateDraft: boolean;
  manageLifecycle: boolean;
}>;

export type EmployerJobCatalog = Readonly<{
  categories: readonly Readonly<{ id: string; name: string }>[];
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  cities: readonly Readonly<{ id: string; cantonId: string; name: string }>[];
  skills: readonly Readonly<{ id: string; name: string }>[];
  occupations: readonly Readonly<{ id: string; code: string; label: string; result: string }>[];
}>;

export type EmployerJobStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "PUBLISHED"
  | "PAUSED"
  | "EXPIRED"
  | "CLOSED"
  | "REJECTED"
  | "REMOVED";

export type EmployerJobListItem = Readonly<{
  id: string;
  slug: string;
  status: EmployerJobStatus;
  version: number;
  revisionId: string | null;
  revisionVersion: number | null;
  title: string;
  location: string;
  applications: number;
  views: number;
  saves: number;
  score: Readonly<{ points: number; maxPoints: number }> | null;
  boostStatus: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "CANCELLED" | null;
  capabilities: EmployerJobCapabilities;
}>;

export type EmployerJobRevisionDetail = Readonly<{
  id: string;
  revisionNumber: number;
  version: number;
  contentLanguage: string;
  title: string;
  companyIntro: string | null;
  description: string;
  tasks: readonly string[];
  requirements: readonly string[];
  niceToHave: readonly string[];
  offer: string | null;
  applicationProcessSteps: readonly string[];
  requiredDocumentKinds: readonly string[];
  jobType: string;
  remoteType: string;
  remoteCountryCode: string | null;
  categoryId: string;
  cantonId: string | null;
  cityId: string | null;
  locationLabel: string | null;
  workloadMin: number;
  workloadMax: number;
  salaryPeriod: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  startDate: Date | null;
  startByArrangement: boolean;
  validThrough: Date | null;
  responseTargetDays: number;
  applicationEffort: string;
  inclusionStatement: string | null;
  applicationContactKind: string;
  applicationContactValue: string;
  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  languages: readonly Readonly<{ code: string; minLevel: string }>[];
  skills: readonly Readonly<{ id: string; name: string; required: boolean }>[];
  benefits: readonly Readonly<{ benefitCode: string; description: string; sortOrder: number }>[];
  reportingCheck: Readonly<{
    id: string;
    result: string;
    reason: string;
    disclaimer: string;
    source: string;
    datasetVersion: string;
    dataYear: number;
    referenceUrl: string | null;
    occupationCode: string | null;
    occupationLabel: string | null;
    checkedAt: Date;
  }> | null;
}>;

export type EmployerJobFullDetail = Readonly<{
  access: "FULL";
  id: string;
  slug: string;
  status: EmployerJobStatus;
  version: number;
  currentRevisionId: string | null;
  publishedRevisionId: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  revision: EmployerJobRevisionDetail | null;
  applications: number;
  views: number;
  saves: number;
  boostStatus: EmployerJobListItem["boostStatus"];
  capabilities: EmployerJobCapabilities;
  score: Readonly<{
    score: number;
    version: string;
    evidence: Readonly<Record<string, string>>;
    positiveReasons: readonly string[];
    missingImprovements: readonly string[];
    employerSuggestions: readonly string[];
  }> | null;
  latestScoreSnapshot: Readonly<{ points: number; maxPoints: number; calculatedAt: Date }> | null;
  statusEvents: readonly Readonly<{ kind: string; fromStatus: string | null; toStatus: string; createdAt: Date; reasonCode: string | null }>[];
  auditEvents: readonly Readonly<{ action: string; result: string; reasonCode: string | null; createdAt: Date }>[];
}>;
