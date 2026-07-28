import { createHash, randomUUID } from "node:crypto";

import type { CompanyVerificationAdminDependencies } from "@/lib/companies/verification/admin-service";
import { normalizeCompanyNameSignal } from "@/lib/auth/employer-registration-signals";
import {
  COMPANY_TRUST_POLICY_V2,
  companyTrustEvidenceDigest,
} from "@/lib/companies/verification/policy-v2";
import type { CompanyVerificationOwnerDependencies } from "@/lib/companies/verification/owner-service";
import type { StepUpDependencies } from "@/lib/auth/assurance/step-up-service";
import type { DatabaseClient } from "@/lib/db/factory";
import {
  createDeterministicDomainChallengeProvider,
  createDeterministicRegisterProvider,
} from "@/lib/providers/company-verification/deterministic-sandbox";
import {
  createPhase25SecurityFixture,
  PHASE25_NOW,
  type Phase25Actor,
} from "@/tests/fixtures/phase25-security";

export const PHASE26_NOW = PHASE25_NOW;
export const PHASE26_UID = "CHE-111.000.001";
export const PHASE26_DOMAIN = "phase26-company.example.test";
export const PHASE26_LEGAL_NAME = "Phase 26 Prüfwerk AG";
export const PHASE26_SHA_UID = "a".repeat(64);
export const PHASE26_SHA_DOMAIN = "b".repeat(64);

export type Phase26Actor = Readonly<{
  email: string;
  role: "ADMIN" | "CANDIDATE" | "EMPLOYER" | "RECRUITER";
  sessionId: string;
  userId: string;
}>;

export type Phase26CompanyTrustFixture = Readonly<{
  database: DatabaseClient;
  migrated: Awaited<
    ReturnType<typeof createPhase25SecurityFixture>
  >["migrated"];
  now: Date;
  owner: Phase25Actor;
  recruiter: Phase26Actor;
  foreignOwner: Phase26Actor;
  reviewer: Phase25Actor;
  approver: Phase25Actor;
  companyId: string;
  ownerMembershipId: string;
  recruiterMembershipId: string;
  foreignCompanyId: string;
  foreignMembershipId: string;
  cantonId: string;
  ownerDependencies: (
    actor?: Phase26Actor | Phase25Actor,
    overrides?: Partial<CompanyVerificationOwnerDependencies>,
  ) => CompanyVerificationOwnerDependencies;
  adminDependencies: (
    actor?: Phase25Actor,
    overrides?: Partial<CompanyVerificationAdminDependencies>,
  ) => CompanyVerificationAdminDependencies;
  stepUpDependencies: (
    actor?: Phase25Actor,
    now?: Date,
  ) => StepUpDependencies;
  createStrongTrust: (options?: Readonly<{
    companyId?: string;
    requestedByUserId?: string;
    reviewerUserId?: string;
    approverUserId?: string | null;
    riskLevel?: "NORMAL" | "HIGH" | "MANUAL_EXCEPTION";
    verifiedAt?: Date;
    expiresAt?: Date;
    supersedesRequestId?: string;
    projectionStatus?: "ACTIVE" | "EXPIRING" | "EXPIRED" | "ON_HOLD" | "REVOKED";
    riskState?: "CLEAR" | "REVIEW" | "HOLD" | "REVOKED";
    requestStatus?: "VERIFIED" | "REVOKED";
  }>) => Promise<Phase26StrongTrust>;
  createPendingRequest: (options?: Readonly<{
    companyId?: string;
    requestedByUserId?: string;
    assignedReviewerUserId?: string | null;
    priority?: number;
    riskLevel?: "NORMAL" | "HIGH" | "MANUAL_EXCEPTION";
    createdAt?: Date;
    reviewDueAt?: Date;
  }>) => Promise<{ id: string; version: number }>;
  dispose: () => Promise<void>;
}>;

export type Phase26StrongTrust = Readonly<{
  requestId: string;
  uidEvidenceId: string;
  domainEvidenceId: string;
  challengeId: string;
  decisionId: string;
  projectionId: string;
  evidenceDigest: string;
  validFrom: Date;
  validTo: Date;
}>;

