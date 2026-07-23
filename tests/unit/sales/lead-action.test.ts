// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestRateLimit: vi.fn(),
  getAuthRequestContext: vi.fn(),
  getDatabase: vi.fn(),
  getServerEnvironment: vi.fn(),
  isValidAuthMutationOrigin: vi.fn(),
  recordRateLimitDenial: vi.fn(),
  submitPublicEmployerLead: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/rate-limit-runtime", () => ({
  consumeRequestRateLimit: mocks.consumeRequestRateLimit,
}));
vi.mock("@/lib/auth/request-context", () => ({
  getAuthRequestContext: mocks.getAuthRequestContext,
  isValidAuthMutationOrigin: mocks.isValidAuthMutationOrigin,
}));
vi.mock("@/lib/config/env", () => ({
  getServerEnvironment: mocks.getServerEnvironment,
}));
vi.mock("@/lib/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/lib/sales/public-lead", () => ({
  submitPublicEmployerLead: mocks.submitPublicEmployerLead,
}));
vi.mock("@/lib/security/rate-limit-audit", () => ({
  recordRateLimitDenial: mocks.recordRateLimitDenial,
}));

import { submitEmployerDemoLeadAction } from "@/app/(public)/employers/demo/actions";

const NOW = new Date("2026-07-20T10:15:30.000Z");
const NEUTRAL_SUCCESS_MESSAGE =
  "Danke — deine Anfrage ist erfasst. Unser internes Ziel ist eine Antwort innerhalb eines Werktags; dies ist keine Garantie.";
const REQUEST = Object.freeze({
  correlationId: "78787878-7878-4787-8787-787878787878",
  expectedOrigin: "https://swisstalenthub.example",
  origin: "https://swisstalenthub.example",
  production: true,
  sourceIp: "203.0.113.78",
  userAgent: "Vitest lead action",
});
const DATABASE = Object.freeze({ marker: "database" });
const AUDIT_KEYRING = Object.freeze([{ marker: "audit-keyring" }]);
const ENVIRONMENT = Object.freeze({
  marker: "environment",
  secrets: Object.freeze({
    keyrings: Object.freeze({ AUDIT_IP_HASH_KEYS: AUDIT_KEYRING }),
  }),
});

