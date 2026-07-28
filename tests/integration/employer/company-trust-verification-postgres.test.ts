import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import {
  createPhase26CompanyTrustFixture,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("trust_verification");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 strong company trust projection", () => {
  it("requires matching PostgreSQL evidence, decision and projection records", async () => {
    const current = fixture!;
    const trust = await current.createStrongTrust();
    const activation = {
      policyMode: "enforce" as const,
      strongBadge: true,
      publicEligibility: true,
      rapidRevoke: true,
      legacyDemoCompatibility: false,
    };

    const verified = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      { now: current.now, environment: "production", activation },
    );
    expect(verified).toMatchObject({
      current: true,
      strongVerified: true,
      publicEligible: true,
      reason: "STRONG_CURRENT",
      badge: {
        label: "Firmenidentität geprüft",
        scopeLabel: "UID-Register und Domainkontrolle",
      },
    });
    const serializedPublicDescriptor = JSON.stringify(verified.badge);
    expect(serializedPublicDescriptor).not.toContain("responseDigest");
    expect(serializedPublicDescriptor).not.toContain("provider");
    expect(serializedPublicDescriptor).not.toContain("challenge");
    expect(serializedPublicDescriptor).not.toContain("document");

    await current.database.companyTrustProjection.update({
      where: { id: trust.projectionId },
      data: { evidenceDigest: "c".repeat(64), version: { increment: 1 } },
    });
    const mismatched = await evaluateCompanyTrustForCompany(
      current.database,
      current.companyId,
      { now: current.now, environment: "production", activation },
    );
    expect(mismatched).toMatchObject({
      current: false,
      badge: null,
      publicEligible: false,
      reason: "DECISION_INVALID",
    });
    await current.database.companyTrustProjection.update({
      where: { id: trust.projectionId },
      data: {
        evidenceDigest: trust.evidenceDigest,
        version: { increment: 1 },
      },
    });

    await expect(
      current.database.companyVerificationDecision.update({
        where: { id: trust.decisionId },
        data: { reasonCode: `ILLEGAL_${randomUUID().slice(0, 8)}` },
      }),
    ).rejects.toThrow(/append-only/u);
    await expect(
      current.database.companyVerificationEvidence.update({
        where: { id: trust.uidEvidenceId },
        data: { responseDigest: "d".repeat(64) },
      }),
    ).rejects.toThrow(/provenance is immutable/u);
  });

  it("does not treat a stale projection as current after its request is revoked", async () => {
    const current = fixture!;
    const projection =
      await current.database.companyTrustProjection.findUniqueOrThrow({
        where: {
          companyId_scope: {
            companyId: current.companyId,
            scope: "COMPANY_IDENTITY",
          },
        },
        select: { verificationRequestId: true },
      });
    await current.database.companyVerificationRequest.update({
      where: { id: projection.verificationRequestId },
      data: { status: "REVOKED", decidedAt: current.now },
    });
    const result = await evaluateCompanyTrustForCompany(
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
          legacyDemoCompatibility: false,
        },
      },
    );
    expect(result).toMatchObject({
      current: false,
      badge: null,
      publicEligible: false,
      reason: "TRUST_NOT_CURRENT",
    });
  });
});
