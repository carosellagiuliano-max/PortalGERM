import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type { AuditIpContext } from "@/lib/audit/log";
import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { consumeStepUpGrant, type StepUpActor } from "@/lib/auth/assurance/step-up-service";
import { COMPANY_VERIFICATION_CAPACITY_POLICY_V1 } from "@/lib/companies/verification/capacity";
import { COMPANY_TRUST_POLICY_V2 } from "@/lib/companies/verification/policy-v2";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  CompanyDomainChallengeProvider,
  CompanyRegisterCheckResult,
  CompanyRegisterProvider,
  DomainChallengeCheckResult,
} from "@/lib/providers/company-verification/provider-contract";
import {
  COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1,
  normalizeCompanyName,
  providerDigest,
} from "@/lib/providers/company-verification/provider-contract";
import { stripUnsafeHtml } from "@/lib/security/sanitize";

const DAY = 86_400_000;
const AUDIT_RETENTION = 400 * DAY;
const REGISTER_VALIDITY = 365 * DAY;
const DOMAIN_VALIDITY = 180 * DAY;
const CHALLENGE_TTL = 30 * 60_000;
const MAX_DOMAIN_ATTEMPTS = 5;

const uuid = z.uuid();
const uid = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/u);
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u,
  );
const legalName = z.string().trim().min(2).max(200);
const cantonCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/u);
const optionalStepUp = {
  stepUpEvidenceId: uuid.optional(),
  stepUpGrantToken: z.string().min(32).max(128).optional(),
} as const;

