import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { beginCompanyVerification } from "@/lib/companies/verification/owner-service";
import { COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1 } from "@/lib/providers/company-verification/provider-contract";
import {
  createPhase26CompanyTrustFixture,
  PHASE26_DOMAIN,
  PHASE26_LEGAL_NAME,
  PHASE26_UID,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("failure");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 provider and persistence failure behavior", () => {
  it("maps thrown and poison provider responses to a safe failure with zero writes", async () => {
    const current = fixture!;
    const input = {
      companyId: current.companyId,
      membershipId: current.ownerMembershipId,
      expectedCurrentRequestId: null,
      uid: PHASE26_UID,
      legalName: PHASE26_LEGAL_NAME,
      cantonCode: "ZH",
      domain: PHASE26_DOMAIN,
      idempotencyKey: randomUUID(),
    };
    const throwing = vi.fn(async () => {
      throw new Error("raw-provider-secret-must-not-escape");
    });
    await expect(
      beginCompanyVerification(
        input,
        current.ownerDependencies(undefined, {
          registerProvider: {
            adapterKey: "fault_injection",
            adapterVersion: "v1",
            check: throwing,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(throwing).toHaveBeenCalledTimes(1);

    const poison = vi.fn(async () => ({
      contractVersion: "COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1" as const,
      result: "EXACT_MATCH" as const,
      uidMatched: true,
      nameMatched: true,
      cantonMatched: true,
      requestDigest: "not-a-digest",
      responseDigest: "also-not-a-digest",
      providerReferenceDigest: null,
      retryable: false,
      failureCode: null,
      checkedAt: current.now,
      latencyMs: 0,
    }));
    await expect(
      beginCompanyVerification(
        { ...input, idempotencyKey: randomUUID() },
        current.ownerDependencies(undefined, {
          registerProvider: {
            adapterKey: "poison_fixture",
            adapterVersion: "v1",
            check: poison,
          },
        }),
      ),
    ).resolves.toEqual({ ok: false, code: "PROVIDER_UNAVAILABLE" });
    expect(
      await current.database.companyVerificationRequest.count({
        where: { companyId: current.companyId },
      }),
    ).toBe(0);
    expect(
      await current.database.auditLog.count({
        where: { companyId: current.companyId },
      }),
    ).toBe(0);
  });

  it("persists a typed timeout as failed evidence but never projects trust", async () => {
    const current = fixture!;
    const timeout = await beginCompanyVerification(
      {
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        expectedCurrentRequestId: null,
        uid: PHASE26_UID,
        legalName: PHASE26_LEGAL_NAME,
        cantonCode: "ZH",
        domain: PHASE26_DOMAIN,
        idempotencyKey: randomUUID(),
      },
      current.ownerDependencies(undefined, {
        registerProvider: {
          adapterKey: "timeout_fixture",
          adapterVersion: "v1",
          async check() {
            return {
              contractVersion: COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1,
              result: "TIMEOUT",
              uidMatched: null,
              nameMatched: null,
              cantonMatched: null,
              requestDigest: "c".repeat(64),
              responseDigest: "d".repeat(64),
              providerReferenceDigest: null,
              retryable: true,
              failureCode: "PROVIDER_TIMEOUT",
              checkedAt: current.now,
              latencyMs: 30_000,
            };
          },
        },
      }),
    );
    expect(timeout).toMatchObject({
      ok: true,
      value: { registerResult: "TIMEOUT" },
    });
    if (!timeout.ok) throw new Error("Typed timeout was not persisted.");
    const [evidence, projectionCount] = await Promise.all([
      current.database.companyVerificationEvidence.findFirstOrThrow({
        where: {
          verificationRequestId: timeout.value.requestId,
          type: "UID_REGISTER",
        },
        select: { status: true, reasonCode: true },
      }),
      current.database.companyTrustProjection.count({
        where: { companyId: current.companyId },
      }),
    ]);
    expect(evidence).toEqual({
      status: "FAILED",
      reasonCode: "PROVIDER_TIMEOUT",
    });
    expect(projectionCount).toBe(0);
  });
});
