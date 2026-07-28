import { describe, expect, it } from "vitest";

import {
  COMPANY_TRUST_POLICY_V2,
  companyTrustEvidenceDigest,
  evaluateCompanyTrust,
  evaluateStrongProjection,
  type CompanyTrustActivation,
  type CompanyTrustProjectionSnapshot,
} from "@/lib/companies/verification/policy-v2";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const BEFORE = new Date("2026-07-27T12:00:00.000Z");
const AFTER = new Date("2026-08-27T12:00:00.000Z");
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

const ENFORCED: CompanyTrustActivation = Object.freeze({
  policyMode: "enforce",
  strongBadge: true,
  publicEligibility: true,
  rapidRevoke: true,
  legacyDemoCompatibility: false,
});

function strongProjection(
  overrides: Partial<CompanyTrustProjectionSnapshot> = {},
): CompanyTrustProjectionSnapshot {
  const evidence = [
    {
      type: "UID_REGISTER" as const,
      scope: "COMPANY_IDENTITY" as const,
      status: "VALID" as const,
      source: "register:sandbox",
      checkedAt: BEFORE,
      validFrom: BEFORE,
      validTo: AFTER,
      revokedAt: null,
      responseDigest: SHA_A,
    },
    {
      type: "DOMAIN_CHALLENGE" as const,
      scope: "COMPANY_IDENTITY" as const,
      status: "VALID" as const,
      source: "domain:sandbox",
      checkedAt: BEFORE,
      validFrom: BEFORE,
      validTo: AFTER,
      revokedAt: null,
      responseDigest: SHA_B,
    },
  ];
  const evidenceDigest = companyTrustEvidenceDigest(evidence);
  const base: CompanyTrustProjectionSnapshot = {
    level: "STRONG",
    status: "ACTIVE",
    riskState: "CLEAR",
    scope: "COMPANY_IDENTITY",
    policyVersion: COMPANY_TRUST_POLICY_V2.version,
    verifiedAt: BEFORE,
    expiresAt: AFTER,
    evidenceDigest,
    verificationRequestStatus: "VERIFIED",
    evidence,
    decision: {
      kind: "APPROVED",
      scope: "COMPANY_IDENTITY",
      riskLevel: "NORMAL",
      policyVersion: COMPANY_TRUST_POLICY_V2.version,
      requestedByUserId: "owner-user",
      decidedByUserId: "reviewer-user",
      approvedByUserId: null,
      validFrom: BEFORE,
      validTo: AFTER,
      decidedAt: BEFORE,
      evidenceDigest,
    },
  };
  return Object.freeze({
    ...base,
    ...overrides,
  });
}