export async function createPhase26CompanyTrustFixture(
  purpose: string,
): Promise<Phase26CompanyTrustFixture> {
  const security = await createPhase25SecurityFixture(`phase26_${purpose}`);
  const database = security.database;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const recruiter = await createActor(database, suffix, "recruiter", "RECRUITER");
  const foreignOwner = await createActor(
    database,
    suffix,
    "foreign-owner",
    "EMPLOYER",
  );
  const canton = await database.canton.create({
    data: {
      code: "ZH",
      name: "Zürich",
      slug: `phase26-zuerich-${suffix}`,
      language: "DE",
      sortOrder: 1,
    },
  });
  const city = await database.city.create({
    data: {
      cantonId: canton.id,
      name: "Zürich",
      slug: `phase26-zuerich-city-${suffix}`,
      sortOrder: 1,
    },
  });
  const company = await createCompany(database, {
    name: PHASE26_LEGAL_NAME,
    slug: `phase26-company-${suffix}`,
    uid: PHASE26_UID,
    website: `https://${PHASE26_DOMAIN}`,
    cantonId: canton.id,
    cityId: city.id,
  });
  const foreignCompany = await createCompany(database, {
    name: "Phase 26 Fremdfirma AG",
    slug: `phase26-foreign-${suffix}`,
    uid: "CHE-222.000.002",
    website: "https://phase26-foreign.example.test",
    cantonId: canton.id,
    cityId: city.id,
  });
  const ownerMembership = await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: security.employer.userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: PHASE26_NOW,
    },
  });
  const recruiterMembership = await database.companyMembership.create({
    data: {
      companyId: company.id,
      userId: recruiter.userId,
      role: "RECRUITER",
      status: "ACTIVE",
      joinedAt: PHASE26_NOW,
    },
  });
  const foreignMembership = await database.companyMembership.create({
    data: {
      companyId: foreignCompany.id,
      userId: foreignOwner.userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: PHASE26_NOW,
    },
  });

  const ownerDependencies = (
    actor: Phase26Actor | Phase25Actor = security.employer,
    overrides: Partial<CompanyVerificationOwnerDependencies> = {},
  ): CompanyVerificationOwnerDependencies => {
    const base = {
      database,
      actor: {
        userId: actor.userId,
        sessionId: actor.sessionId,
        role: actor.role,
        status: "ACTIVE",
      },
      correlationId: randomUUID(),
      now: PHASE26_NOW,
      stepUpMode: "disabled" as const,
      activation: {
        trustV2: "enforce" as const,
        registerCheck: true,
        domainChallenge: true,
        document: true,
      },
      registerProvider: createDeterministicRegisterProvider(
        [
          {
            uid: PHASE26_UID,
            legalName: PHASE26_LEGAL_NAME,
            cantonCode: "ZH",
            providerReference: "phase26-register-fixture",
          },
          {
            uid: "CHE-222.000.002",
            legalName: "Phase 26 Fremdfirma AG",
            cantonCode: "ZH",
            providerReference: "phase26-foreign-register-fixture",
          },
        ],
        () => PHASE26_NOW,
      ),
      domainProvider: createDeterministicDomainChallengeProvider(
        () => PHASE26_NOW,
      ),
    } satisfies CompanyVerificationOwnerDependencies;
    return Object.freeze({ ...base, ...overrides });
  };

  const adminDependencies = (
    actor: Phase25Actor = security.trustReviewer,
    overrides: Partial<CompanyVerificationAdminDependencies> = {},
  ): CompanyVerificationAdminDependencies => {
    const base = {
      ...security.adminDependencies(actor),
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
        status: "ACTIVE",
        sessionId: actor.sessionId,
      },
      stepUpMode: "disabled" as const,
    } satisfies CompanyVerificationAdminDependencies;
    return Object.freeze({ ...base, ...overrides });
  };

  const createStrongTrust = async (
    options: Parameters<Phase26CompanyTrustFixture["createStrongTrust"]>[0] = {},
  ): Promise<Phase26StrongTrust> => {
    const companyId = options.companyId ?? company.id;
    const requestedByUserId =
      options.requestedByUserId ?? security.employer.userId;
    const reviewerUserId =
      options.reviewerUserId ?? security.trustReviewer.userId;
    const riskLevel = options.riskLevel ?? "NORMAL";
    const approverUserId =
      options.approverUserId === undefined
        ? riskLevel === "NORMAL"
          ? null
          : security.trustApprover.userId
        : options.approverUserId;
    const validFrom =
      options.verifiedAt ?? new Date(PHASE26_NOW.getTime() - 60_000);
    const validTo =
      options.expiresAt ??
      new Date(validFrom.getTime() + 180 * 86_400_000);
    const request = await database.companyVerificationRequest.create({
      data: {
        companyId,
        requestedByUserId,
        supersedesRequestId: options.supersedesRequestId,
        assignedReviewerUserId: reviewerUserId,
        status: options.requestStatus ?? "VERIFIED",
        riskLevel,
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        priority: 80,
        assignedAt: validFrom,
        reviewStartedAt: validFrom,
        reviewDueAt: new Date(PHASE26_NOW.getTime() + 3 * 86_400_000),
        decidedAt: validFrom,
        createdAt: validFrom,
      },
    });
    const challenge = await database.companyDomainChallenge.create({
      data: {
        verificationRequestId: request.id,
        companyId,
        issuedByUserId: requestedByUserId,
        domain:
          companyId === company.id
            ? PHASE26_DOMAIN
            : "phase26-foreign.example.test",
        tokenHash: digest(`challenge-token:${request.id}`),
        proofDigest: digest(`challenge-proof:${request.id}`),
        status: "VERIFIED",
        issuedAt: validFrom,
        expiresAt: validTo,
        verifiedAt: validFrom,
        createdAt: validFrom,
      },
    });
    const [uidEvidence, domainEvidence] = await Promise.all([
      database.companyVerificationEvidence.create({
        data: {
          verificationRequestId: request.id,
          companyId,
          createdByUserId: requestedByUserId,
          type: "UID_REGISTER",
          scope: "COMPANY_IDENTITY",
          status: "VALID",
          source: "phase26_register_fixture",
          providerKey: "deterministic_sandbox",
          normalizedIdentifier:
            companyId === company.id ? PHASE26_UID : "CHE-222.000.002",
          responseDigest: PHASE26_SHA_UID,
          checkedAt: validFrom,
          validFrom,
          validTo,
          createdAt: validFrom,
        },
      }),
      database.companyVerificationEvidence.create({
        data: {
          verificationRequestId: request.id,
          companyId,
          createdByUserId: requestedByUserId,
          domainChallengeId: challenge.id,
          type: "DOMAIN_CHALLENGE",
          scope: "COMPANY_IDENTITY",
          status: "VALID",
          source: "phase26_domain_fixture",
          providerKey: "deterministic_sandbox",
          normalizedIdentifier:
            companyId === company.id
              ? PHASE26_DOMAIN
              : "phase26-foreign.example.test",
          responseDigest: PHASE26_SHA_DOMAIN,
          checkedAt: validFrom,
          validFrom,
          validTo,
          createdAt: validFrom,
        },
      }),
    ]);
    const evidenceDigest = companyTrustEvidenceDigest([
      {
        type: uidEvidence.type,
        responseDigest: uidEvidence.responseDigest,
        validTo: uidEvidence.validTo,
      },
      {
        type: domainEvidence.type,
        responseDigest: domainEvidence.responseDigest,
        validTo: domainEvidence.validTo,
      },
    ]);
    const decision = await database.companyVerificationDecision.create({
      data: {
        verificationRequestId: request.id,
        companyId,
        decidedByUserId: reviewerUserId,
        approvedByUserId: approverUserId,
        kind: "APPROVED",
        scope: "COMPANY_IDENTITY",
        riskLevel,
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        reasonCode: "PHASE26_TEST_APPROVED",
        evidenceDigest,
        idempotencyKey: `phase26-decision:${randomUUID()}`,
        validFrom,
        validTo,
        decidedAt: validFrom,
        createdAt: validFrom,
      },
    });
    const projection = await database.companyTrustProjection.upsert({
      where: {
        companyId_scope: {
          companyId,
          scope: "COMPANY_IDENTITY",
        },
      },
      create: {
        companyId,
        verificationRequestId: request.id,
        decisionId: decision.id,
        scope: "COMPANY_IDENTITY",
        level: "STRONG",
        status: options.projectionStatus ?? "ACTIVE",
        riskState: options.riskState ?? "CLEAR",
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        evidenceDigest,
        reasonCode: "PHASE26_TEST_APPROVED",
        verifiedAt: validFrom,
        expiresAt: validTo,
        changedAt: validFrom,
        createdAt: validFrom,
      },
      update: {
        verificationRequestId: request.id,
        decisionId: decision.id,
        level: "STRONG",
        status: options.projectionStatus ?? "ACTIVE",
        riskState: options.riskState ?? "CLEAR",
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        evidenceDigest,
        reasonCode: "PHASE26_TEST_APPROVED",
        verifiedAt: validFrom,
        expiresAt: validTo,
        changedAt: validFrom,
        version: { increment: 1 },
      },
    });
    return Object.freeze({
      requestId: request.id,
      uidEvidenceId: uidEvidence.id,
      domainEvidenceId: domainEvidence.id,
      challengeId: challenge.id,
      decisionId: decision.id,
      projectionId: projection.id,
      evidenceDigest,
      validFrom,
      validTo,
    });
  };

  const createPendingRequest = async (
    options: Parameters<Phase26CompanyTrustFixture["createPendingRequest"]>[0] = {},
  ) => {
    const createdAt =
      options.createdAt ?? new Date(PHASE26_NOW.getTime() - 60_000);
    const request = await database.companyVerificationRequest.create({
      data: {
        companyId: options.companyId ?? company.id,
        requestedByUserId:
          options.requestedByUserId ?? security.employer.userId,
        assignedReviewerUserId: options.assignedReviewerUserId ?? null,
        status: "PENDING",
        riskLevel: options.riskLevel ?? "NORMAL",
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        priority: options.priority ?? 50,
        assignedAt:
          options.assignedReviewerUserId === undefined ||
          options.assignedReviewerUserId === null
            ? null
            : createdAt,
        reviewDueAt:
          options.reviewDueAt ??
          new Date(createdAt.getTime() + 3 * 86_400_000),
        createdAt,
      },
    });
    return Object.freeze({ id: request.id, version: request.version });
  };

  return Object.freeze({
    database,
    migrated: security.migrated,
    now: PHASE26_NOW,
    owner: security.employer,
    recruiter,
    foreignOwner,
    reviewer: security.trustReviewer,
    approver: security.trustApprover,
    companyId: company.id,
    ownerMembershipId: ownerMembership.id,
    recruiterMembershipId: recruiterMembership.id,
    foreignCompanyId: foreignCompany.id,
    foreignMembershipId: foreignMembership.id,
    cantonId: canton.id,
    ownerDependencies,
    adminDependencies,
    stepUpDependencies: (
      actor: Phase25Actor = security.trustReviewer,
      now = PHASE26_NOW,
    ) => security.stepUpDependencies(actor, now),
    createStrongTrust,
    createPendingRequest,
    dispose: security.dispose,
  });
}