export const beginCompanyVerificationSchema = z.strictObject({
  companyId: uuid,
  membershipId: uuid,
  expectedCurrentRequestId: uuid.nullable(),
  uid,
  legalName,
  cantonCode,
  domain,
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const verifyCompanyDomainSchema = z.strictObject({
  companyId: uuid,
  membershipId: uuid,
  verificationRequestId: uuid,
  challengeId: uuid,
  challengeToken: z.string().min(32).max(128),
  presentedProof: z.string().min(32).max(512),
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const submitCompanyVerificationAppealSchema = z.strictObject({
  companyId: uuid,
  membershipId: uuid,
  verificationRequestId: uuid,
  safeStatement: z.string().trim().min(20).max(2_000),
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export const attachCompanyVerificationDocumentSchema = z.strictObject({
  companyId: uuid,
  membershipId: uuid,
  verificationRequestId: uuid,
  documentVersionId: uuid,
  idempotencyKey: uuid,
  ...optionalStepUp,
});

export type CompanyVerificationOwnerDependencies = Readonly<{
  database: DatabaseClient;
  actor: StepUpActor;
  correlationId: string;
  now?: Date;
  auditIpContext?: AuditIpContext;
  stepUpMode: "disabled" | "observe" | "enforce";
  activation: Readonly<{
    trustV2: "disabled" | "observe" | "enforce";
    registerCheck: boolean;
    domainChallenge: boolean;
    document: boolean;
  }>;
  registerProvider: CompanyRegisterProvider;
  domainProvider: CompanyDomainChallengeProvider;
}>;

export type CompanyVerificationOwnerResult<T> =
  | Readonly<{ ok: true; value: Readonly<T>; replay?: boolean }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "FEATURE_DISABLED"
        | "CAPACITY_BLOCKED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONFLICT"
        | "STEP_UP_REQUIRED"
        | "PROVIDER_UNAVAILABLE"
        | "WRITE_FAILED";
    }>;

export async function beginCompanyVerification(
  raw: unknown,
  dependencies: CompanyVerificationOwnerDependencies,
): Promise<
  CompanyVerificationOwnerResult<{
    requestId: string;
    challengeId: string;
    challengeToken: string | null;
    domain: string;
    registerResult: string;
    status: "PENDING";
  }>
> {
  const parsed = beginCompanyVerificationSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (
    dependencies.activation.trustV2 === "disabled" ||
    !dependencies.activation.registerCheck ||
    !dependencies.activation.domainChallenge ||
    dependencies.registerProvider.adapterKey === "disabled" ||
    dependencies.domainProvider.adapterKey === "disabled"
  ) {
    return failure("FEATURE_DISABLED");
  }
  const now = verificationNow(dependencies.now);
  const eventKey = operationKey("submit", parsed.data.idempotencyKey);
  const replay = await dependencies.database.companyVerificationEvent.findFirst({
    where: {
      idempotencyKey: eventKey,
      verificationRequest: {
        companyId: parsed.data.companyId,
        requestedByUserId: dependencies.actor.userId,
      },
    },
    select: {
      verificationRequestId: true,
      verificationRequest: {
        select: {
          domainChallenges: {
            orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { id: true, domain: true },
          },
          evidence: {
            where: { type: "UID_REGISTER" },
            take: 1,
            select: { status: true },
          },
        },
      },
    },
  });
  if (replay !== null) {
    const challenge = replay.verificationRequest.domainChallenges[0];
    if (challenge === undefined) return failure("CONFLICT");
    return success(
      {
        requestId: replay.verificationRequestId,
        challengeId: challenge.id,
        challengeToken: null,
        domain: challenge.domain,
        registerResult:
          replay.verificationRequest.evidence[0]?.status ?? "PENDING",
        status: "PENDING" as const,
      },
      true,
    );
  }

  const company = await loadAuthorizedCompany(
    dependencies.database,
    parsed.data.companyId,
    parsed.data.membershipId,
    dependencies.actor.userId,
  );
  if (company === null) return failure("NOT_FOUND");
  if (company.role !== "OWNER" && company.role !== "ADMIN") {
    return failure("FORBIDDEN");
  }
  if (!verificationInputMatchesCompany(parsed.data, company)) {
    return failure("CONFLICT");
  }
  const latest = company.verificationRequests[0] ?? null;
  if ((latest?.id ?? null) !== parsed.data.expectedCurrentRequestId) {
    return failure("CONFLICT");
  }
  if (
    latest !== null &&
    !["VERIFIED", "REJECTED", "REVOKED"].includes(latest.status)
  ) {
    return failure("CONFLICT");
  }
  const openQueueCount =
    await dependencies.database.companyVerificationRequest.count({
      where: {
        policyVersion: COMPANY_TRUST_POLICY_V2.version,
        status: { in: ["PENDING", "CHANGES_REQUESTED"] },
      },
    });
  if (
    openQueueCount >=
    COMPANY_VERIFICATION_CAPACITY_POLICY_V1.maximumOpenSandboxQueue
  ) {
    return failure("CAPACITY_BLOCKED");
  }
  if (
    dependencies.stepUpMode === "enforce" &&
    !(await dependencies.database.$transaction((transaction) =>
      consumeOwnerStepUp(transaction, dependencies, parsed.data, {
        purpose: "EMPLOYER_COMPANY_TRUST",
        action: "COMPANY_VERIFICATION_CHANGE",
        resourceId: latest?.id ?? parsed.data.companyId,
        now,
      }),
    ))
  ) {
    return failure("STEP_UP_REQUIRED");
  }

  const registerResult = await safeRegisterCheck(
    dependencies.registerProvider,
    {
      uid: parsed.data.uid,
      legalName: parsed.data.legalName,
      cantonCode: parsed.data.cantonCode,
      requestKey: `${eventKey}:register`,
    },
  );
  if (registerResult === null) return failure("PROVIDER_UNAVAILABLE");
  const challengeToken = randomBytes(32).toString("base64url");
  const challengeId = randomUUID();
  const requestId = randomUUID();
  const checkedAt = new Date(registerResult.checkedAt);
  const registerStatus =
    registerResult.result === "EXACT_MATCH"
      ? "VALID"
      : ["PARTIAL_MATCH", "MISMATCH", "NOT_FOUND"].includes(
            registerResult.result,
          )
        ? "MISMATCH"
        : "FAILED";

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await lockAuthorizedCompany(
          transaction,
          parsed.data.companyId,
          parsed.data.membershipId,
          dependencies.actor.userId,
        );
        if (locked === null) return failure("NOT_FOUND");
        if (locked.role !== "OWNER" && locked.role !== "ADMIN") {
          return failure("FORBIDDEN");
        }
        if (!verificationInputMatchesCompany(parsed.data, locked)) {
          return failure("CONFLICT");
        }
        const current = await transaction.companyVerificationRequest.findFirst({
          where: { companyId: parsed.data.companyId, supersededBy: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true },
        });
        if (
          (current?.id ?? null) !== parsed.data.expectedCurrentRequestId ||
          (current !== null &&
            !["VERIFIED", "REJECTED", "REVOKED"].includes(current.status))
        ) {
          return failure("CONFLICT");
        }
        const openQueueCount =
          await transaction.companyVerificationRequest.count({
            where: {
              policyVersion: COMPANY_TRUST_POLICY_V2.version,
              status: { in: ["PENDING", "CHANGES_REQUESTED"] },
            },
          });
        if (
          openQueueCount >=
          COMPANY_VERIFICATION_CAPACITY_POLICY_V1.maximumOpenSandboxQueue
        ) {
          return failure("CAPACITY_BLOCKED");
        }

        await transaction.companyVerificationRequest.create({
          data: {
            id: requestId,
            companyId: parsed.data.companyId,
            requestedByUserId: dependencies.actor.userId,
            supersedesRequestId: current?.id ?? null,
            status: "PENDING",
            riskLevel: "NORMAL",
            policyVersion: COMPANY_TRUST_POLICY_V2.version,
            priority: 50,
            version: 1,
            reviewDueAt: new Date(now.getTime() + 3 * DAY),
            evidenceMetadata: {
              schemaVersion: "2",
              evidenceTypes: ["UID_REGISTER", "DOMAIN_CHALLENGE"],
              publicEvidence: false,
            },
            createdAt: now,
            updatedAt: now,
          },
        });
        await transaction.companyVerificationEvent.createMany({
          data: [
            {
              id: randomUUID(),
              verificationRequestId: requestId,
              kind: "DRAFT_CREATED",
              fromStatus: null,
              toStatus: "DRAFT",
              actorUserId: dependencies.actor.userId,
              reasonCode: "STRUCTURED_V2_REQUEST",
              evidenceRef: null,
              idempotencyKey: operationKey(
                "draft",
                parsed.data.idempotencyKey,
              ),
              correlationId: dependencies.correlationId,
              createdAt: now,
            },
            {
              id: randomUUID(),
              verificationRequestId: requestId,
              kind: "SUBMITTED",
              fromStatus: "DRAFT",
              toStatus: "PENDING",
              actorUserId: dependencies.actor.userId,
              reasonCode: "STRUCTURED_V2_SUBMISSION",
              evidenceRef: null,
              idempotencyKey: eventKey,
              correlationId: dependencies.correlationId,
              createdAt: new Date(now.getTime() + 1),
            },
          ],
        });
        const registerEvidence = await transaction.companyVerificationEvidence.create({
          data: {
            id: randomUUID(),
            verificationRequestId: requestId,
            companyId: parsed.data.companyId,
            createdByUserId: dependencies.actor.userId,
            type: "UID_REGISTER",
            scope: "COMPANY_IDENTITY",
            status: registerStatus,
            source: "company_register",
            providerKey: dependencies.registerProvider.adapterKey,
            normalizedIdentifier: parsed.data.uid,
            responseDigest: registerResult.responseDigest,
            reasonCode:
              registerResult.result === "EXACT_MATCH"
                ? "REGISTER_EXACT_MATCH"
                : registerResult.failureCode ?? registerResult.result,
            checkedAt,
            validFrom:
              registerStatus === "VALID" ? checkedAt : null,
            validTo:
              registerStatus === "VALID"
                ? new Date(checkedAt.getTime() + REGISTER_VALIDITY)
                : null,
            createdAt: now,
          },
          select: { id: true },
        });
        const registerCheck = await transaction.companyVerificationCheck.create({
          data: {
            id: randomUUID(),
            evidenceId: registerEvidence.id,
            companyId: parsed.data.companyId,
            providerUseCase: "COMPANY_REGISTER_CHECK",
            adapterKey: dependencies.registerProvider.adapterKey,
            adapterVersion: dependencies.registerProvider.adapterVersion,
            inputSchemaVersion: "v1",
            outputSchemaVersion: "v1",
            result: registerResult.result,
            uidMatched: registerResult.uidMatched,
            nameMatched: registerResult.nameMatched,
            cantonMatched: registerResult.cantonMatched,
            domainMatched: null,
            requestDigest: registerResult.requestDigest,
            responseDigest: registerResult.responseDigest,
            failureClass: providerFailureClass(registerResult.result),
            failureCode: registerResult.failureCode,
            retryable: registerResult.retryable,
            latencyMs: registerResult.latencyMs,
            providerRequestKey: `${eventKey}:register`,
            checkedAt,
            createdAt: now,
          },
          select: { id: true },
        });
        await transaction.companyDomainChallenge.create({
          data: {
            id: challengeId,
            verificationRequestId: requestId,
            companyId: parsed.data.companyId,
            issuedByUserId: dependencies.actor.userId,
            domain: parsed.data.domain,
            tokenHash: digest(challengeToken),
            status: "PENDING",
            issuedAt: now,
            expiresAt: new Date(now.getTime() + CHALLENGE_TTL),
            createdAt: now,
          },
        });
        await transaction.companyVerificationEvidence.create({
          data: {
            id: randomUUID(),
            verificationRequestId: requestId,
            companyId: parsed.data.companyId,
            createdByUserId: dependencies.actor.userId,
            domainChallengeId: challengeId,
            type: "DOMAIN_CHALLENGE",
            scope: "COMPANY_IDENTITY",
            status: "PENDING",
            source: "domain_challenge",
            providerKey: dependencies.domainProvider.adapterKey,
            normalizedIdentifier: parsed.data.domain,
            responseDigest: providerDigest({
              domain: parsed.data.domain,
              tokenHash: digest(challengeToken),
            }),
            reasonCode: "CHALLENGE_ISSUED",
            createdAt: now,
          },
        });
        await writeAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_SUBMITTED_V2",
          capability: "COMPANY_VERIFICATION_SUBMIT",
          targetId: requestId,
          targetType: "VERIFICATION_REQUEST",
          reasonCode: "STRUCTURED_V2_SUBMISSION",
          companyId: parsed.data.companyId,
        });
        await writeAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_CHECKED_V2",
          capability: "COMPANY_REGISTER_CHECK",
          targetId: registerCheck.id,
          targetType: "COMPANY_VERIFICATION_CHECK",
          reasonCode:
            registerResult.result === "EXACT_MATCH"
              ? "REGISTER_EXACT_MATCH"
              : "REGISTER_NOT_VERIFIED",
          companyId: parsed.data.companyId,
        });
        return success({
          requestId,
          challengeId,
          challengeToken,
          domain: parsed.data.domain,
          registerResult: registerResult.result,
          status: "PENDING" as const,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapWriteError(error);
  }
}

export async function verifyCompanyDomainChallenge(
  raw: unknown,
  dependencies: CompanyVerificationOwnerDependencies,
): Promise<
  CompanyVerificationOwnerResult<{
    requestId: string;
    challengeId: string;
    domainResult: string;
    status: "PENDING";
  }>
> {
  const parsed = verifyCompanyDomainSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (
    dependencies.activation.trustV2 === "disabled" ||
    !dependencies.activation.domainChallenge ||
    dependencies.domainProvider.adapterKey === "disabled"
  ) {
    return failure("FEATURE_DISABLED");
  }
  const now = verificationNow(dependencies.now);
  const providerRequestKey = `${operationKey("domain", parsed.data.idempotencyKey)}:check`;
  const challenge = await dependencies.database.companyDomainChallenge.findFirst({
    where: {
      id: parsed.data.challengeId,
      verificationRequestId: parsed.data.verificationRequestId,
      companyId: parsed.data.companyId,
      verificationRequest: {
        requestedByUserId: dependencies.actor.userId,
        company: {
          memberships: {
            some: {
              id: parsed.data.membershipId,
              userId: dependencies.actor.userId,
              status: "ACTIVE",
              role: { in: ["OWNER", "ADMIN"] },
            },
          },
        },
      },
    },
    select: {
      id: true,
      domain: true,
      tokenHash: true,
      status: true,
      expiresAt: true,
      evidence: { select: { id: true, status: true } },
      verificationRequest: {
        select: {
          status: true,
          evidence: {
            where: {
              type: "DOMAIN_CHALLENGE",
              domainChallengeId: parsed.data.challengeId,
            },
            take: 1,
            select: {
              checks: {
                where: { providerRequestKey },
                take: 1,
                select: { result: true },
              },
            },
          },
        },
      },
    },
  });
  if (challenge === null) return failure("NOT_FOUND");
  const previous =
    challenge.verificationRequest.evidence[0]?.checks[0] ?? null;
  if (previous !== null && challenge.status === "VERIFIED") {
    return success(
      {
        requestId: parsed.data.verificationRequestId,
        challengeId: challenge.id,
        domainResult: previous.result,
        status: "PENDING" as const,
      },
      true,
    );
  }
  if (
    challenge.status !== "PENDING" ||
    challenge.expiresAt.getTime() <= now.getTime() ||
    challenge.tokenHash !== digest(parsed.data.challengeToken) ||
    challenge.verificationRequest.status !== "PENDING" ||
    challenge.evidence === null
  ) {
    return failure("CONFLICT");
  }
  const attemptCount =
    await dependencies.database.companyVerificationCheck.count({
      where: { evidenceId: challenge.evidence.id },
    });
  if (attemptCount >= MAX_DOMAIN_ATTEMPTS) return failure("CONFLICT");
  if (
    dependencies.stepUpMode === "enforce" &&
    !(await dependencies.database.$transaction((transaction) =>
      consumeOwnerStepUp(transaction, dependencies, parsed.data, {
        purpose: "EMPLOYER_COMPANY_TRUST",
        action: "COMPANY_DOMAIN_CHANGE",
        resourceId: parsed.data.verificationRequestId,
        now,
      }),
    ))
  ) {
    return failure("STEP_UP_REQUIRED");
  }

  const result = await safeDomainCheck(dependencies.domainProvider, {
    domain: challenge.domain,
    challengeToken: parsed.data.challengeToken,
    presentedProof: parsed.data.presentedProof,
    requestKey: providerRequestKey,
  });
  if (result === null) return failure("PROVIDER_UNAVAILABLE");
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await lockAuthorizedCompany(
          transaction,
          parsed.data.companyId,
          parsed.data.membershipId,
          dependencies.actor.userId,
        );
        if (locked === null) return failure("NOT_FOUND");
        if (locked.role !== "OWNER" && locked.role !== "ADMIN") {
          return failure("FORBIDDEN");
        }
        await transaction.$queryRaw`
          SELECT "id"
          FROM "CompanyDomainChallenge"
          WHERE "id" = ${parsed.data.challengeId}::uuid
          FOR UPDATE
        `;
        const current = await transaction.companyDomainChallenge.findFirst({
          where: {
            id: parsed.data.challengeId,
            verificationRequestId: parsed.data.verificationRequestId,
            companyId: parsed.data.companyId,
            status: "PENDING",
            expiresAt: { gt: now },
            tokenHash: digest(parsed.data.challengeToken),
          },
          select: {
            id: true,
            evidence: { select: { id: true } },
          },
        });
        if (current?.evidence === null || current === null) {
          return failure("CONFLICT");
        }
        const duplicate =
          await transaction.companyVerificationCheck.findUnique({
            where: { providerRequestKey },
            select: { result: true },
          });
        if (duplicate !== null) {
          return success(
            {
              requestId: parsed.data.verificationRequestId,
              challengeId: current.id,
              domainResult: duplicate.result,
              status: "PENDING" as const,
            },
            true,
          );
        }
        const check = await transaction.companyVerificationCheck.create({
          data: {
            id: randomUUID(),
            evidenceId: current.evidence.id,
            companyId: parsed.data.companyId,
            providerUseCase: "COMPANY_DOMAIN_CHALLENGE",
            adapterKey: dependencies.domainProvider.adapterKey,
            adapterVersion: dependencies.domainProvider.adapterVersion,
            inputSchemaVersion: "v1",
            outputSchemaVersion: "v1",
            result: result.result,
            uidMatched: null,
            nameMatched: null,
            cantonMatched: null,
            domainMatched: result.domainMatched,
            requestDigest: result.requestDigest,
            responseDigest: result.responseDigest,
            failureClass: providerFailureClass(result.result),
            failureCode: result.failureCode,
            retryable: result.retryable,
            latencyMs: result.latencyMs,
            providerRequestKey,
            checkedAt: result.checkedAt,
            createdAt: now,
          },
          select: { id: true },
        });
        if (result.result === "EXACT_MATCH") {
          const validTo = new Date(now.getTime() + DOMAIN_VALIDITY);
          const changed = await transaction.companyDomainChallenge.updateMany({
            where: {
              id: current.id,
              status: "PENDING",
              expiresAt: { gt: now },
            },
            data: {
              status: "VERIFIED",
              proofDigest: providerDigest(parsed.data.presentedProof),
              verifiedAt: now,
            },
          });
          if (changed.count !== 1) return failure("CONFLICT");
          await transaction.companyVerificationEvidence.update({
            where: { id: current.evidence.id },
            data: {
              status: "VALID",
              reasonCode: "DOMAIN_EXACT_MATCH",
              checkedAt: now,
              validFrom: now,
              validTo,
            },
          });
        } else {
          await transaction.companyVerificationEvidence.update({
            where: { id: current.evidence.id },
            data: {
              reasonCode:
                result.failureCode ??
                (result.result === "MISMATCH"
                  ? "DOMAIN_PROOF_MISMATCH"
                  : "DOMAIN_CHECK_FAILED"),
            },
          });
        }
        await writeAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_CHECKED_V2",
          capability: "COMPANY_DOMAIN_CHALLENGE",
          targetId: check.id,
          targetType: "COMPANY_VERIFICATION_CHECK",
          reasonCode:
            result.result === "EXACT_MATCH"
              ? "DOMAIN_EXACT_MATCH"
              : "DOMAIN_NOT_VERIFIED",
          companyId: parsed.data.companyId,
        });
        return success({
          requestId: parsed.data.verificationRequestId,
          challengeId: current.id,
          domainResult: result.result,
          status: "PENDING" as const,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapWriteError(error);
  }
}

export async function submitCompanyVerificationAppeal(
  raw: unknown,
  dependencies: CompanyVerificationOwnerDependencies,
): Promise<
  CompanyVerificationOwnerResult<{ appealId: string; status: "OPEN" }>
> {
  const parsed = submitCompanyVerificationAppealSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (dependencies.activation.trustV2 === "disabled") {
    return failure("FEATURE_DISABLED");
  }
  const now = verificationNow(dependencies.now);
  const safeStatement = stripUnsafeHtml(parsed.data.safeStatement).trim();
  if (safeStatement.length < 20 || safeStatement.length > 2_000) {
    return failure("INVALID_INPUT");
  }
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await lockAuthorizedCompany(
          transaction,
          parsed.data.companyId,
          parsed.data.membershipId,
          dependencies.actor.userId,
        );
        if (locked === null) return failure("NOT_FOUND");
        if (locked.role !== "OWNER" && locked.role !== "ADMIN") {
          return failure("FORBIDDEN");
        }
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeOwnerStepUp(transaction, dependencies, parsed.data, {
            purpose: "EMPLOYER_COMPANY_TRUST",
            action: "COMPANY_TRUST_CHANGE",
            resourceId: parsed.data.verificationRequestId,
            now,
          }))
        ) {
          return failure("STEP_UP_REQUIRED");
        }
        const request = await transaction.companyVerificationRequest.findFirst({
          where: {
            id: parsed.data.verificationRequestId,
            companyId: parsed.data.companyId,
            status: { in: ["REJECTED", "REVOKED"] },
          },
          select: {
            id: true,
            appeals: {
              where: { status: "OPEN" },
              take: 1,
              select: { id: true },
            },
          },
        });
        if (request === null) return failure("NOT_FOUND");
        if (request.appeals[0] !== undefined) {
          return success(
            { appealId: request.appeals[0].id, status: "OPEN" as const },
            true,
          );
        }
        const appealId = randomUUID();
        await transaction.companyVerificationAppeal.create({
          data: {
            id: appealId,
            verificationRequestId: request.id,
            companyId: parsed.data.companyId,
            appellantUserId: dependencies.actor.userId,
            status: "OPEN",
            safeStatement,
            statementDigest: providerDigest(safeStatement),
            createdAt: now,
            updatedAt: now,
          },
        });
        await writeAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_APPEALED_V2",
          capability: "COMPANY_VERIFICATION_APPEAL",
          targetId: appealId,
          targetType: "COMPANY_VERIFICATION_APPEAL",
          reasonCode: "APPEAL_SUBMITTED",
          companyId: parsed.data.companyId,
        });
        return success({ appealId, status: "OPEN" as const });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapWriteError(error);
  }
}

