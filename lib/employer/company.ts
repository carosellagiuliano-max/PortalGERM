import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { z } from "zod";

import type {
  AnalyticsWriteRecord,
  AnalyticsWriter,
} from "@/lib/analytics/track";
import { trackAnalyticsEventV1 } from "@/lib/analytics/track";
import {
  writeRequiredAudit,
  type AuditIpContext,
} from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { getEffectiveEntitlements } from "@/lib/billing/entitlements";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import type { DatabaseClient } from "@/lib/db/factory";
import { stripUnsafeHtml } from "@/lib/security/sanitize";
import { isSafeAbsoluteHttpUrl } from "@/lib/validation/common";

const DAY_MILLISECONDS = 86_400_000;
const AUDIT_RETENTION_MILLISECONDS = 400 * DAY_MILLISECONDS;
const OPEN_VERIFICATION_STATUSES = [
  "DRAFT",
  "PENDING",
  "CHANGES_REQUESTED",
] as const;
const TERMINAL_VERIFICATION_STATUSES = ["REJECTED", "REVOKED"] as const;
const COMPANY_ROLES = ["OWNER", "ADMIN", "RECRUITER", "VIEWER"] as const;
const COMPANY_MANAGER_ROLES = ["OWNER", "ADMIN"] as const;

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const nullableBoundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum).nullable();
const nullableHttpUrl = (maximum: number, httpsOnly = false) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) =>
        isSafeAbsoluteHttpUrl(value) &&
        (!httpsOnly || new URL(value).protocol === "https:"),
      "URL must be an absolute safe HTTP URL.",
    )
    .nullable();
const nullableStorageKey = z
  .string()
  .trim()
  .max(512)
  .regex(/^[A-Za-z0-9](?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]*$/u)
  .nullable();

const companyLocationInputSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    cantonId: z.uuid(),
    cityId: z.uuid(),
    address: nullableText(255),
    postalCode: z.string().trim().regex(/^\d{4}$/u).nullable(),
    isPrimary: z.boolean(),
  });

export const employerCompanyProfileSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(200),
    uid: z
      .string()
      .trim()
      .regex(/^CHE-\d{3}\.\d{3}\.\d{3}$/u)
      .nullable(),
    industry: nullableBoundedText(2, 160),
    size: nullableBoundedText(1, 64),
    website: nullableHttpUrl(512),
    logoStorageKey: nullableStorageKey,
    coverStorageKey: nullableStorageKey,
    linkedinUrl: nullableHttpUrl(512, true),
    facebookUrl: nullableHttpUrl(512, true),
    instagramUrl: nullableHttpUrl(512, true),
    about: nullableBoundedText(20, 5_000),
    values: z.array(z.string().trim().min(2).max(160)).max(12),
    benefits: z.array(z.string().trim().min(2).max(200)).max(20),
    locations: z.array(companyLocationInputSchema).max(10),
  })
  .superRefine((profile, context) => {
    addUniqueTextIssues(profile.values, "values", context);
    addUniqueTextIssues(profile.benefits, "benefits", context);
    const ids = profile.locations.flatMap(({ id }) => (id === null ? [] : [id]));
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["locations"],
        message: "Location ids must be unique.",
      });
    }
    const primaryCount = profile.locations.filter(({ isPrimary }) => isPrimary).length;
    if (profile.locations.length > 0 && primaryCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["locations"],
        message: "Exactly one submitted location must be primary.",
      });
    }
  });

export const employerVerificationEvidenceSchema = z.strictObject({
  summary: z.string().trim().min(20).max(1_000),
  reference: z.string().trim().min(2).max(255),
});

export const employerVerificationCommandSchema = z.strictObject({
  expectedCurrentRequestId: z.uuid().nullable(),
  idempotencyKey: z.uuid(),
  evidence: employerVerificationEvidenceSchema,
});

export type EmployerCompanyProfileInput = z.infer<
  typeof employerCompanyProfileSchema
>;
export type EmployerVerificationCommand = z.infer<
  typeof employerVerificationCommandSchema
>;

export const COMPANY_ONBOARDING_REQUIREMENTS = [
  "NAME",
  "INDUSTRY",
  "SIZE",
  "WEBSITE_OR_UID",
  "PRIMARY_LOCATION",
  "PUBLIC_DESCRIPTION",
] as const;
export type CompanyOnboardingRequirement =
  (typeof COMPANY_ONBOARDING_REQUIREMENTS)[number];

