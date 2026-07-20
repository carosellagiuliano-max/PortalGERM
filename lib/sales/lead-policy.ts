import { createHash } from "node:crypto";

import type { LeadFormInput } from "@/lib/validation/billing";

const DAY_MILLISECONDS = 86_400_000;

export const SALES_LEAD_INTAKE_POLICY_V1 = Object.freeze({
  version: "sales-lead-intake-v1",
  purpose: "EMPLOYER_DEMO",
  consentSource: "EMPLOYER_DEMO_FORM_V1",
  retentionDays: 730,
  notificationRecipient: "sales@swisstalenthub.invalid",
  notice: Object.freeze({
    version: "employer-demo-privacy-v1",
    text: "Wir verwenden deine Angaben nur zur Kontaktaufnahme zu dieser Anfrage. Offene Vertriebsdaten bewahren wir höchstens 730 Tage auf; gesetzliche Pflichten bleiben vorbehalten.",
  }),
  sla: Object.freeze({
    version: "sales-response-v1",
    businessDays: 1,
    timeZone: "Europe/Zurich",
    weekdays: Object.freeze([1, 2, 3, 4, 5]),
    publicHolidayCalendar: null,
  }),
  successMessage: "Danke — deine Anfrage ist erfasst. Unser internes Ziel ist eine Antwort innerhalb eines Werktags; dies ist keine Garantie.",
});

export const SALES_LEAD_NOTICE_HASH_V1 = createHash("sha256")
  .update(SALES_LEAD_INTAKE_POLICY_V1.notice.text, "utf8")
  .digest("hex");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SalesLeadPurpose =
  | "EMPLOYER_DEMO"
  | "SALES_CONTACT"
  | "ENTERPRISE"
  | "IMPORT";

export function leadPurposeForInterest(
  interest: LeadFormInput["interestCode"],
): SalesLeadPurpose {
  if (interest === "ENTERPRISE") return "ENTERPRISE";
  if (interest === "IMPORT") return "IMPORT";
  if (interest === "STARTER" || interest === "PRO" || interest === "BUSINESS") {
    return "SALES_CONTACT";
  }
  return "EMPLOYER_DEMO";
}

export function planCodeForLeadInterest(
  interest: LeadFormInput["interestCode"],
) {
  switch (interest) {
    case "STARTER": return "STARTER" as const;
    case "PRO": return "PRO" as const;
    case "BUSINESS": return "BUSINESS" as const;
    case "ENTERPRISE": return "ENTERPRISE_CONTRACT" as const;
    default: return null;
  }
}

export function normalizeLeadInterestQuery(value: unknown): LeadFormInput["interestCode"] {
  if (typeof value !== "string") return "GENERAL";
  switch (value.trim().toLocaleLowerCase("de-CH")) {
    case "starter": return "STARTER";
    case "pro": return "PRO";
    case "business": return "BUSINESS";
    case "enterprise": return "ENTERPRISE";
    case "import": return "IMPORT";
    default: return "GENERAL";
  }
}

export function salesLeadAnalyticsKeyV1(leadId: string) {
  if (!UUID_PATTERN.test(leadId)) {
    throw new TypeError("Sales Lead analytics requires a valid Lead id.");
  }
  const digest = createHash("sha256")
    .update(`sales-lead-analytics-v1\0${leadId.toLocaleLowerCase("en-US")}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `lead-v1-${digest}`;
}

export function salesLeadRetainUntilV1(now: Date) {
  assertValidDate(now);
  return new Date(
    now.getTime() + SALES_LEAD_INTAKE_POLICY_V1.retentionDays * DAY_MILLISECONDS,
  );
}

export function salesLeadDueAtV1(now: Date) {
  assertValidDate(now);
  const timeZone = SALES_LEAD_INTAKE_POLICY_V1.sla.timeZone;
  const local = zonedParts(now, timeZone);
  let date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  let remaining = SALES_LEAD_INTAKE_POLICY_V1.sla.businessDays;
  while (remaining > 0) {
    date = new Date(date.getTime() + DAY_MILLISECONDS);
    const weekday = date.getUTCDay();
    if (SALES_LEAD_INTAKE_POLICY_V1.sla.weekdays.includes(weekday as 1 | 2 | 3 | 4 | 5)) {
      remaining -= 1;
    }
  }
  return zonedDateTimeToInstant({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: local.hour,
    minute: local.minute,
    second: local.second,
    millisecond: now.getUTCMilliseconds(),
  }, timeZone);
}

type ZonedParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

function zonedParts(value: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const numberPart = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (part === undefined) throw new Error(`Missing ${type} in zoned date.`);
    return Number(part);
  };
  return Object.freeze({
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second"),
    millisecond: value.getUTCMilliseconds(),
  });
}

function zonedDateTimeToInstant(parts: ZonedParts, timeZone: string) {
  const civilUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let candidate = civilUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = zonedParts(new Date(candidate), timeZone);
    const observedCivilUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      parts.millisecond,
    );
    candidate += civilUtc - observedCivilUtc;
  }
  return new Date(candidate);
}

function assertValidDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Sales lead policy requires a valid clock.");
  }
}
