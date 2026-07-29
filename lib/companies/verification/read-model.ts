import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";

import { getServerEnvironment } from "@/lib/config/env";
import {
  evaluateCompanyTrust,
  evaluateStrongProjection,
  type CompanyTrustActivation,
  type CompanyTrustEvaluation,
  type CompanyTrustProjectionSnapshot,
} from "@/lib/companies/verification/policy-v2";

export type CompanyTrustReader = Pick<
  Prisma.TransactionClient,
  "company" | "trustSafetyContainmentEffect"
>;

export type CompanyTrustReadOptions = Readonly<{
  now?: Date;
  environment?: "local" | "ci" | "preview" | "staging" | "production";
  activation?: CompanyTrustActivation;
}>;

export async function evaluateCompanyTrustForCompany(
  database: CompanyTrustReader,
  companyId: string,
  options: CompanyTrustReadOptions = {},
): Promise<CompanyTrustEvaluation> {
  const evaluations = await evaluateCompanyTrustForCompanies(
    database,
    [companyId],
    options,
  );
  return evaluations.get(companyId) ?? missingCompanyEvaluation(options);
}

/**
 * Bounded readers such as public search and the company directory must not
 * perform one trust lookup per result. This batch reader keeps the same policy
 * decision as the single-company path while loading companies and active
 * containment effects in two indexed queries.
 */
export async function evaluateCompanyTrustForCompanies(
  database: CompanyTrustReader,
  companyIds: readonly string[],
  options: CompanyTrustReadOptions = {},
): Promise<ReadonlyMap<string, CompanyTrustEvaluation>> {
  const uniqueCompanyIds = [...new Set(companyIds)];
  if (uniqueCompanyIds.length === 0) return new Map();
  if (uniqueCompanyIds.length > 500) {
    throw new RangeError(
      "A company-trust read batch exceeded its safety bound.",
    );
  }
  const now = options.now ?? new Date();
  const environment = options.environment ?? getServerEnvironment().APP_ENV;
  const activation =
    options.activation ?? companyTrustActivationFromEnvironment();
  // This reader is frequently called inside an interactive RepeatableRead
  // transaction. Prisma's PostgreSQL adapter owns one connection there and
  // must not receive concurrent client.query calls. Two bounded sequential
  // reads keep the snapshot stable and avoid driver-level fan-out.
  const companies = await database.company.findMany({
    where: { id: { in: uniqueCompanyIds } },
    select: COMPANY_TRUST_READ_SELECT,
  });
  const containments = await database.trustSafetyContainmentEffect.findMany({
    where: {
      targetType: "COMPANY",
      targetId: { in: uniqueCompanyIds },
      reversedAt: null,
    },
    select: { targetId: true },
  });
  const containedCompanyIds = new Set(
    containments.map((containment) => containment.targetId),
  );
  const results = new Map<string, CompanyTrustEvaluation>();
  for (const company of companies) {
    results.set(
      company.id,
      evaluateCompanyTrust({
        activation,
        companyStatus: company.status,
        environment,
        hasActiveContainment: containedCompanyIds.has(company.id),
        legacyVerifiedCycleCount: company.verificationRequests.length,
        now,
        projection: toProjectionSnapshot(company.trustProjections[0] ?? null),
      }),
    );
  }
  for (const companyId of uniqueCompanyIds) {
    if (!results.has(companyId)) {
      results.set(
        companyId,
        evaluateCompanyTrust({
          activation,
          companyStatus: "MISSING",
          environment,
          hasActiveContainment: true,
          legacyVerifiedCycleCount: 0,
          now,
          projection: null,
        }),
      );
    }
  }
  return results;
}

function missingCompanyEvaluation(
  options: CompanyTrustReadOptions,
): CompanyTrustEvaluation {
  const now = options.now ?? new Date();
  const environment = options.environment ?? getServerEnvironment().APP_ENV;
  return evaluateCompanyTrust({
    activation: options.activation ?? companyTrustActivationFromEnvironment(),
    companyStatus: "MISSING",
    environment,
    hasActiveContainment: true,
    legacyVerifiedCycleCount: 0,
    now,
    projection: null,
  });
}