describe("Phase 26 company trust policy v2", () => {
  it("emits the exact public badge only for a current strong projection", () => {
    const result = evaluateCompanyTrust({
      activation: ENFORCED,
      companyStatus: "ACTIVE",
      environment: "production",
      hasActiveContainment: false,
      legacyVerifiedCycleCount: 0,
      now: NOW,
      projection: strongProjection(),
    });

    expect(result).toMatchObject({
      current: true,
      strongVerified: true,
      publicEligible: true,
      radarEligible: true,
      reason: "STRONG_CURRENT",
      badge: {
        level: "STRONG",
        label: "Firmenidentität geprüft",
        scopeLabel: "UID-Register und Domainkontrolle",
        method: "UID_REGISTER_AND_DOMAIN_CHALLENGE",
        policyVersion: "COMPANY_TRUST_POLICY_V2",
      },
    });
    expect(Object.keys(result.badge ?? {})).toEqual([
      "level",
      "label",
      "scopeLabel",
      "method",
      "policyVersion",
      "copyVersion",
      "verifiedAt",
      "validUntil",
    ]);
  });

  it.each([
    ["missing projection", null, "TRUST_MISSING"],
    [
      "missing domain evidence",
      strongProjection({ evidence: strongProjection().evidence.slice(0, 1) }),
      "EVIDENCE_INCOMPLETE",
    ],
    [
      "revoked evidence",
      strongProjection({
        evidence: strongProjection().evidence.map((row, index) =>
          index === 0 ? { ...row, status: "REVOKED", revokedAt: NOW } : row,
        ),
      }),
      "EVIDENCE_INCOMPLETE",
    ],
    [
      "mismatched evidence digest",
      strongProjection({ evidenceDigest: "c".repeat(64) }),
      "DECISION_INVALID",
    ],
    [
      "legacy policy version",
      strongProjection({ policyVersion: "COMPANY_TRUST_POLICY_V1" }),
      "POLICY_VERSION_MISMATCH",
    ],
    [
      "request no longer verified",
      strongProjection({ verificationRequestStatus: "REVOKED" }),
      "TRUST_NOT_CURRENT",
    ],
    [
      "manual high-risk approval without a second actor",
      strongProjection({
        decision: {
          ...strongProjection().decision!,
          riskLevel: "HIGH",
          approvedByUserId: null,
        },
      }),
      "DECISION_INVALID",
    ],
  ] as const)(
    "denies %s without exposing a strong badge",
    (_label, projection, reason) => {
      const result = evaluateCompanyTrust({
        activation: ENFORCED,
        companyStatus: "ACTIVE",
        environment: "production",
        hasActiveContainment: false,
        legacyVerifiedCycleCount: 0,
        now: NOW,
        projection,
      });
      expect(result).toMatchObject({
        current: false,
        strongVerified: false,
        badge: null,
        publicEligible: false,
        radarEligible: false,
        reason,
      });
    },
  );

  it("uses a half-open validity window and keeps EXPIRING current until the boundary", () => {
    expect(
      evaluateStrongProjection(
        strongProjection({ status: "EXPIRING" }),
        new Date(AFTER.getTime() - 1),
      ),
    ).toMatchObject({ ok: true });
    expect(
      evaluateStrongProjection(strongProjection(), AFTER),
    ).toMatchObject({ ok: false, reason: "TRUST_NOT_CURRENT" });
  });

  it("keeps observation and disabled modes fail-closed for public activation", () => {
    for (const policyMode of ["observe", "disabled"] as const) {
      const result = evaluateCompanyTrust({
        activation: { ...ENFORCED, policyMode },
        companyStatus: "ACTIVE",
        environment: "production",
        hasActiveContainment: false,
        legacyVerifiedCycleCount: 0,
        now: NOW,
        projection: strongProjection(),
      });
      expect(result.badge).toBeNull();
      expect(result.publicEligible).toBe(false);
      expect(result.radarEligible).toBe(false);
      expect(result.reason).toBe("PUBLIC_ACTIVATION_DISABLED");
    }
  });

  it("allows legacy compatibility only in local/CI and never emits the strong badge", () => {
    const activation = {
      ...ENFORCED,
      legacyDemoCompatibility: true,
    } satisfies CompanyTrustActivation;
    const legacy = strongProjection({
      level: "LEGACY",
      scope: "LEGACY_PROFILE",
      policyVersion: "LEGACY_MANUAL_V1",
      evidence: [],
      decision: null,
      evidenceDigest: "",
    });

    const local = evaluateCompanyTrust({
      activation,
      companyStatus: "ACTIVE",
      environment: "local",
      hasActiveContainment: false,
      legacyVerifiedCycleCount: 1,
      now: NOW,
      projection: legacy,
    });
    expect(local).toMatchObject({
      current: true,
      strongVerified: false,
      badge: null,
      publicEligible: true,
      reason: "LEGACY_DEMO_ONLY",
    });

    const production = evaluateCompanyTrust({
      activation,
      companyStatus: "ACTIVE",
      environment: "production",
      hasActiveContainment: false,
      legacyVerifiedCycleCount: 1,
      now: NOW,
      projection: legacy,
    });
    expect(production.publicEligible).toBe(false);
    expect(production.badge).toBeNull();
  });

  it("keeps a strong local demo usable while public activation remains disabled", () => {
    const result = evaluateCompanyTrust({
      activation: {
        policyMode: "disabled",
        strongBadge: false,
        publicEligibility: false,
        rapidRevoke: false,
        legacyDemoCompatibility: true,
      },
      companyStatus: "ACTIVE",
      environment: "local",
      hasActiveContainment: false,
      legacyVerifiedCycleCount: 1,
      now: NOW,
      projection: strongProjection(),
    });

    expect(result).toMatchObject({
      current: true,
      strongVerified: true,
      badge: null,
      publicEligible: true,
      radarEligible: true,
      reason: "LEGACY_DEMO_ONLY",
    });
  });

  it("blocks a current projection immediately when containment is active", () => {
    const result = evaluateCompanyTrust({
      activation: ENFORCED,
      companyStatus: "ACTIVE",
      environment: "production",
      hasActiveContainment: true,
      legacyVerifiedCycleCount: 0,
      now: NOW,
      projection: strongProjection(),
    });
    expect(result).toMatchObject({
      current: false,
      badge: null,
      publicEligible: false,
      reason: "RISK_BLOCKED",
    });
  });
});