async function createActor(
  database: DatabaseClient,
  suffix: string,
  label: string,
  role: Phase26Actor["role"],
): Promise<Phase26Actor> {
  const email = `${label}-${suffix}@phase26.example`;
  const user = await database.user.create({
    data: {
      email,
      emailNormalized: email,
      name: `Phase 26 ${label}`,
      role,
      status: "ACTIVE",
      dataProvenance: "TEST",
      emailVerifiedAt: PHASE26_NOW,
      identityAssurance: "VERIFIED_EMAIL",
    },
  });
  const session = await database.session.create({
    data: {
      userId: user.id,
      tokenHash: digest(`${user.id}:${randomUUID()}`),
      createdAt: new Date(PHASE26_NOW.getTime() - 60_000),
      expiresAt: new Date(PHASE26_NOW.getTime() + 86_400_000),
      absoluteExpiresAt: new Date(
        PHASE26_NOW.getTime() + 7 * 86_400_000,
      ),
    },
  });
  return Object.freeze({
    email,
    role,
    sessionId: session.id,
    userId: user.id,
  });
}

async function createCompany(
  database: DatabaseClient,
  input: Readonly<{
    name: string;
    slug: string;
    uid: string;
    website: string;
    cantonId: string;
    cityId: string;
  }>,
) {
  const company = await database.company.create({
    data: {
      name: input.name,
      slug: input.slug,
      uid: input.uid,
      website: input.website,
      registrationEmailDomainNormalized: new URL(input.website).hostname,
      registrationNameNormalized: normalizeCompanyNameSignal(input.name),
      registrationCantonId: input.cantonId,
      industry: "Prüftechnik",
      size: "10-49",
      about:
        "Fiktive, isolierte Schweizer Firma für die technischen Phase-26-Verifikationstests.",
      status: "DRAFT",
      dataProvenance: "TEST",
      values: [],
      benefits: [],
    },
  });
  await database.companyLocation.create({
    data: {
      companyId: company.id,
      cantonId: input.cantonId,
      cityId: input.cityId,
      isPrimary: true,
    },
  });
  return database.company.update({
    where: { id: company.id },
    data: { status: "ACTIVE" },
  });
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