const COMPANY_TRUST_READ_SELECT = {
  id: true,
  status: true,
  verificationRequests: {
    where: { status: "VERIFIED" as const, supersededBy: null },
    take: 2,
    select: { id: true },
  },
  trustProjections: {
    where: { scope: "COMPANY_IDENTITY" as const },
    take: 1,
    select: {
      level: true,
      status: true,
      riskState: true,
      scope: true,
      policyVersion: true,
      verifiedAt: true,
      expiresAt: true,
      evidenceDigest: true,
      decision: {
        select: {
          kind: true,
          scope: true,
          riskLevel: true,
          policyVersion: true,
          decidedByUserId: true,
          approvedByUserId: true,
          validFrom: true,
          validTo: true,
          decidedAt: true,
          evidenceDigest: true,
          verificationRequest: {
            select: { requestedByUserId: true },
          },
        },
      },
      verificationRequest: {
        select: {
          status: true,
          evidence: {
            orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
            take: 20,
            select: {
              type: true,
              scope: true,
              status: true,
              source: true,
              checkedAt: true,
              validFrom: true,
              validTo: true,
              revokedAt: true,
              responseDigest: true,
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.CompanySelect;

export function evaluateMissingCompanyTrust(
  options: CompanyTrustReadOptions = {},
): CompanyTrustEvaluation {
  return missingCompanyEvaluation(options);
}

export function evaluateLoadedCompanyTrust(
  company: Prisma.CompanyGetPayload<{
    select: typeof COMPANY_TRUST_READ_SELECT;
  }>,
  hasActiveContainment: boolean,
  options: CompanyTrustReadOptions = {},
): CompanyTrustEvaluation {
  const now = options.now ?? new Date();
  const environment = options.environment ?? getServerEnvironment().APP_ENV;
  const activation =
    options.activation ?? companyTrustActivationFromEnvironment();
  return evaluateCompanyTrust({
    activation,
    companyStatus: company.status,
    environment,
    hasActiveContainment,
    legacyVerifiedCycleCount: company.verificationRequests.length,
    now,
    projection: toProjectionSnapshot(company.trustProjections[0] ?? null),
  });
}

export function companyTrustActivationFromEnvironment(): CompanyTrustActivation {
  const environment = getServerEnvironment();
  return Object.freeze({
    policyMode: environment.COMPANY_TRUST_V2,
    strongBadge: environment.COMPANY_STRONG_BADGE,
    publicEligibility: environment.COMPANY_TRUST_PUBLIC_ELIGIBILITY,
    rapidRevoke: environment.COMPANY_TRUST_RAPID_REVOKE,
    legacyDemoCompatibility:
      environment.APP_ENV === "local" || environment.APP_ENV === "ci",
  });
}

function toProjectionSnapshot(
  projection: Readonly<{
    level: "NONE" | "LEGACY" | "STRONG";
    status:
      "PENDING" | "ACTIVE" | "EXPIRING" | "EXPIRED" | "ON_HOLD" | "REVOKED";
    riskState: "CLEAR" | "REVIEW" | "HOLD" | "REVOKED";
    scope:
      | "LEGACY_PROFILE"
      | "COMPANY_IDENTITY"
      | "DOMAIN_CONTROL"
      | "REPRESENTATION";
    policyVersion: string;
    verifiedAt: Date | null;
    expiresAt: Date | null;
    evidenceDigest: string;
    decision: null | Readonly<{
      kind:
        "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "REVOKED" | "RESTORED";
      scope:
        | "LEGACY_PROFILE"
        | "COMPANY_IDENTITY"
        | "DOMAIN_CONTROL"
        | "REPRESENTATION";
      riskLevel: "NORMAL" | "HIGH" | "MANUAL_EXCEPTION";
      policyVersion: string;
      decidedByUserId: string;
      approvedByUserId: string | null;
      validFrom: Date | null;
      validTo: Date | null;
      decidedAt: Date;
      evidenceDigest: string;
      verificationRequest: Readonly<{ requestedByUserId: string }>;
    }>;
    verificationRequest: Readonly<{
      status:
        | "DRAFT"
        | "PENDING"
        | "CHANGES_REQUESTED"
        | "VERIFIED"
        | "REJECTED"
        | "REVOKED";
      evidence: readonly Readonly<{
        type:
          | "UID_REGISTER"
          | "DOMAIN_CHALLENGE"
          | "DOCUMENT"
          | "MANUAL_EXCEPTION"
          | "LEGACY_MANUAL";
        scope:
          | "LEGACY_PROFILE"
          | "COMPANY_IDENTITY"
          | "DOMAIN_CONTROL"
          | "REPRESENTATION";
        status:
          "PENDING" | "VALID" | "MISMATCH" | "FAILED" | "EXPIRED" | "REVOKED";
        source: string;
        checkedAt: Date | null;
        validFrom: Date | null;
        validTo: Date | null;
        revokedAt: Date | null;
        responseDigest: string;
      }>[];
    }>;
  }> | null,
): CompanyTrustProjectionSnapshot | null {
  if (projection === null) return null;
  return Object.freeze({
    level: projection.level,
    status: projection.status,
    riskState: projection.riskState,
    scope: projection.scope,
    policyVersion: projection.policyVersion,
    verifiedAt:
      projection.verifiedAt === null ? null : new Date(projection.verifiedAt),
    expiresAt:
      projection.expiresAt === null ? null : new Date(projection.expiresAt),
    evidenceDigest: projection.evidenceDigest,
    verificationRequestStatus: projection.verificationRequest.status,
    evidence: Object.freeze(
      projection.verificationRequest.evidence.map((evidence) =>
        Object.freeze({
          ...evidence,
          checkedAt:
            evidence.checkedAt === null ? null : new Date(evidence.checkedAt),
          validFrom:
            evidence.validFrom === null ? null : new Date(evidence.validFrom),
          validTo:
            evidence.validTo === null ? null : new Date(evidence.validTo),
          revokedAt:
            evidence.revokedAt === null ? null : new Date(evidence.revokedAt),
        }),
      ),
    ),
    decision:
      projection.decision === null
        ? null
        : Object.freeze({
            kind: projection.decision.kind,
            scope: projection.decision.scope,
            riskLevel: projection.decision.riskLevel,
            policyVersion: projection.decision.policyVersion,
            requestedByUserId:
              projection.decision.verificationRequest.requestedByUserId,
            decidedByUserId: projection.decision.decidedByUserId,
            approvedByUserId: projection.decision.approvedByUserId,
            validFrom:
              projection.decision.validFrom === null
                ? null
                : new Date(projection.decision.validFrom),
            validTo:
              projection.decision.validTo === null
                ? null
                : new Date(projection.decision.validTo),
            decidedAt: new Date(projection.decision.decidedAt),
            evidenceDigest: projection.decision.evidenceDigest,
          }),
  });
}

/**
 * Restore checks need to inspect fresh verification evidence while the
 * containment they may reverse is still active. This intentionally ignores
 * company/containment eligibility, but keeps the complete V2 evidence,
 * decision, scope and validity contract.
 */
export async function hasCurrentStrongCompanyTrustEvidence(
  database: CompanyTrustReader,
  companyId: string,
  input: Readonly<{ now: Date; verifiedAfter?: Date }>,
): Promise<boolean> {
  const company = await database.company.findUnique({
    where: { id: companyId },
    select: COMPANY_TRUST_READ_SELECT,
  });
  const projection =
    company === null
      ? null
      : toProjectionSnapshot(company.trustProjections[0] ?? null);
  const evaluated = evaluateStrongProjection(projection, input.now);
  if (!evaluated.ok) return false;
  const boundary = input.verifiedAfter;
  return (
    boundary === undefined ||
    (evaluated.projection.verifiedAt !== null &&
      evaluated.projection.verifiedAt.getTime() > boundary.getTime() &&
      evaluated.projection.decision !== null &&
      evaluated.projection.decision.decidedAt.getTime() > boundary.getTime())
  );
}