export type EmployerCompanyScope = Readonly<{
  companyId: string;
  membershipId: string;
  actorUserId: string;
  correlationId: string;
  now?: Date;
  auditIpContext?: AuditIpContext;
}>;

export type EmployerCompanyWorkspace = Readonly<{
  canManage: boolean;
  enhancedProfileAllowed: boolean;
  membershipRole: (typeof COMPANY_ROLES)[number];
  company: Readonly<{
    id: string;
    name: string;
    slug: string;
    uid: string | null;
    industry: string | null;
    size: string | null;
    website: string | null;
    logoStorageKey: string | null;
    coverStorageKey: string | null;
    linkedinUrl: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
    about: string | null;
    values: readonly string[];
    benefits: readonly string[];
    status: "DRAFT" | "ACTIVE";
    updatedAt: Date;
  }>;
  locations: readonly Readonly<{
    id: string;
    cantonId: string;
    cantonCode: string;
    cantonName: string;
    cityId: string;
    cityName: string;
    address: string | null;
    postalCode: string | null;
    isPrimary: boolean;
  }>[];
  cantons: readonly Readonly<{ id: string; code: string; name: string }>[];
  cities: readonly Readonly<{
    id: string;
    cantonId: string;
    name: string;
  }>[];
  onboardingMissing: readonly CompanyOnboardingRequirement[];
  verification: Readonly<{
    current: EmployerVerificationView | null;
    history: readonly EmployerVerificationView[];
    verified: boolean;
  }>;
}>;

export type EmployerVerificationView = Readonly<{
  id: string;
  status:
    | "DRAFT"
    | "PENDING"
    | "CHANGES_REQUESTED"
    | "VERIFIED"
    | "REJECTED"
    | "REVOKED";
  supersedesRequestId: string | null;
  createdAt: Date;
  updatedAt: Date;
  evidence: Readonly<{ summary: string; reference: string }> | null;
  events: readonly Readonly<{
    kind:
      | "DRAFT_CREATED"
      | "SUBMITTED"
      | "EVIDENCE_REQUESTED"
      | "RESUBMITTED"
      | "VERIFIED"
      | "REJECTED"
      | "REVOKED";
    fromStatus: EmployerVerificationView["status"] | null;
    toStatus: EmployerVerificationView["status"];
    reasonCode: string | null;
    createdAt: Date;
  }>[];
}>;

export type EmployerCompanyActionState = Readonly<{
  status: "idle" | "success" | "error";
  message: string;
  code?: "CONFLICT" | "FORBIDDEN" | "INCOMPLETE";
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
  missingRequirements?: readonly CompanyOnboardingRequirement[];
  nextIdempotencyKey?: string;
}>;

export class EmployerCompanyDomainError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "CONFLICT"
    | "INVALID_REFERENCE"
    | "WRITE_FAILED";

  constructor(code: EmployerCompanyDomainError["code"]) {
    super(`Employer company command failed: ${code}`);
    this.name = "EmployerCompanyDomainError";
    this.code = code;
  }
}

