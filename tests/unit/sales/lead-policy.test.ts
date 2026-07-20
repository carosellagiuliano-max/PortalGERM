import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  SALES_LEAD_INTAKE_POLICY_V1,
  SALES_LEAD_NOTICE_HASH_V1,
  leadPurposeForInterest,
  normalizeLeadInterestQuery,
  planCodeForLeadInterest,
  salesLeadAnalyticsKeyV1,
  salesLeadDueAtV1,
  salesLeadRetainUntilV1,
} from "@/lib/sales/lead-policy";
import { hashLeadIntakePayloadV1 } from "@/lib/sales/public-lead";
import type { LeadFormInput } from "@/lib/validation/billing";

const DAY_MILLISECONDS = 86_400_000;

const BASE_INPUT = Object.freeze({
  email: "kontakt@beispiel.ch",
  companyName: "Beispiel Technik AG",
  contactName: "Mara Muster",
  phone: "+41441234567",
  companySizeCode: "50_249",
  hiringNeedCode: "TWO_TO_FIVE",
  interestCode: "PRO",
  message:
    "Wir möchten in den kommenden Monaten mehrere technische Rollen besetzen.",
  callbackWindowCode: "AFTERNOON",
  acceptedContactPurpose: "yes",
  idempotencyKey: "phase08-lead-unit-0001",
  websiteConfirmation: "",
} satisfies LeadFormInput);

describe("Phase-08 Sales lead policy", () => {
  it.each([
    ["GENERAL", "EMPLOYER_DEMO", null],
    ["STARTER", "SALES_CONTACT", "STARTER"],
    ["PRO", "SALES_CONTACT", "PRO"],
    ["BUSINESS", "SALES_CONTACT", "BUSINESS"],
    ["ENTERPRISE", "ENTERPRISE", "ENTERPRISE_CONTRACT"],
    ["IMPORT", "IMPORT", null],
  ] as const)(
    "maps %s to its closed Lead purpose and plan context",
    (interest, purpose, planCode) => {
      expect(leadPurposeForInterest(interest)).toBe(purpose);
      expect(planCodeForLeadInterest(interest)).toBe(planCode);
    },
  );

  it.each([
    ["starter", "STARTER"],
    [" PRO ", "PRO"],
    ["business", "BUSINESS"],
    ["ENTERPRISE", "ENTERPRISE"],
    ["Import", "IMPORT"],
    ["unknown", "GENERAL"],
    ["", "GENERAL"],
    [null, "GENERAL"],
    [42, "GENERAL"],
  ] as const)("normalizes an untrusted interest query", (query, expected) => {
    expect(normalizeLeadInterestQuery(query)).toBe(expected);
  });

  it("freezes the reviewed notice text into a canonical SHA-256 hash", () => {
    const expected = createHash("sha256")
      .update(SALES_LEAD_INTAKE_POLICY_V1.notice.text, "utf8")
      .digest("hex");

    expect(SALES_LEAD_NOTICE_HASH_V1).toBe(expected);
    expect(SALES_LEAD_NOTICE_HASH_V1).toMatch(/^[a-f0-9]{64}$/u);
    expect(SALES_LEAD_INTAKE_POLICY_V1.notice.version).toBe(
      "employer-demo-privacy-v1",
    );
    expect(SALES_LEAD_INTAKE_POLICY_V1.notice.text).toContain("730 Tage");
  });

  it("derives a stable, opaque analytics session key from the canonical Lead id", () => {
    const leadId = "08200000-0000-4000-8000-000000000123";
    const otherLeadId = "08200000-0000-4000-8000-000000000124";

    expect(salesLeadAnalyticsKeyV1(leadId)).toBe(
      salesLeadAnalyticsKeyV1(leadId.toUpperCase()),
    );
    expect(salesLeadAnalyticsKeyV1(leadId)).toMatch(
      /^lead-v1-[a-f0-9]{32}$/u,
    );
    expect(salesLeadAnalyticsKeyV1(leadId)).not.toContain(leadId);
    expect(salesLeadAnalyticsKeyV1(otherLeadId)).not.toBe(
      salesLeadAnalyticsKeyV1(leadId),
    );
    expect(() => salesLeadAnalyticsKeyV1("not-a-uuid")).toThrow(TypeError);
  });

  it("retains the Lead for exactly the versioned 730-day interval", () => {
    const now = new Date("2026-07-20T08:15:30.456Z");

    expect(salesLeadRetainUntilV1(now)).toEqual(
      new Date(now.getTime() + 730 * DAY_MILLISECONDS),
    );
    expect(SALES_LEAD_INTAKE_POLICY_V1.retentionDays).toBe(730);
  });

  it.each([
    [
      "Montag",
      "2026-07-20T08:15:30.456Z",
      "2026-07-21T08:15:30.456Z",
    ],
    [
      "Freitag",
      "2026-07-24T08:15:30.456Z",
      "2026-07-27T08:15:30.456Z",
    ],
    [
      "Samstag",
      "2026-07-25T08:15:30.456Z",
      "2026-07-27T08:15:30.456Z",
    ],
    [
      "Sonntag",
      "2026-07-26T08:15:30.456Z",
      "2026-07-27T08:15:30.456Z",
    ],
  ])("setzt den SLA-Termin für %s auf den nächsten Zürcher Werktag", (
    _label,
    input,
    expected,
  ) => {
    expect(salesLeadDueAtV1(new Date(input))).toEqual(new Date(expected));
  });

  it("preserves Zurich wall-clock time over the spring DST transition", () => {
    // Friday 10:15 CET -> Monday 10:15 CEST.
    expect(salesLeadDueAtV1(new Date("2026-03-27T09:15:00.000Z"))).toEqual(
      new Date("2026-03-30T08:15:00.000Z"),
    );
  });

  it("preserves Zurich wall-clock time over the autumn DST transition", () => {
    // Friday 10:15 CEST -> Monday 10:15 CET.
    expect(salesLeadDueAtV1(new Date("2026-10-23T08:15:00.000Z"))).toEqual(
      new Date("2026-10-26T09:15:00.000Z"),
    );
  });

  it("rejects invalid policy clocks", () => {
    expect(() => salesLeadDueAtV1(new Date(Number.NaN))).toThrow(TypeError);
    expect(() => salesLeadRetainUntilV1(new Date(Number.NaN))).toThrow(
      TypeError,
    );
  });

  it("hashes a normalized intake deterministically without including its operation key", () => {
    const first = hashLeadIntakePayloadV1(BASE_INPUT);
    const replay = hashLeadIntakePayloadV1({
      ...BASE_INPUT,
      idempotencyKey: "phase08-lead-unit-9999",
    });

    expect(first).toBe(replay);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain(BASE_INPUT.email);
  });

  it.each([
    ["email", "andere-adresse@beispiel.ch"],
    ["companyName", "Andere Beispiel AG"],
    ["contactName", "Andere Kontaktperson"],
    ["phone", "+41311234567"],
    ["companySizeCode", "250_999"],
    ["hiringNeedCode", "SIX_TO_TWENTY"],
    ["interestCode", "BUSINESS"],
    ["message", "Eine andere ausreichend lange und konkrete Anfrage."],
    ["callbackWindowCode", "MORNING"],
  ] as const)("changes the payload hash when %s changes", (field, value) => {
    const changed = { ...BASE_INPUT, [field]: value } as LeadFormInput;

    expect(hashLeadIntakePayloadV1(changed)).not.toBe(
      hashLeadIntakePayloadV1(BASE_INPUT),
    );
  });
});
