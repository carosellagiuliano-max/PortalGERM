// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  COMPANY_CLAIM_SIGNAL_CODES_V1,
  PUBLIC_EMAIL_DOMAINS_V1,
  getCompanyClaimSignalCodes,
  normalizeCompanyNameSignal,
  normalizeEmployerRegistrationSignals,
  normalizeSwissUid,
  normalizeWorkEmailDomain,
  toClaimSignalAuditMetadata,
  toPersistedCompanyRegistrationSignals,
} from "@/lib/auth/employer-registration-signals";

const CANTON_ID = "11111111-1111-4111-8111-111111111111";

describe("employer registration collision signals", () => {
  it("normalizes domain, company name, UID and canton deterministically", () => {
    expect(normalizeWorkEmailDomain(" Person@BÜRO.CH ")).toBe("xn--bro-hoa.ch");
    expect(normalizeCompanyNameSignal(" Müller & Söhne AG ")).toBe(
      "mueller-soehne-ag",
    );
    expect(normalizeSwissUid("che 116 075 613")).toBe("CHE-116.075.613");
    expect(
      normalizeEmployerRegistrationSignals({
        email: " Owner@Example.CH ",
        companyName: "Müller & Söhne AG",
        uid: "CHE-116.075.613",
        cantonCode: "zh",
      }),
    ).toEqual({
      emailDomainNormalized: "example.ch",
      companyNameNormalized: "mueller-soehne-ag",
      uidNormalized: "CHE-116.075.613",
      cantonCode: "ZH",
    });
  });

  it("rejects malformed confidential signals with German errors", () => {
    expect(() => normalizeWorkEmailDomain("not-an-email")).toThrow(
      "geschäftliche E-Mail-Adresse",
    );
    expect(() => normalizeCompanyNameSignal(" -- ")).toThrow(
      "gültigen Firmennamen",
    );
    expect(() => normalizeSwissUid("DE-123")).toThrow("Schweizer UID");
  });

  it.each(PUBLIC_EMAIL_DOMAINS_V1)(
    "never promotes the public mailbox domain %s to a Company signal",
    (domain) => {
      expect(() => normalizeWorkEmailDomain(`person@${domain}`)).toThrow(
        "öffentlichen E-Mail-Anbieters",
      );
    },
  );

  it("maps the resolved canton and reports only bounded match codes", () => {
    const signals = normalizeEmployerRegistrationSignals({
      email: "owner@example.ch",
      companyName: "Example AG",
      uid: "CHE-116.075.613",
      cantonCode: "ZH",
    });
    const requested = toPersistedCompanyRegistrationSignals(signals, CANTON_ID);
    const candidate = {
      ...requested,
      registrationEmailDomainNormalized: "example.ch",
    };

    expect(getCompanyClaimSignalCodes(requested, candidate)).toEqual([
      "UID",
      "EMAIL_DOMAIN",
      "NAME_CANTON",
    ]);
    expect(toClaimSignalAuditMetadata(["EMAIL_DOMAIN", "NAME_CANTON"])).toEqual({
      signalCodes: ["EMAIL_DOMAIN", "NAME_CANTON"],
    });
    expect(COMPANY_CLAIM_SIGNAL_CODES_V1).toEqual([
      "UID",
      "EMAIL_DOMAIN",
      "NAME_CANTON",
    ]);
  });

  it("rejects invalid canton ids and duplicate audit codes", () => {
    const signals = normalizeEmployerRegistrationSignals({
      email: "owner@example.ch",
      companyName: "Example AG",
      cantonCode: "ZH",
    });
    expect(() =>
      toPersistedCompanyRegistrationSignals(signals, "not-a-canton-id"),
    ).toThrow("Kanton");
    expect(() => toClaimSignalAuditMetadata(["UID", "UID"])).toThrow();
  });
});
