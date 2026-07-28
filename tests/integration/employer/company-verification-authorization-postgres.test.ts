import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assignCompanyVerification,
  decideCompanyVerification,
} from "@/lib/companies/verification/admin-service";
import {
  beginCompanyVerification,
  verifyCompanyDomainChallenge,
} from "@/lib/companies/verification/owner-service";
import { evaluateCompanyTrustForCompany } from "@/lib/companies/verification/read-model";
import {
  createDeterministicDomainChallengeProvider,
  createDeterministicRegisterProvider,
} from "@/lib/providers/company-verification/deterministic-sandbox";
import {
  createPhase26CompanyTrustFixture,
  PHASE26_DOMAIN,
  PHASE26_LEGAL_NAME,
  PHASE26_UID,
  type Phase26CompanyTrustFixture,
} from "@/tests/fixtures/phase26-company-trust";

let fixture: Phase26CompanyTrustFixture | undefined;

beforeAll(async () => {
  fixture = await createPhase26CompanyTrustFixture("authorization");
}, 120_000);

afterAll(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

describe.sequential("Phase 26 company verification authorization", () => {
  it("denies recruiter, cross-tenant, identity substitution and missing step-up before a provider call", async () => {
    const current = fixture!;
    const registerCheck = vi.fn(
      createDeterministicRegisterProvider(
        [
          {
            uid: PHASE26_UID,
            legalName: PHASE26_LEGAL_NAME,
            cantonCode: "ZH",
            providerReference: "phase26-authorized",
          },
        ],
        () => current.now,
      ).check,
    );
    const dependencies = {
      ...current.ownerDependencies(),
      registerProvider: {
        adapterKey: "deterministic_sandbox",
        adapterVersion: "v1" as const,
        check: registerCheck,
      },
    };
    const base = {
      companyId: current.companyId,
      membershipId: current.ownerMembershipId,
      expectedCurrentRequestId: null,
      uid: PHASE26_UID,
      legalName: PHASE26_LEGAL_NAME,
      cantonCode: "ZH",
      domain: PHASE26_DOMAIN,
      idempotencyKey: randomUUID(),
    };

    await expect(
      beginCompanyVerification(
        {
          ...base,
          membershipId: current.recruiterMembershipId,
          idempotencyKey: randomUUID(),
        },
        current.ownerDependencies(current.recruiter, {
          registerProvider: dependencies.registerProvider,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      beginCompanyVerification(
        { ...base, idempotencyKey: randomUUID() },
        current.ownerDependencies(current.foreignOwner, {
          registerProvider: dependencies.registerProvider,
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      beginCompanyVerification(
        {
          ...base,
          uid: "CHE-222.000.002",
          legalName: "Phase 26 Fremdfirma AG",
          domain: "phase26-foreign.example.test",
          idempotencyKey: randomUUID(),
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, code: "CONFLICT" });
    await expect(
      beginCompanyVerification(
        { ...base, idempotencyKey: randomUUID() },
        { ...dependencies, stepUpMode: "enforce" },
      ),
    ).resolves.toMatchObject({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(registerCheck).not.toHaveBeenCalled();
    expect(
      await current.database.companyVerificationRequest.count({
        where: { companyId: current.companyId },
      }),
    ).toBe(0);
  });

  it("runs owner submit through independent reviewer approval exactly once", async () => {
    const current = fixture!;
    const register = createDeterministicRegisterProvider(
      [
        {
          uid: PHASE26_UID,
          legalName: PHASE26_LEGAL_NAME,
          cantonCode: "ZH",
          providerReference: "phase26-authorized",
        },
      ],
      () => current.now,
    );
    const registerCheck = vi.fn(register.check);
    const domain = createDeterministicDomainChallengeProvider(() => current.now);
    const domainCheck = vi.fn(domain.check);
    const dependencies = current.ownerDependencies(undefined, {
      registerProvider: {
        adapterKey: register.adapterKey,
        adapterVersion: register.adapterVersion,
        check: registerCheck,
      },
      domainProvider: {
        adapterKey: domain.adapterKey,
        adapterVersion: domain.adapterVersion,
        check: domainCheck,
      },
    });
    const idempotencyKey = randomUUID();
    const begin = await beginCompanyVerification(
      {
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        expectedCurrentRequestId: null,
        uid: PHASE26_UID,
        legalName: PHASE26_LEGAL_NAME,
        cantonCode: "ZH",
        domain: PHASE26_DOMAIN,
        idempotencyKey,
      },
      dependencies,
    );
    expect(begin).toMatchObject({
      ok: true,
      value: { registerResult: "EXACT_MATCH", status: "PENDING" },
    });
    if (!begin.ok || begin.value.challengeToken === null) {
      throw new Error("Owner flow did not return its one-time challenge.");
    }
    const replay = await beginCompanyVerification(
      {
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        expectedCurrentRequestId: null,
        uid: PHASE26_UID,
        legalName: PHASE26_LEGAL_NAME,
        cantonCode: "ZH",
        domain: PHASE26_DOMAIN,
        idempotencyKey,
      },
      dependencies,
    );
    expect(replay).toMatchObject({
      ok: true,
      replay: true,
      value: { challengeToken: null },
    });
    expect(registerCheck).toHaveBeenCalledTimes(1);

    const domainResult = await verifyCompanyDomainChallenge(
      {
        companyId: current.companyId,
        membershipId: current.ownerMembershipId,
        verificationRequestId: begin.value.requestId,
        challengeId: begin.value.challengeId,
        challengeToken: begin.value.challengeToken,
        presentedProof: `sth-domain-verification=${begin.value.challengeToken}`,
        idempotencyKey: randomUUID(),
      },
      dependencies,
    );
    expect(domainResult).toMatchObject({
      ok: true,
      value: { domainResult: "EXACT_MATCH" },
    });
    expect(domainCheck).toHaveBeenCalledTimes(1);

    const request =
      await current.database.companyVerificationRequest.findUniqueOrThrow({
        where: { id: begin.value.requestId },
        select: { version: true },
      });
    const assigned = await assignCompanyVerification(
      {
        verificationRequestId: begin.value.requestId,
        expectedVersion: request.version,
        idempotencyKey: randomUUID(),
      },
      current.adminDependencies(),
    );
    expect(assigned).toMatchObject({ ok: true });
    if (!assigned.ok) throw new Error("Reviewer assignment failed.");

    const decisionKey = randomUUID();
    const decided = await decideCompanyVerification(
      {
        verificationRequestId: begin.value.requestId,
        expectedVersion: assigned.value.version,
        decision: "APPROVE",
        reasonCode: "REGISTER_AND_DOMAIN_CONFIRMED",
        idempotencyKey: decisionKey,
      },
      current.adminDependencies(),
    );
    expect(decided).toMatchObject({
      ok: true,
      value: { status: "VERIFIED", trustLevel: "STRONG" },
    });
    const decidedReplay = await decideCompanyVerification(
      {
        verificationRequestId: begin.value.requestId,
        expectedVersion: assigned.value.version,
        decision: "APPROVE",
        reasonCode: "REGISTER_AND_DOMAIN_CONFIRMED",
        idempotencyKey: decisionKey,
      },
      current.adminDependencies(),
    );
    expect(decidedReplay).toMatchObject({ ok: true, replay: true });
    expect(
      await current.database.companyVerificationDecision.count({
        where: { verificationRequestId: begin.value.requestId },
      }),
    ).toBe(1);

    const trust = await evaluateCompanyTrustForCompany(
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
    expect(trust).toMatchObject({
      strongVerified: true,
      publicEligible: true,
      reason: "STRONG_CURRENT",
    });
  });
});
