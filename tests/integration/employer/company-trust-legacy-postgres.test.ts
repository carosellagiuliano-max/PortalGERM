import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("legacy");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 legacy trust classification", () => {
  it("preserves legacy evidence without ever upgrading it to a strong public badge", async () => {
    const current = fixture!;
    const request = await current.database.companyVerificationRequest.create({
      data: {
        companyId: current.companyId,
        requestedByUserId: current.owner.userId,
        status: "VERIFIED",
        policyVersion: "COMPANY_TRUST_POLICY_V1",
        evidenceMetadata: { fixture: "legacy-only" },
        decidedAt: current.now,
        createdAt: current.now,
      },
    });
    const evidenceDigest = createHash("sha256")
      .update(`legacy:${request.id}`)
      .digest("hex");
    await current.database.companyVerificationEvidence.create({
      data: {
        verificationRequestId: request.id,
        companyId: current.companyId,
        createdByUserId: current.owner.userId,
        type: "LEGACY_MANUAL",
        scope: "LEGACY_PROFILE",
        status: "VALID",
        source: "legacy_test_fixture",
        responseDigest: evidenceDigest,
        reasonCode: "LEGACY_NOT_STRONG",
        checkedAt: current.now,
        createdAt: current.now,
      },
    });
    const projection = await current.database.companyTrustProjection.create({
      data: {
        companyId: current.companyId,
        verificationRequestId: request.id,
        scope: "LEGACY_PROFILE",
        level: "LEGACY",
        status: "ACTIVE",
        riskState: "CLEAR",
        policyVersion: "COMPANY_TRUST_POLICY_V1",
        evidenceDigest,
        reasonCode: "LEGACY_REVERIFY_REQUIRED",
        verifiedAt: current.now,
        changedAt: current.now,
        createdAt: current.now,
      },
    });

    const production = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      {
        now: current.now,
        environment: "production",
        activation: {
          policyMode: "enforce",
          strongBadge: true,
          publicEligibility: true,
          rapidRevoke: true,
          legacyDemoCompatibility: true,
        },
      },
    );
    expect(production).toMatchObject({
      current: false,
      strongVerified: false,
      badge: null,
      publicEligible: false,
    });

    const localCompatibility = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      {
        now: current.now,
        environment: "local",
        activation: {
          policyMode: "enforce",
          strongBadge: true,
          publicEligibility: true,
          rapidRevoke: true,
          legacyDemoCompatibility: true,
        },
      },
    );
    expect(localCompatibility).toMatchObject({
      current: true,
      strongVerified: false,
      badge: null,
      publicEligible: true,
      reason: "LEGACY_DEMO_ONLY",
    });

    await expect(
      current.database.companyTrustProjection.update({
        where: { id: projection.id },
        data: {
          level: "STRONG",
          scope: "COMPANY_IDENTITY",
          policyVersion: "COMPANY_TRUST_POLICY_V2",
        },
      }),
    ).rejects.toThrow();
    expect(
      await current.database.companyVerificationRequest.count({
        where: { companyId: current.companyId },
      }),
    ).toBe(1);
  });
});