export async function getEmployerCompanyWorkspace(
  database: DatabaseClient,
  scope: Pick<EmployerCompanyScope, "companyId" | "membershipId" | "actorUserId">,
  options: Readonly<{
    now?: Date;
    resolveEnhancedProfileAccess?: (
      companyId: string,
      at: Date,
      database: DatabaseClient,
    ) => Promise<boolean>;
  }> = {},
): Promise<EmployerCompanyWorkspace> {
  // The first database query is the complete Company + active Membership scope.
  // No private Company or verification data is loaded before this predicate.
  const company = await database.company.findFirst({
    where: {
      id: scope.companyId,
      status: { in: ["DRAFT", "ACTIVE"] },
      memberships: {
        some: {
          id: scope.membershipId,
          userId: scope.actorUserId,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      uid: true,
      industry: true,
      size: true,
      website: true,
      logoStorageKey: true,
      coverStorageKey: true,
      linkedinUrl: true,
      facebookUrl: true,
      instagramUrl: true,
      about: true,
      values: true,
      benefits: true,
      status: true,
      updatedAt: true,
      memberships: {
        where: {
          id: scope.membershipId,
          userId: scope.actorUserId,
          status: "ACTIVE",
        },
        take: 1,
        select: { role: true },
      },
      locations: {
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          cantonId: true,
          cityId: true,
          address: true,
          postalCode: true,
          isPrimary: true,
          canton: { select: { code: true, name: true } },
          city: { select: { name: true } },
        },
      },
      verificationRequests: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
        select: {
          id: true,
          status: true,
          supersedesRequestId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  const membership = company?.memberships[0];
  if (company === null || membership === undefined) {
    throw new EmployerCompanyDomainError("NOT_FOUND");
  }
  const companyStatus = company.status;
  if (companyStatus !== "DRAFT" && companyStatus !== "ACTIVE") {
    throw new EmployerCompanyDomainError("NOT_FOUND");
  }
  const canManage = isCompanyManager(membership.role);
  const requestIds = company.verificationRequests.map(({ id }) => id);
  const now = options.now ?? new Date();
  assertValidDate(now);
  const [cantons, cities, verificationDetails, enhancedProfileAllowed] = await Promise.all([
    database.canton.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    database.city.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, cantonId: true, name: true },
    }),
    canManage && requestIds.length > 0
      ? database.companyVerificationRequest.findMany({
          where: {
            companyId: scope.companyId,
            id: { in: requestIds },
            company: {
              memberships: {
                some: {
                  id: scope.membershipId,
                  userId: scope.actorUserId,
                  status: "ACTIVE",
                },
              },
            },
          },
          select: {
            id: true,
            evidenceMetadata: true,
            events: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                kind: true,
                fromStatus: true,
                toStatus: true,
                reasonCode: true,
                createdAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    options.resolveEnhancedProfileAccess?.(scope.companyId, now, database) ??
      resolveEnhancedCompanyProfileAccess(scope.companyId, now, database),
  ]);
  const detailsByRequest = new Map(
    verificationDetails.map(({ id, evidenceMetadata, events }) => [
      id,
      Object.freeze({
        evidence: parseVerificationEvidence(evidenceMetadata),
        events: Object.freeze(events.map((event) => Object.freeze(event))),
      }),
    ]),
  );
  const history = Object.freeze(
    company.verificationRequests.map((request) => {
      const details = detailsByRequest.get(request.id);
      return Object.freeze({
        ...request,
        evidence: details?.evidence ?? null,
        events: details?.events ?? Object.freeze([]),
      });
    }),
  );
  const profileForRequirements = {
    name: company.name,
    industry: company.industry,
    size: company.size,
    website: company.website,
    uid: company.uid,
    about: company.about,
    locations: company.locations,
  };
  return Object.freeze({
    canManage,
    enhancedProfileAllowed,
    membershipRole: membership.role,
    company: Object.freeze({
      id: company.id,
      name: company.name,
      slug: company.slug,
      uid: company.uid,
      industry: company.industry,
      size: company.size,
      website: company.website,
      logoStorageKey: company.logoStorageKey,
      coverStorageKey: company.coverStorageKey,
      linkedinUrl: company.linkedinUrl,
      facebookUrl: company.facebookUrl,
      instagramUrl: company.instagramUrl,
      about: company.about,
      values: Object.freeze([...company.values]),
      benefits: Object.freeze([...company.benefits]),
      status: companyStatus,
      updatedAt: new Date(company.updatedAt),
    }),
    locations: Object.freeze(
      company.locations.map((location) =>
        Object.freeze({
          id: location.id,
          cantonId: location.cantonId,
          cantonCode: location.canton.code.trim(),
          cantonName: location.canton.name,
          cityId: location.cityId,
          cityName: location.city.name,
          address: location.address,
          postalCode: location.postalCode,
          isPrimary: location.isPrimary,
        }),
      ),
    ),
    cantons: Object.freeze(
      cantons.map((canton) =>
        Object.freeze({ ...canton, code: canton.code.trim() }),
      ),
    ),
    cities: Object.freeze(cities.map((city) => Object.freeze(city))),
    onboardingMissing: getCompanyOnboardingMissing(profileForRequirements),
    verification: Object.freeze({
      current: history[0] ?? null,
      history,
      verified: history[0]?.status === "VERIFIED",
    }),
  });
}

export async function saveEmployerCompanyProfile(
  database: DatabaseClient,
  scope: EmployerCompanyScope,
  rawProfile: unknown,
  expectedUpdatedAt: Date,
) {
  const profile = canonicalCompanyProfile(
    employerCompanyProfileSchema.parse(rawProfile),
  );
  assertValidDate(expectedUpdatedAt);
  const now = scope.now ?? new Date();
  assertValidDate(now);
  try {
    return await database.$transaction(
      async (transaction) => {
        const locked = await lockCompanyScope(transaction, scope);
        requireCompanyManager(locked.role);
        if (locked.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }
        const enhancedProfileAllowed = await resolveEnhancedCompanyProfileAccess(
          scope.companyId,
          now,
          transaction,
        );
        if (
          !enhancedProfileAllowed &&
          (profile.coverStorageKey !== locked.coverStorageKey ||
            !sameOrderedText(profile.values, locked.values) ||
            !sameOrderedText(profile.benefits, locked.benefits))
        ) {
          throw new EmployerCompanyDomainError("FORBIDDEN");
        }
        if (
          locked.status === "ACTIVE" &&
          getCompanyOnboardingMissing(profile).length > 0
        ) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }
        await verifyLocationReferences(transaction, profile.locations);
        await reconcileCompanyLocations(
          transaction,
          scope.companyId,
          profile.locations,
          now,
        );
        const updated = await transaction.company.update({
          where: { id: scope.companyId },
          data: {
            name: profile.name,
            uid: profile.uid,
            industry: profile.industry,
            size: profile.size,
            website: profile.website,
            logoStorageKey: profile.logoStorageKey,
            coverStorageKey: profile.coverStorageKey,
            linkedinUrl: profile.linkedinUrl,
            facebookUrl: profile.facebookUrl,
            instagramUrl: profile.instagramUrl,
            about: profile.about,
            values: [...profile.values],
            benefits: [...profile.benefits],
            updatedAt: now,
          },
          select: { slug: true, updatedAt: true },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "COMPANY_PROFILE_UPDATED",
            actorKind: "USER",
            actorUserId: scope.actorUserId,
            capability: "COMPANY_PROFILE_UPDATE",
            companyId: scope.companyId,
            correlationId: scope.correlationId,
            result: "SUCCEEDED",
            retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
            targetId: scope.companyId,
            targetType: "COMPANY",
          },
          scope.auditIpContext,
        );
        return Object.freeze({
          companyId: scope.companyId,
          slug: updated.slug,
          updatedAt: new Date(updated.updatedAt),
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof EmployerCompanyDomainError || error instanceof z.ZodError) {
      throw error;
    }
    if (isPrismaKnownError(error, "P2002")) {
      throw new EmployerCompanyDomainError("CONFLICT");
    }
    throw new EmployerCompanyDomainError("WRITE_FAILED");
  }
}

export async function completeEmployerCompanyOnboarding(
  database: DatabaseClient,
  scope: EmployerCompanyScope,
  expectedUpdatedAt: Date,
) {
  assertValidDate(expectedUpdatedAt);
  const now = scope.now ?? new Date();
  assertValidDate(now);
  try {
    return await database.$transaction(
      async (transaction) => {
        const locked = await lockCompanyScope(transaction, scope);
        requireCompanyManager(locked.role);
        if (locked.status === "ACTIVE") {
          return Object.freeze({
            outcome: "ALREADY_ACTIVE" as const,
            companyId: scope.companyId,
            slug: locked.slug,
          });
        }
        if (locked.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }
        const profile = await transaction.company.findFirst({
          where: { id: scope.companyId, status: "DRAFT" },
          select: {
            name: true,
            industry: true,
            size: true,
            website: true,
            uid: true,
            about: true,
            locations: { select: { isPrimary: true } },
          },
        });
        if (profile === null) throw new EmployerCompanyDomainError("CONFLICT");
        const missing = getCompanyOnboardingMissing(profile);
        if (missing.length > 0) {
          return Object.freeze({
            outcome: "INCOMPLETE" as const,
            companyId: scope.companyId,
            slug: locked.slug,
            missing,
          });
        }
        const changed = await transaction.company.updateMany({
          where: {
            id: scope.companyId,
            status: "DRAFT",
            updatedAt: expectedUpdatedAt,
          },
          data: { status: "ACTIVE", updatedAt: now },
        });
        if (changed.count !== 1) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }
        await transaction.companyStatusEvent.create({
          data: {
            companyId: scope.companyId,
            kind: "ONBOARDING_COMPLETED",
            fromStatus: "DRAFT",
            toStatus: "ACTIVE",
            actorUserId: scope.actorUserId,
            reasonCode: "PROFILE_COMPLETE",
            correlationId: scope.correlationId,
            createdAt: now,
          },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "COMPANY_ONBOARDING_COMPLETED",
            actorKind: "USER",
            actorUserId: scope.actorUserId,
            capability: "COMPANY_ONBOARDING_COMPLETE",
            companyId: scope.companyId,
            correlationId: scope.correlationId,
            reasonCode: "PROFILE_COMPLETE",
            result: "SUCCEEDED",
            retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
            targetId: scope.companyId,
            targetType: "COMPANY",
          },
          scope.auditIpContext,
        );
        await trackAnalyticsEventV1(
          {
            schemaVersion: "1",
            producerEventId: `company-onboarding:${scope.companyId}`,
            occurredAt: now,
            kind: "COMPANY_ONBOARDING_COMPLETED",
            companyId: scope.companyId,
            properties: {
              onboardingRuleVersion: "company-onboarding-v1",
              completionPercentBucket: "100",
            },
          },
          {
            producer: "employer-company",
            productAnalyticsEnabled: false,
            provenance: { company: locked.dataProvenance },
          },
          transactionAnalyticsWriter(transaction),
        );
        return Object.freeze({
          outcome: "COMPLETED" as const,
          companyId: scope.companyId,
          slug: locked.slug,
          missing: Object.freeze([]) as readonly CompanyOnboardingRequirement[],
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof EmployerCompanyDomainError) throw error;
    throw new EmployerCompanyDomainError("WRITE_FAILED");
  }
}

export async function startNewCompanyVerificationCycle(
  database: DatabaseClient,
  scope: EmployerCompanyScope,
  rawCommand: unknown,
) {
  const command = canonicalVerificationCommand(
    employerVerificationCommandSchema.parse(rawCommand),
  );
  return persistVerificationSubmission(database, scope, command, "NEW_CYCLE");
}

export async function submitCurrentCompanyVerification(
  database: DatabaseClient,
  scope: EmployerCompanyScope,
  rawCommand: unknown,
) {
  const command = canonicalVerificationCommand(
    employerVerificationCommandSchema.parse(rawCommand),
  );
  return persistVerificationSubmission(database, scope, command, "CURRENT_CYCLE");
}

async function persistVerificationSubmission(
  database: DatabaseClient,
  scope: EmployerCompanyScope,
  command: EmployerVerificationCommand,
  mode: "NEW_CYCLE" | "CURRENT_CYCLE",
) {
  const now = scope.now ?? new Date();
  assertValidDate(now);
  const submittedEventKey = verificationOperationKey(
    command.idempotencyKey,
    "submitted",
  );
  try {
    return await database.$transaction(
      async (transaction) => {
        const locked = await lockCompanyScope(transaction, scope);
        requireCompanyManager(locked.role);
        const replay = await transaction.companyVerificationEvent.findFirst({
          where: {
            idempotencyKey: submittedEventKey,
            verificationRequest: { companyId: scope.companyId },
          },
          select: { verificationRequestId: true, toStatus: true },
        });
        if (replay !== null) {
          return Object.freeze({
            requestId: replay.verificationRequestId,
            status: replay.toStatus,
            duplicate: true,
          });
        }
        const latest = await transaction.companyVerificationRequest.findFirst({
          where: { companyId: scope.companyId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, status: true },
        });
        if (
          (latest?.id ?? null) !== command.expectedCurrentRequestId
        ) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }

        let requestId: string;
        let fromStatus: "DRAFT" | "CHANGES_REQUESTED";
        let eventKind: "SUBMITTED" | "RESUBMITTED";
        let auditReason: "INITIAL_SUBMISSION" | "NEW_CYCLE" | "RESUBMITTED";
        let transitionAt = now;
        if (mode === "NEW_CYCLE") {
          if (
            latest !== null &&
            !TERMINAL_VERIFICATION_STATUSES.includes(
              latest.status as (typeof TERMINAL_VERIFICATION_STATUSES)[number],
            )
          ) {
            throw new EmployerCompanyDomainError("CONFLICT");
          }
          const request = await transaction.companyVerificationRequest.create({
            data: {
              companyId: scope.companyId,
              requestedByUserId: scope.actorUserId,
              supersedesRequestId: latest?.id ?? null,
              status: "DRAFT",
              evidenceMetadata: verificationEvidenceJson(command.evidence),
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          requestId = request.id;
          await transaction.companyVerificationEvent.create({
            data: {
              verificationRequestId: requestId,
              kind: "DRAFT_CREATED",
              fromStatus: null,
              toStatus: "DRAFT",
              actorUserId: scope.actorUserId,
              reasonCode: latest === null ? "INITIAL_REQUEST" : "NEW_CYCLE",
              evidenceRef: command.evidence.reference,
              idempotencyKey: verificationOperationKey(
                command.idempotencyKey,
                "draft",
              ),
              correlationId: scope.correlationId,
              createdAt: now,
            },
          });
          fromStatus = "DRAFT";
          eventKind = "SUBMITTED";
          auditReason = latest === null ? "INITIAL_SUBMISSION" : "NEW_CYCLE";
          transitionAt = new Date(now.getTime() + 1);
          assertValidDate(transitionAt);
        } else {
          if (
            latest === null ||
            !(["DRAFT", "CHANGES_REQUESTED"] as const).includes(
              latest.status as "DRAFT" | "CHANGES_REQUESTED",
            )
          ) {
            throw new EmployerCompanyDomainError("CONFLICT");
          }
          requestId = latest.id;
          fromStatus = latest.status as "DRAFT" | "CHANGES_REQUESTED";
          eventKind = fromStatus === "DRAFT" ? "SUBMITTED" : "RESUBMITTED";
          auditReason = fromStatus === "DRAFT" ? "INITIAL_SUBMISSION" : "RESUBMITTED";
        }
        const transitioned = await transaction.companyVerificationRequest.updateMany({
          where: {
            id: requestId,
            companyId: scope.companyId,
            status: fromStatus,
          },
          data: {
            status: "PENDING",
            evidenceMetadata: verificationEvidenceJson(command.evidence),
            updatedAt: transitionAt,
          },
        });
        if (transitioned.count !== 1) {
          throw new EmployerCompanyDomainError("CONFLICT");
        }
        await transaction.companyVerificationEvent.create({
          data: {
            verificationRequestId: requestId,
            kind: eventKind,
            fromStatus,
            toStatus: "PENDING",
            actorUserId: scope.actorUserId,
            reasonCode: auditReason,
            evidenceRef: command.evidence.reference,
            idempotencyKey: submittedEventKey,
            correlationId: scope.correlationId,
            createdAt: transitionAt,
          },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "COMPANY_VERIFICATION_SUBMITTED",
            actorKind: "USER",
            actorUserId: scope.actorUserId,
            capability: "COMPANY_VERIFICATION_SUBMIT",
            companyId: scope.companyId,
            correlationId: scope.correlationId,
            reasonCode: auditReason,
            result: "SUCCEEDED",
            retainUntil: new Date(
              transitionAt.getTime() + AUDIT_RETENTION_MILLISECONDS,
            ),
            targetId: requestId,
            targetType: "VERIFICATION_REQUEST",
          },
          scope.auditIpContext,
        );
        await trackAnalyticsEventV1(
          {
            schemaVersion: "1",
            producerEventId: `verification-submitted:${requestId}:${command.idempotencyKey}`,
            occurredAt: transitionAt,
            kind: "COMPANY_VERIFICATION_SUBMITTED",
            companyId: scope.companyId,
            properties: {},
          },
          {
            producer: "employer-company",
            productAnalyticsEnabled: false,
            provenance: { company: locked.dataProvenance },
          },
          transactionAnalyticsWriter(transaction),
        );
        return Object.freeze({ requestId, status: "PENDING" as const, duplicate: false });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof EmployerCompanyDomainError || error instanceof z.ZodError) {
      throw error;
    }
    if (isPrismaKnownError(error, "P2002") || isSerializationFailure(error)) {
      throw new EmployerCompanyDomainError("CONFLICT");
    }
    throw new EmployerCompanyDomainError("WRITE_FAILED");
  }
}

export function getCompanyOnboardingMissing(
  profile: Readonly<{
    name: string | null;
    industry: string | null;
    size: string | null;
    website: string | null;
    uid: string | null;
    about: string | null;
    locations: readonly Readonly<{ isPrimary: boolean }>[];
  }>,
): readonly CompanyOnboardingRequirement[] {
  const missing: CompanyOnboardingRequirement[] = [];
  if (!hasText(profile.name)) missing.push("NAME");
  if (!hasText(profile.industry)) missing.push("INDUSTRY");
  if (!hasText(profile.size)) missing.push("SIZE");
  if (!hasText(profile.website) && !hasText(profile.uid)) {
    missing.push("WEBSITE_OR_UID");
  }
  if (profile.locations.filter(({ isPrimary }) => isPrimary).length !== 1) {
    missing.push("PRIMARY_LOCATION");
  }
  if (!hasText(profile.about)) missing.push("PUBLIC_DESCRIPTION");
  return Object.freeze(missing);
}

type LockedCompanyScope = Readonly<{
  id: string;
  slug: string;
  status: "DRAFT" | "ACTIVE";
  updatedAt: Date;
  dataProvenance: "LIVE" | "DEMO" | "TEST";
  coverStorageKey: string | null;
  values: readonly string[];
  benefits: readonly string[];
  role: (typeof COMPANY_ROLES)[number];
}>;

async function lockCompanyScope(
  transaction: Prisma.TransactionClient,
  scope: Pick<EmployerCompanyScope, "companyId" | "membershipId" | "actorUserId">,
): Promise<LockedCompanyScope> {
  const rows = await transaction.$queryRaw<LockedCompanyScope[]>`
    SELECT
      company.id,
      company.slug,
      company.status,
      company."updatedAt",
      company."dataProvenance",
      company."coverStorageKey",
      company.values,
      company.benefits,
      membership.role
    FROM "Company" AS company
    JOIN "CompanyMembership" AS membership
      ON membership."companyId" = company.id
    WHERE company.id = ${scope.companyId}::uuid
      AND company.status IN ('DRAFT', 'ACTIVE')
      AND membership.id = ${scope.membershipId}::uuid
      AND membership."userId" = ${scope.actorUserId}::uuid
      AND membership.status = 'ACTIVE'
    FOR UPDATE OF company, membership
  `;
  const row = rows[0];
  if (row === undefined || !COMPANY_ROLES.includes(row.role)) {
    throw new EmployerCompanyDomainError("NOT_FOUND");
  }
  return row;
}

function requireCompanyManager(role: LockedCompanyScope["role"]) {
  if (!isCompanyManager(role)) {
    throw new EmployerCompanyDomainError("FORBIDDEN");
  }
}

function isCompanyManager(
  role: (typeof COMPANY_ROLES)[number],
): role is (typeof COMPANY_MANAGER_ROLES)[number] {
  return COMPANY_MANAGER_ROLES.includes(
    role as (typeof COMPANY_MANAGER_ROLES)[number],
  );
}

async function resolveEnhancedCompanyProfileAccess(
  companyId: string,
  now: Date,
  database: Prisma.TransactionClient | DatabaseClient,
) {
  const result = await getEffectiveEntitlements(
    companyId,
    now,
    createPrismaEntitlementRepository(database),
  );
  return result.ok && result.value.rights.ENHANCED_COMPANY_PROFILE;
}

function sameOrderedText(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function verifyLocationReferences(
  transaction: Prisma.TransactionClient,
  locations: readonly EmployerCompanyProfileInput["locations"][number][],
) {
  if (locations.length === 0) return;
  const cityIds = locations.map(({ cityId }) => cityId);
  const rows = await transaction.city.findMany({
    where: { id: { in: cityIds } },
    select: { id: true, cantonId: true },
  });
  const cantonByCity = new Map(rows.map((row) => [row.id, row.cantonId]));
  if (
    locations.some(
      (location) => cantonByCity.get(location.cityId) !== location.cantonId,
    )
  ) {
    throw new EmployerCompanyDomainError("INVALID_REFERENCE");
  }
}

async function reconcileCompanyLocations(
  transaction: Prisma.TransactionClient,
  companyId: string,
  locations: readonly EmployerCompanyProfileInput["locations"][number][],
  now: Date,
) {
  const existing = await transaction.companyLocation.findMany({
    where: { companyId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map(({ id }) => id));
  const retainedIds = locations.flatMap(({ id }) => (id === null ? [] : [id]));
  if (retainedIds.some((id) => !existingIds.has(id))) {
    throw new EmployerCompanyDomainError("INVALID_REFERENCE");
  }
  await transaction.companyLocation.updateMany({
    where: { companyId, isPrimary: true },
    data: { isPrimary: false, updatedAt: now },
  });
  if (retainedIds.length === 0) {
    await transaction.companyLocation.deleteMany({ where: { companyId } });
  } else {
    await transaction.companyLocation.deleteMany({
      where: { companyId, id: { notIn: retainedIds } },
    });
  }
  for (const location of locations) {
    const data = {
      cantonId: location.cantonId,
      cityId: location.cityId,
      address: location.address,
      postalCode: location.postalCode,
      isPrimary: location.isPrimary,
      updatedAt: now,
    };
    if (location.id === null) {
      await transaction.companyLocation.create({
        data: { companyId, ...data, createdAt: now },
      });
    } else {
      const changed = await transaction.companyLocation.updateMany({
        where: { id: location.id, companyId },
        data,
      });
      if (changed.count !== 1) {
        throw new EmployerCompanyDomainError("INVALID_REFERENCE");
      }
    }
  }
}

function canonicalCompanyProfile(
  profile: EmployerCompanyProfileInput,
): EmployerCompanyProfileInput {
  return employerCompanyProfileSchema.parse({
    ...profile,
    name: stripUnsafeHtml(profile.name),
    uid: profile.uid?.toUpperCase() ?? null,
    industry: cleanNullable(profile.industry),
    size: cleanNullable(profile.size),
    website: canonicalUrl(profile.website),
    linkedinUrl: canonicalUrl(profile.linkedinUrl),
    facebookUrl: canonicalUrl(profile.facebookUrl),
    instagramUrl: canonicalUrl(profile.instagramUrl),
    about: cleanNullable(profile.about),
    values: profile.values.map(stripUnsafeHtml),
    benefits: profile.benefits.map(stripUnsafeHtml),
    locations: profile.locations.map((location) => ({
      ...location,
      address: cleanNullable(location.address),
    })),
  });
}

function canonicalVerificationCommand(
  command: EmployerVerificationCommand,
): EmployerVerificationCommand {
  return employerVerificationCommandSchema.parse({
    ...command,
    evidence: {
      summary: stripUnsafeHtml(command.evidence.summary),
      reference: stripUnsafeHtml(command.evidence.reference),
    },
  });
}

function verificationEvidenceJson(
  evidence: EmployerVerificationCommand["evidence"],
): Prisma.InputJsonObject {
  return {
    schemaVersion: "company-verification-evidence-v1",
    summary: evidence.summary,
    reference: evidence.reference,
  };
}

function parseVerificationEvidence(
  value: Prisma.JsonValue | null,
): Readonly<{ summary: string; reference: string }> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const metadata = value as Readonly<Record<string, unknown>>;
  if (metadata.schemaVersion !== "company-verification-evidence-v1") {
    return null;
  }
  const parsed = employerVerificationEvidenceSchema.safeParse({
    summary: metadata.summary,
    reference: metadata.reference,
  });
  return parsed.success ? Object.freeze(parsed.data) : null;
}

function cleanNullable(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = stripUnsafeHtml(value);
  return cleaned.length === 0 ? null : cleaned;
}

function canonicalUrl(value: string | null): string | null {
  if (value === null) return null;
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function addUniqueTextIssues(
  values: readonly string[],
  field: "values" | "benefits",
  context: z.RefinementCtx,
) {
  const canonical = values.map((value) => value.toLocaleLowerCase("de-CH"));
  if (new Set(canonical).size !== canonical.length) {
    context.addIssue({
      code: "custom",
      path: [field],
      message: `${field} must be unique.`,
    });
  }
}

function hasText(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

function assertValidDate(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("A valid command clock is required.");
  }
}

function verificationOperationKey(idempotencyKey: string, suffix: string) {
  return `verification:${idempotencyKey}:${suffix}`;
}

function transactionAnalyticsWriter(
  transaction: Prisma.TransactionClient,
): AnalyticsWriter {
  return Object.freeze({
    async create(record: AnalyticsWriteRecord) {
      try {
        await transaction.analyticsEvent.create({ data: record });
        return "CREATED";
      } catch (error) {
        if (isPrismaKnownError(error, "P2002")) return "DUPLICATE";
        throw error;
      }
    },
    async expire(retainUntilInclusive: Date) {
      const result = await transaction.analyticsEvent.deleteMany({
        where: { retainUntil: { lte: retainUntilInclusive } },
      });
      return result.count;
    },
  });
}

function isPrismaKnownError(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isSerializationFailure(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    /serialization|could not serialize|write conflict/iu.test(error.message)
  );
}

export const EMPLOYER_VERIFICATION_OPEN_STATUSES = Object.freeze([
  ...OPEN_VERIFICATION_STATUSES,
]);