describe("public employer lead action", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    Object.values(mocks).forEach((mock) => mock.mockReset());

    mocks.getAuthRequestContext.mockResolvedValue(REQUEST);
    mocks.isValidAuthMutationOrigin.mockReturnValue(true);
    mocks.getDatabase.mockReturnValue(DATABASE);
    mocks.getServerEnvironment.mockReturnValue(ENVIRONMENT);
    mocks.consumeRequestRateLimit.mockResolvedValue({
      allowed: true,
      status: 200,
    });
    mocks.recordRateLimitDenial.mockResolvedValue({
      written: true,
      gated: false,
    });
    mocks.submitPublicEmployerLead.mockResolvedValue({
      ok: true,
      leadId: "11111111-1111-4111-8111-111111111111",
      activityId: "22222222-2222-4222-8222-222222222222",
      duplicate: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an invalid origin before rate limiting or any write path", async () => {
    mocks.isValidAuthMutationOrigin.mockReturnValue(false);

    const result = await submitEmployerDemoLeadAction(
      { status: "idle" },
      validLeadForm(),
    );

    expect(result).toEqual({
      status: "error",
      message:
        "Die Anfrage konnte nicht sicher bestätigt werden. Bitte lade die Seite neu.",
    });
    expect(mocks.isValidAuthMutationOrigin).toHaveBeenCalledWith(REQUEST);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.getServerEnvironment).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
    expect(mocks.submitPublicEmployerLead).not.toHaveBeenCalled();
  });

  it("returns German required-field errors before database and rate-limit access", async () => {
    const result = await submitEmployerDemoLeadAction(
      { status: "idle" },
      new FormData(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Bitte prüfe die markierten Angaben.",
      fieldErrors: {
        companyName: [
          "Bitte gib einen Unternehmensnamen mit mindestens 2 Zeichen ein.",
        ],
        contactName: [
          "Bitte gib eine Kontaktperson mit mindestens 2 Zeichen ein.",
        ],
        email: ["Bitte prüfe die E-Mail-Adresse."],
        companySizeCode: ["Bitte wähle eine Unternehmensgrösse."],
        hiringNeedCode: [
          "Bitte wähle den ungefähren Einstellungsbedarf.",
        ],
        interestCode: ["Bitte wähle ein Thema."],
        message: [
          "Bitte beschreibe dein Anliegen mit 20 bis 2'000 Zeichen.",
        ],
        acceptedContactPurpose: ["Bitte bestätige den Kontaktzweck."],
      },
      values: {
        companyName: "",
        contactName: "",
        email: "",
        phone: "",
        companySizeCode: "",
        hiringNeedCode: "",
        interestCode: "",
        message: "",
        callbackWindowCode: "",
      },
    });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.getServerEnvironment).not.toHaveBeenCalled();
    expect(mocks.consumeRequestRateLimit).not.toHaveBeenCalled();
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
    expect(mocks.submitPublicEmployerLead).not.toHaveBeenCalled();
  });

  it("consumes the LEAD limit for a honeypot hit but persists and notifies nothing", async () => {
    const formData = validLeadForm();
    formData.set("websiteConfirmation", "https://spam.example");

    const result = await submitEmployerDemoLeadAction(
      { status: "idle" },
      formData,
    );

    expect(result).toEqual({
      status: "success",
      message: NEUTRAL_SUCCESS_MESSAGE,
    });
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledWith(
      "LEAD",
      {},
      REQUEST,
      NOW,
      { database: DATABASE, environment: ENVIRONMENT },
    );
    expect(mocks.submitPublicEmployerLead).not.toHaveBeenCalled();
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
  });

  it("denies after ten requests and delegates bounded denial auditing", async () => {
    let leadAttempts = 0;
    mocks.consumeRequestRateLimit.mockImplementation(async () => {
      leadAttempts += 1;
      if (leadAttempts <= 10) return { allowed: true, status: 200 };
      return {
        allowed: false,
        status: 429,
        code: "RATE_LIMITED",
        retryAfterSeconds: 60,
        audit: { action: "RATE_LIMITED", preset: "LEAD", scope: "IP" },
      };
    });

    const results = [];
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      results.push(await submitEmployerDemoLeadAction(
        { status: "idle" },
        validLeadForm(`lead-action-attempt-${attempt}`),
      ));
    }

    expect(results.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => ({
      status: "success",
      message: NEUTRAL_SUCCESS_MESSAGE,
    })));
    for (const denied of results.slice(10)) {
      expect(denied).toMatchObject({
        status: "error",
        message: "Zu viele Anfragen in kurzer Zeit. Bitte versuche es später erneut.",
      });
    }
    expect(mocks.consumeRequestRateLimit).toHaveBeenCalledTimes(12);
    expect(leadAttempts).toBe(12);
    expect(mocks.submitPublicEmployerLead).toHaveBeenCalledTimes(10);
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledTimes(2);
    expect(mocks.recordRateLimitDenial).toHaveBeenCalledWith(
      {
        action: "RATE_LIMITED",
        preset: "LEAD",
        scope: "IP",
      },
      {
        actorKind: "ANONYMOUS",
        capability: "PUBLIC_EMPLOYER_DEMO_SUBMIT",
        targetId: REQUEST.correlationId,
        targetType: "SALES_LEAD",
      },
      {
        database: DATABASE,
        environment: ENVIRONMENT,
        request: REQUEST,
        now: NOW,
      },
    );
  });

  it("normalizes and forwards a valid submission", async () => {
    const result = await submitEmployerDemoLeadAction(
      { status: "idle" },
      validLeadForm(),
    );

    expect(result).toEqual({
      status: "success",
      message: NEUTRAL_SUCCESS_MESSAGE,
    });
    expect(mocks.submitPublicEmployerLead).toHaveBeenCalledOnce();
    expect(mocks.submitPublicEmployerLead).toHaveBeenCalledWith(
      {
        companyName: "Beispiel AG",
        contactName: "Mara Muster",
        email: "kontakt@beispiel.ch",
        phone: "+41441234567",
        companySizeCode: "50_249",
        hiringNeedCode: "TWO_TO_FIVE",
        interestCode: "GENERAL",
        message: "Wir möchten fünf offene Stellen gemeinsam besetzen.",
        callbackWindowCode: "AFTERNOON",
        acceptedContactPurpose: "yes",
        idempotencyKey: "lead-action-request-0001",
        websiteConfirmation: "",
      },
      {
        database: DATABASE,
        environment: ENVIRONMENT,
        request: REQUEST,
        now: NOW,
      },
    );
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
  });

  it("returns the dedicated German message when notification confirmation fails", async () => {
    mocks.submitPublicEmployerLead.mockResolvedValue({
      ok: false,
      code: "NOTIFICATION_FAILED",
    });

    const result = await submitEmployerDemoLeadAction(
      { status: "idle" },
      validLeadForm(),
    );

    expect(result).toEqual({
      status: "error",
      message:
        "Deine Anfrage ist gespeichert, die interne Benachrichtigung aber noch nicht bestätigt. Bitte sende das Formular nochmals.",
      values: {
        companyName: "Beispiel AG",
        contactName: "Mara Muster",
        email: "Kontakt@Beispiel.CH",
        phone: "+41 44 123 45 67",
        companySizeCode: "50_249",
        hiringNeedCode: "TWO_TO_FIVE",
        interestCode: "GENERAL",
        message: "Wir möchten fünf offene Stellen gemeinsam besetzen.",
        callbackWindowCode: "AFTERNOON",
      },
    });
    expect(mocks.submitPublicEmployerLead).toHaveBeenCalledOnce();
    expect(mocks.recordRateLimitDenial).not.toHaveBeenCalled();
  });
});

function validLeadForm(
  idempotencyKey = "lead-action-request-0001",
): FormData {
  const formData = new FormData();
  formData.set("companyName", "Beispiel AG");
  formData.set("contactName", "Mara Muster");
  formData.set("email", "Kontakt@Beispiel.CH");
  formData.set("phone", "+41 44 123 45 67");
  formData.set("companySizeCode", "50_249");
  formData.set("hiringNeedCode", "TWO_TO_FIVE");
  formData.set("interestCode", "GENERAL");
  formData.set(
    "message",
    "Wir möchten fünf offene Stellen gemeinsam besetzen.",
  );
  formData.set("callbackWindowCode", "AFTERNOON");
  formData.set("acceptedContactPurpose", "yes");
  formData.set("idempotencyKey", idempotencyKey);
  formData.set("websiteConfirmation", "");
  return formData;
}
