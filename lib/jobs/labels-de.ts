import type {
  ApplicationContactKind,
  ApplicationEffort,
  JobType,
  Language,
  RemoteType,
  SalaryPeriod,
} from "@/lib/generated/prisma/enums";

const JOB_TYPE_LABELS_DE: Readonly<Record<JobType, string>> = Object.freeze({
  PERMANENT: "Festanstellung",
  TEMPORARY: "Befristete Anstellung",
  FREELANCE: "Freie Mitarbeit",
  INTERNSHIP: "Praktikum",
  APPRENTICESHIP: "Lehrstelle",
  HOLIDAY_JOB: "Ferienjob",
});

const REMOTE_TYPE_LABELS_DE: Readonly<Record<RemoteType, string>> = Object.freeze({
  ONSITE: "Vor Ort",
  HYBRID: "Hybrid",
  REMOTE: "Vollständig remote",
});

const SALARY_PERIOD_LABELS_DE: Readonly<Record<SalaryPeriod, string>> = Object.freeze({
  YEARLY: "Jahr",
  MONTHLY: "Monat",
  HOURLY: "Stunde",
});

const APPLICATION_EFFORT_LABELS_DE: Readonly<Record<ApplicationEffort, string>> =
  Object.freeze({
    SIMPLE: "Kurz",
    MEDIUM: "Mittel",
    LONG: "Umfangreich",
  });

const APPLICATION_CONTACT_LABELS_DE: Readonly<
  Record<ApplicationContactKind, string>
> = Object.freeze({
  EMAIL: "E-Mail",
  PHONE: "Telefon",
  APPLY_URL: "Externer Bewerbungslink",
});

const CONTENT_LANGUAGE_LABELS_DE: Readonly<Record<Language, string>> = Object.freeze({
  DE: "Deutsch",
  FR: "Französisch",
  IT: "Italienisch",
  EN: "Englisch",
});

const REQUIRED_DOCUMENT_LABELS_DE: Readonly<Record<string, string>> = Object.freeze({
  NONE: "Keine Pflichtunterlagen",
  CV: "Lebenslauf",
  COVER_LETTER: "Motivationsschreiben",
  CERTIFICATES: "Zeugnisse",
  REFERENCES: "Referenzen",
  PORTFOLIO: "Portfolio",
  OTHER: "Weitere Unterlagen",
});

export function jobTypeLabel(value: string): string {
  return labelFrom(JOB_TYPE_LABELS_DE, value);
}

export function remoteTypeLabel(value: string): string {
  return labelFrom(REMOTE_TYPE_LABELS_DE, value);
}

export function salaryPeriodLabel(value: string): string {
  return labelFrom(SALARY_PERIOD_LABELS_DE, value);
}

export function applicationEffortLabel(value: string): string {
  return labelFrom(APPLICATION_EFFORT_LABELS_DE, value);
}

export function applicationContactLabel(value: string): string {
  return labelFrom(APPLICATION_CONTACT_LABELS_DE, value);
}

export function contentLanguageLabel(value: string): string {
  return labelFrom(CONTENT_LANGUAGE_LABELS_DE, value);
}

export function requiredDocumentLabel(value: string): string {
  return labelFrom(REQUIRED_DOCUMENT_LABELS_DE, value);
}

function labelFrom(
  labels: Readonly<Record<string, string>>,
  value: string,
): string {
  return labels[value] ?? value;
}