export async function attachCompanyVerificationDocument(
  raw: unknown,
  dependencies: CompanyVerificationOwnerDependencies,
): Promise<
  CompanyVerificationOwnerResult<{
    evidenceId: string;
    documentVersionId: string;
    status: "VALID";
  }>
> {
  const parsed = attachCompanyVerificationDocumentSchema.safeParse(raw);
  if (!parsed.success) return failure("INVALID_INPUT");
  if (
    dependencies.activation.trustV2 === "disabled" ||
    !dependencies.activation.document
  ) {
    return failure("FEATURE_DISABLED");
  }
  const now = verificationNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        const locked = await lockAuthorizedCompany(
          transaction,
          parsed.data.companyId,
          parsed.data.membershipId,
          dependencies.actor.userId,
        );
        if (locked === null) return failure("NOT_FOUND");
        if (locked.role !== "OWNER" && locked.role !== "ADMIN") {
          return failure("FORBIDDEN");
        }
        if (
          dependencies.stepUpMode === "enforce" &&
          !(await consumeOwnerStepUp(transaction, dependencies, parsed.data, {
            purpose: "EMPLOYER_COMPANY_TRUST",
            action: "COMPANY_VERIFICATION_CHANGE",
            resourceId: parsed.data.verificationRequestId,
            now,
          }))
        ) {
          return failure("STEP_UP_REQUIRED");
        }
        await transaction.$queryRaw`
          SELECT "id"
          FROM "DocumentVersion"
          WHERE "id" = ${parsed.data.documentVersionId}::uuid
          FOR UPDATE
        `;
        const version = await transaction.documentVersion.findFirst({
          where: {
            id: parsed.data.documentVersionId,
            companyId: parsed.data.companyId,
            status: "CLEAN",
            replacedAt: null,
            document: {
              companyId: parsed.data.companyId,
              purpose: "COMPANY_VERIFICATION",
              currentVersionId: parsed.data.documentVersionId,
            },
          },
          select: {
            id: true,
            sha256: true,
            scanCompletedAt: true,
            companyVerificationEvidence: {
              select: { id: true, status: true },
            },
          },
        });
        const request = await transaction.companyVerificationRequest.findFirst({
          where: {
            id: parsed.data.verificationRequestId,
            companyId: parsed.data.companyId,
            requestedByUserId: dependencies.actor.userId,
            policyVersion: COMPANY_TRUST_POLICY_V2.version,
            status: { in: ["PENDING", "CHANGES_REQUESTED"] },
            supersededBy: null,
          },
          select: { id: true },
        });
        if (
          version === null ||
          version.sha256 === null ||
          version.scanCompletedAt === null ||
          request === null
        ) {
          return failure("NOT_FOUND");
        }
        if (version.companyVerificationEvidence !== null) {
          return success(
            {
              evidenceId: version.companyVerificationEvidence.id,
              documentVersionId: version.id,
              status: "VALID" as const,
            },
            true,
          );
        }
        const evidenceId = randomUUID();
        const validTo = new Date(now.getTime() + REGISTER_VALIDITY);
        await transaction.companyVerificationEvidence.create({
          data: {
            id: evidenceId,
            verificationRequestId: request.id,
            companyId: parsed.data.companyId,
            createdByUserId: dependencies.actor.userId,
            documentVersionId: version.id,
            type: "DOCUMENT",
            scope: "REPRESENTATION",
            status: "VALID",
            source: "phase21_vault",
            providerKey: "vault_scanner",
            normalizedIdentifier: null,
            responseDigest: providerDigest({
              documentVersionId: version.id,
              sha256: version.sha256,
              scanCompletedAt: version.scanCompletedAt.toISOString(),
            }),
            reasonCode: "CLEAN_CURRENT_VERIFICATION_DOCUMENT",
            checkedAt: now,
            validFrom: now,
            validTo,
            createdAt: now,
          },
        });
        await writeAudit(transaction, dependencies, now, {
          action: "COMPANY_VERIFICATION_CHECKED_V2",
          capability: "COMPANY_VERIFICATION_DOCUMENT_ATTACH",
          targetId: evidenceId,
          targetType: "COMPANY_VERIFICATION_EVIDENCE",
          reasonCode: "CLEAN_CURRENT_VERIFICATION_DOCUMENT",
          companyId: parsed.data.companyId,
        });
        return success({
          evidenceId,
          documentVersionId: version.id,
          status: "VALID" as const,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    return mapWriteError(error);
  }
}

async function loadAuthorizedCompany(
  database: DatabaseClient,
  companyId: string,
  membershipId: string,
  actorUserId: string,
) {
  return database.company.findFirst({
    where: {
      id: companyId,
      status: "ACTIVE",
      memberships: {
        some: {
          id: membershipId,
          userId: actorUserId,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      uid: true,
      website: true,
      registrationCanton: { select: { code: true } },
      status: true,
      memberships: {
        where: {
          id: membershipId,
          userId: actorUserId,
          status: "ACTIVE",
        },
        take: 1,
        select: { role: true },
      },
      verificationRequests: {
        where: { supersededBy: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, status: true },
      },
    },
  }).then((company) => {
    const role = company?.memberships[0]?.role;
    return company === null || role === undefined
      ? null
      : Object.freeze({ ...company, role });
  });
}

async function lockAuthorizedCompany(
  transaction: Prisma.TransactionClient,
  companyId: string,
  membershipId: string,
  actorUserId: string,
): Promise<
  Readonly<{
    id: string;
    role: string;
    name: string;
    uid: string | null;
    website: string | null;
    cantonCode: string | null;
  }> | null
> {
  const rows = await transaction.$queryRaw<
    Readonly<{
      id: string;
      role: string;
      name: string;
      uid: string | null;
      website: string | null;
      cantonCode: string | null;
    }>[]
  >`
    SELECT
      company."id",
      company."name",
      company."uid",
      company."website",
      canton."code" AS "cantonCode",
      membership."role"::text AS "role"
    FROM "Company" company
    JOIN "CompanyMembership" membership
      ON membership."companyId" = company."id"
    LEFT JOIN "Canton" canton
      ON canton."id" = company."registrationCantonId"
    WHERE company."id" = ${companyId}::uuid
      AND company."status" = 'ACTIVE'
      AND membership."id" = ${membershipId}::uuid
      AND membership."userId" = ${actorUserId}::uuid
      AND membership."status" = 'ACTIVE'
      AND membership."removedAt" IS NULL
    FOR UPDATE OF company, membership
  `;
  return rows[0] ?? null;
}

function verificationInputMatchesCompany(
  input: Readonly<{
    uid: string;
    legalName: string;
    cantonCode: string;
    domain: string;
  }>,
  company: Readonly<{
    uid: string | null;
    name: string;
    website: string | null;
    registrationCanton?: Readonly<{ code: string }> | null;
    cantonCode?: string | null;
  }>,
) {
  const cantonCode =
    company.cantonCode ?? company.registrationCanton?.code ?? null;
  return (
    company.uid === input.uid &&
    normalizeCompanyName(company.name) === normalizeCompanyName(input.legalName) &&
    cantonCode === input.cantonCode &&
    registeredWebsiteDomain(company.website) === input.domain
  );
}

function registeredWebsiteDomain(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function safeRegisterCheck(
  provider: CompanyRegisterProvider,
  input: Parameters<CompanyRegisterProvider["check"]>[0],
): Promise<CompanyRegisterCheckResult | null> {
  try {
    const result = await provider.check(input);
    return isSafeRegisterResult(result) ? result : null;
  } catch {
    return null;
  }
}

async function safeDomainCheck(
  provider: CompanyDomainChallengeProvider,
  input: Parameters<CompanyDomainChallengeProvider["check"]>[0],
): Promise<DomainChallengeCheckResult | null> {
  try {
    const result = await provider.check(input);
    return isSafeDomainResult(result) ? result : null;
  } catch {
    return null;
  }
}

function isSafeRegisterResult(result: CompanyRegisterCheckResult) {
  return (
    result.contractVersion === COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1 &&
    [
      "EXACT_MATCH",
      "PARTIAL_MATCH",
      "MISMATCH",
      "NOT_FOUND",
      "MALFORMED",
      "TIMEOUT",
      "RATE_LIMITED",
      "PROVIDER_ERROR",
    ].includes(result.result) &&
    safeProviderCommon(result) &&
    (result.providerReferenceDigest === null ||
      /^[a-f0-9]{64}$/u.test(result.providerReferenceDigest)) &&
    (result.result !== "EXACT_MATCH" ||
      (result.uidMatched === true &&
        result.nameMatched === true &&
        result.cantonMatched === true))
  );
}

function isSafeDomainResult(result: DomainChallengeCheckResult) {
  return (
    result.contractVersion === COMPANY_VERIFICATION_PROVIDER_CONTRACT_V1 &&
    [
      "EXACT_MATCH",
      "MISMATCH",
      "NOT_FOUND",
      "MALFORMED",
      "TIMEOUT",
      "RATE_LIMITED",
      "PROVIDER_ERROR",
    ].includes(result.result) &&
    safeProviderCommon(result) &&
    (result.result !== "EXACT_MATCH" || result.domainMatched === true)
  );
}

function safeProviderCommon(
  result: Readonly<{
    requestDigest: string;
    responseDigest: string;
    retryable: boolean;
    failureCode: string | null;
    checkedAt: Date;
    latencyMs: number;
  }>,
) {
  return (
    /^[a-f0-9]{64}$/u.test(result.requestDigest) &&
    /^[a-f0-9]{64}$/u.test(result.responseDigest) &&
    typeof result.retryable === "boolean" &&
    (result.failureCode === null ||
      /^[A-Z][A-Z0-9_]{1,63}$/u.test(result.failureCode)) &&
    result.checkedAt instanceof Date &&
    Number.isFinite(result.checkedAt.getTime()) &&
    Number.isInteger(result.latencyMs) &&
    result.latencyMs >= 0 &&
    result.latencyMs <= 300_000
  );
}

async function consumeOwnerStepUp(
  transaction: Prisma.TransactionClient,
  dependencies: CompanyVerificationOwnerDependencies,
  input: Readonly<{
    companyId: string;
    stepUpEvidenceId?: string;
    stepUpGrantToken?: string;
  }>,
  binding: Readonly<{
    purpose: string;
    action: string;
    resourceId: string;
    now: Date;
  }>,
) {
  return (
    input.stepUpEvidenceId !== undefined &&
    input.stepUpGrantToken !== undefined &&
    (await consumeStepUpGrant(transaction, {
      evidenceId: input.stepUpEvidenceId,
      grantToken: input.stepUpGrantToken,
      actor: dependencies.actor,
      purpose: binding.purpose,
      action: binding.action,
      tenantId: input.companyId,
      resourceId: binding.resourceId,
      correlationId: dependencies.correlationId,
      now: binding.now,
    }))
  );
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  dependencies: CompanyVerificationOwnerDependencies,
  now: Date,
  input: Readonly<{
    action:
      | "COMPANY_VERIFICATION_SUBMITTED_V2"
      | "COMPANY_VERIFICATION_CHECKED_V2"
      | "COMPANY_VERIFICATION_APPEALED_V2";
    capability: string;
    targetId: string;
    targetType:
      | "VERIFICATION_REQUEST"
      | "COMPANY_VERIFICATION_CHECK"
      | "COMPANY_VERIFICATION_EVIDENCE"
      | "COMPANY_VERIFICATION_APPEAL";
    reasonCode: string;
    companyId: string;
  }>,
) {
  return writeRequiredAudit(
    createPrismaTransactionAuditPort(transaction),
    {
      action: input.action,
      actorKind: "USER",
      actorUserId: dependencies.actor.userId,
      capability: input.capability,
      companyId: input.companyId,
      correlationId: dependencies.correlationId,
      reasonCode: input.reasonCode,
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION),
      targetId: input.targetId,
      targetType: input.targetType,
    },
    dependencies.auditIpContext,
  );
}

function providerFailureClass(
  result: string,
):
  | "TRANSIENT"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PERMANENT_VALIDATION"
  | "CONFIGURATION"
  | null {
  if (result === "TIMEOUT") return "TIMEOUT";
  if (result === "RATE_LIMITED") return "RATE_LIMITED";
  if (result === "MALFORMED") return "PERMANENT_VALIDATION";
  if (result === "PROVIDER_ERROR") return "TRANSIENT";
  return null;
}

function operationKey(kind: string, idempotencyKey: string) {
  return `phase26:${kind}:${idempotencyKey}`;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function verificationNow(value?: Date) {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("Company verification requires a valid clock.");
  }
  return new Date(now);
}

function success<T>(
  value: T,
  replay = false,
): CompanyVerificationOwnerResult<T> {
  return Object.freeze({
    ok: true,
    value: Object.freeze(value),
    ...(replay ? { replay: true } : {}),
  });
}

function failure(
  code: Extract<CompanyVerificationOwnerResult<never>, { ok: false }>["code"],
): CompanyVerificationOwnerResult<never> {
  return Object.freeze({ ok: false, code });
}

function mapWriteError(
  error: unknown,
): CompanyVerificationOwnerResult<never> {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2003"].includes(error.code)
  ) {
    return failure("CONFLICT");
  }
  return failure("WRITE_FAILED");
}
