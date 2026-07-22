import "server-only";

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import { writeRequiredAudit } from "@/lib/audit/log";
import { consumeRequestRateLimit } from "@/lib/auth/rate-limit-runtime";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { consumeOneCompanyCreditInLockedTransaction } from "@/lib/billing/credits";
import { getEffectiveEntitlements } from "@/lib/billing/entitlements";
import { canRequestContact } from "@/lib/billing/feature-gates";
import { createPrismaEntitlementRepository } from "@/lib/billing/prisma-publish-quota";
import type {
  SecretHandle,
  ServerEnvironment,
} from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import { Prisma } from "@/lib/generated/prisma/client";
import { createPrismaNotificationPort } from "@/lib/notifications/prisma-port";
import { writeNotificationExactlyOnce } from "@/lib/notifications/writer";
import {
  EmailLogIdempotencyConflictError,
  MockEmailProvider,
  type EmailLogRepository,
  type MockEmailLogRecord,
} from "@/lib/providers/email/mock-email-provider";
import {
  type RadarOpaqueKey,
} from "@/lib/privacy/radar-opaque";
import {
  buildRadarCandidateEligibilitySelect,
  isRadarCandidateEligible,
  toRadarCandidateEligibilityInput,
  type RadarEligibilityEnvironment,
} from "@/lib/talentradar/eligibility";
import { isCurrentRadarContactCohortAuthorized } from "@/lib/talentradar/list-candidates";
import {
  resolveRadarOpaqueId,
  type RadarOpaqueMappingRecord,
} from "@/lib/talentradar/opaque-id";
import {
  RADAR_PRIVACY_POLICY_V1,
  parsePersistedRadarFiltersV1,
} from "@/lib/talentradar/privacy-policy-v1";

const DAY_MILLISECONDS = 86_400_000;
const AUDIT_RETENTION_MILLISECONDS = 10 * 365 * DAY_MILLISECONDS;
const MAX_SERIALIZABLE_ATTEMPTS = 4;
const SAFE_PLAIN_TEXT = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u;
const SIGNED_PROOF = /^[A-Za-z0-9._~-]+$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]+$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SHA_256_HEX = /^[a-f0-9]{64}$/u;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

export const TALENT_CONTACT_POLICY_V1 = Object.freeze({
  version: "v1" as const,
  requestLifetimeMilliseconds: 14 * DAY_MILLISECONDS,
  recontactCooldownMilliseconds: 30 * DAY_MILLISECONDS,
  maximumSubjectCodePoints: 200,
  maximumMessageCodePoints: 500,
  suggestedProductSlug: "contact-pack-10" as const,
});

export const RADAR_CONTACT_SEARCH_PROOF_POLICY_V1 = Object.freeze({
  version: 1 as const,
  context: "swisstalenthub:talent-radar:contact-search-proof:v1" as const,
  maximumLifetimeMilliseconds:
    RADAR_PRIVACY_POLICY_V1.cursor.ttlMilliseconds,
  allowedClockSkewMilliseconds: 30 * 1_000,
  maximumTokenLength: 2_048,
});

const radarContactSearchProofPayloadSchema = z.strictObject({
  version: z.literal(RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.version),
  searchSessionId: z.uuid(),
  actorUserId: z.uuid(),
  companyId: z.uuid(),
  membershipId: z.uuid(),
  filterHash: z.string().regex(SHA_256_HEX),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export type RadarContactSearchProofPayloadV1 = Readonly<
  z.infer<typeof radarContactSearchProofPayloadSchema>
>;

export type RadarContactSearchProofSigningKey = Pick<
  SecretHandle<"SESSION_SECRET">,
  "withValue"
>;

const plainText = (maximumCodePoints: number, allowLineBreaks: boolean) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => Array.from(value).length <= maximumCodePoints,
      `Text exceeds ${maximumCodePoints} Unicode characters.`,
    )
    .regex(SAFE_PLAIN_TEXT, "Text must be plain text.")
    .refine(
      (value) => allowLineBreaks || !/[\r\n]/u.test(value),
      "Line breaks are not allowed.",
    );

export const sendContactRequestInputSchema = z
  .strictObject({
    opaqueCandidateId: z.string().min(22).max(128).regex(OPAQUE_ID),
    signedSearchSession: z.string().min(32).max(4_096).regex(SIGNED_PROOF),
    subject: plainText(TALENT_CONTACT_POLICY_V1.maximumSubjectCodePoints, false),
    messagePreview: plainText(
      TALENT_CONTACT_POLICY_V1.maximumMessageCodePoints,
      true,
    ),
    idempotencyKey: z.string().regex(IDEMPOTENCY_KEY),
  });

export type SendContactRequestInput = z.infer<
  typeof sendContactRequestInputSchema
>;

export type EmployerRadarContactActor = Readonly<{
  userId: string;
  companyId: string;
  membershipId: string;
}>;

export type AuthorizedRadarContactProof = Readonly<{
  radarSearchSessionId: string;
  candidateProfileId: string;
  filterHash: string;
  cohortSize: number;
  cantonBucketSnapshot: string;
  categoryBucketSnapshot: string;
}>;

export type RadarContactProofResult =
  | Readonly<{ ok: true; value: AuthorizedRadarContactProof }>
  | Readonly<{ ok: false; code: "NOT_FOUND" }>;

/**
 * Cryptographic boundary owned by the Radar listing implementation. It must
 * authenticate the signed member-scoped search proof and resolve the opaque id
 * only for the current company/epoch. This command independently rechecks the
 * returned database scope before it reads candidate eligibility.
 */
export interface RadarContactProofPort {
  authorizeForContact(
    input: Readonly<{
      actorUserId: string;
      companyId: string;
      membershipId: string;
      opaqueCandidateId: string;
      signedSearchSession: string;
      now: Date;
    }>,
    transaction: Prisma.TransactionClient,
  ): Promise<RadarContactProofResult>;
}

export interface RadarContactRateLimitPort {
  consume(input: Readonly<{
    actorUserId: string;
    companyId: string;
    candidateProfileId: string;
    now: Date;
  }>): Promise<
    | Readonly<{ allowed: true }>
    | Readonly<{ allowed: false; retryAfterSeconds: number }>
  >;
}

export function createRadarContactRateLimitPort(input: Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: Pick<AuthRequestContext, "sourceIp">;
}>): RadarContactRateLimitPort {
  return Object.freeze({
    async consume(
      identity: Parameters<RadarContactRateLimitPort["consume"]>[0],
    ) {
      const decision = await consumeRequestRateLimit(
        "CONTACT_REQUEST",
        {
          userId: identity.actorUserId,
          companyId: identity.companyId,
          candidateId: identity.candidateProfileId,
        },
        input.request,
        identity.now,
        { database: input.database, environment: input.environment },
      );
      return decision.allowed
        ? Object.freeze({ allowed: true as const })
        : Object.freeze({
            allowed: false as const,
            retryAfterSeconds: Math.max(1, decision.retryAfterSeconds),
          });
    },
  });
}

export function signRadarContactSearchSessionProof(
  input: Readonly<{
    searchSessionId: string;
    actorUserId: string;
    companyId: string;
    membershipId: string;
    filterHash: string;
    sessionExpiresAt: Date;
    now: Date;
  }>,
  key: RadarContactSearchProofSigningKey,
): string {
  if (
    !Number.isFinite(input.now.getTime()) ||
    !Number.isFinite(input.sessionExpiresAt.getTime())
  ) {
    throw new TypeError("Radar contact search proof requires a valid clock.");
  }
  const issuedAt = input.now.getTime();
  const expiresAt = input.sessionExpiresAt.getTime();
  if (
    expiresAt <= issuedAt ||
    expiresAt - issuedAt >
      RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.maximumLifetimeMilliseconds
  ) {
    throw new TypeError("Radar contact search proof lifetime is invalid.");
  }
  const payload = radarContactSearchProofPayloadSchema.parse({
    version: RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.version,
    searchSessionId: input.searchSessionId,
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    membershipId: input.membershipId,
    filterHash: input.filterHash,
    issuedAt,
    expiresAt,
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return key.withValue((secret) => {
    const signature = radarContactSearchProofSignature(encoded, secret);
    return `${encoded}.${signature.toString("base64url")}`;
  });
}

export function verifyRadarContactSearchSessionProof(
  token: string | null | undefined,
  expected: Readonly<{
    actorUserId: string;
    companyId: string;
    membershipId: string;
    now: Date;
  }>,
  key: RadarContactSearchProofSigningKey,
): RadarContactSearchProofPayloadV1 | null {
  if (
    token == null ||
    token.length === 0 ||
    token.length > RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.maximumTokenLength ||
    !Number.isFinite(expected.now.getTime())
  ) {
    return null;
  }
  const [encoded, encodedSignature, extra] = token.split(".");
  if (
    encoded === undefined ||
    encodedSignature === undefined ||
    extra !== undefined ||
    !isCanonicalBase64Url(encoded) ||
    !isCanonicalBase64Url(encodedSignature)
  ) {
    return null;
  }
  try {
    const signatureIsValid = key.withValue((secret) => {
      const supplied = Buffer.from(encodedSignature, "base64url");
      const correct = radarContactSearchProofSignature(encoded, secret);
      return supplied.length === correct.length && timingSafeEqual(supplied, correct);
    });
    if (!signatureIsValid) return null;
    const parsed = radarContactSearchProofPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (!parsed.success) return null;
    const now = expected.now.getTime();
    if (
      parsed.data.actorUserId !== expected.actorUserId ||
      parsed.data.companyId !== expected.companyId ||
      parsed.data.membershipId !== expected.membershipId ||
      parsed.data.issuedAt >
        now + RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.allowedClockSkewMilliseconds ||
      parsed.data.expiresAt <= parsed.data.issuedAt ||
      parsed.data.expiresAt - parsed.data.issuedAt >
        RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.maximumLifetimeMilliseconds ||
      now >= parsed.data.expiresAt
    ) {
      return null;
    }
    return Object.freeze(parsed.data);
  } catch {
    return null;
  }
}

export function createPrismaRadarContactProofPort(input: Readonly<{
  sessionSigningKey: RadarContactSearchProofSigningKey;
  opaqueLookupKeyring: readonly RadarOpaqueKey[];
  opaqueEncryptionKeyring: readonly RadarOpaqueKey[];
}>): RadarContactProofPort {
  const lookupKeyring = Object.freeze([...input.opaqueLookupKeyring]);
  const encryptionKeyring = Object.freeze([...input.opaqueEncryptionKeyring]);
  return Object.freeze({
    async authorizeForContact(
      command: Parameters<RadarContactProofPort["authorizeForContact"]>[0],
      transaction: Prisma.TransactionClient,
    ) {
      const payload = verifyRadarContactSearchSessionProof(
        command.signedSearchSession,
        {
          actorUserId: command.actorUserId,
          companyId: command.companyId,
          membershipId: command.membershipId,
          now: command.now,
        },
        input.sessionSigningKey,
      );
      if (payload === null) return radarProofNotFound();

      const opaque = await resolveRadarOpaqueId(
        {
          opaqueId: command.opaqueCandidateId,
          companyId: command.companyId,
          now: command.now,
          lookupKeyring,
          encryptionKeyring,
        },
        createTransactionOpaqueResolutionRepository(transaction),
      );
      if (!opaque.ok) return radarProofNotFound();

      const entry = await transaction.radarSearchSessionCandidate.findUnique({
        where: {
          radarSearchSessionId_candidateProfileId: {
            radarSearchSessionId: payload.searchSessionId,
            candidateProfileId: opaque.candidateProfileId,
          },
        },
        select: {
          candidateProfile: {
            select: {
              radarProfile: {
                select: { cantonBucket: true, categoryBucket: true },
              },
            },
          },
          radarSearchSession: {
            select: {
              id: true,
              companyId: true,
              membershipId: true,
              requestingUserId: true,
              filterHash: true,
              policyVersion: true,
              resultCount: true,
              expiresAt: true,
            },
          },
        },
      });
      const session = entry?.radarSearchSession;
      const radar = entry?.candidateProfile.radarProfile;
      if (
        session === undefined ||
        radar === undefined ||
        radar === null ||
        session.id !== payload.searchSessionId ||
        session.companyId !== command.companyId ||
        session.membershipId !== command.membershipId ||
        session.requestingUserId !== command.actorUserId ||
        session.filterHash !== payload.filterHash ||
        session.policyVersion !== RADAR_PRIVACY_POLICY_V1.version ||
        session.resultCount < RADAR_PRIVACY_POLICY_V1.cohort.minimumSize ||
        command.now.getTime() >= session.expiresAt.getTime() ||
        payload.expiresAt > session.expiresAt.getTime()
      ) {
        return radarProofNotFound();
      }
      return Object.freeze({
        ok: true as const,
        value: Object.freeze({
          radarSearchSessionId: session.id,
          candidateProfileId: opaque.candidateProfileId,
          filterHash: session.filterHash,
          cohortSize: session.resultCount,
          cantonBucketSnapshot: radar.cantonBucket,
          categoryBucketSnapshot: radar.categoryBucket,
        }),
      });
    },
  });
}

export function createEnvironmentRadarContactProofPort(
  environment: ServerEnvironment,
): RadarContactProofPort {
  return createPrismaRadarContactProofPort({
    sessionSigningKey: environment.secrets.session,
    opaqueLookupKeyring: materializeOpaqueKeyring(
      environment.secrets.keyrings.RADAR_OPAQUE_LOOKUP_KEYS,
    ),
    opaqueEncryptionKeyring: materializeOpaqueKeyring(
      environment.secrets.keyrings.RADAR_OPAQUE_ENCRYPTION_KEYS,
    ),
  });
}

export type SendContactRequestDependencies = Readonly<{
  actor: EmployerRadarContactActor;
  correlationId: string;
  database: DatabaseClient;
  eligibilityEnvironment: RadarEligibilityEnvironment;
  proofPort: RadarContactProofPort;
  rateLimitPort: RadarContactRateLimitPort;
  now?: Date;
}>;

export type SendContactRequestResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        requestId: string;
        status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED";
        expiresAt: Date;
        fundingSource: "PLAN_ALLOWANCE" | "PURCHASED_PACK" | "ADMIN_GRANT";
      }>;
      replay?: true;
    }>
  | Readonly<{
      ok: false;
      code:
        | "INVALID_INPUT"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "RATE_LIMITED"
        | "LIMIT"
        | "PENDING_DUPLICATE"
        | "RECONTACT_COOLDOWN"
        | "IDEMPOTENCY_CONFLICT"
        | "WRITE_FAILED";
      suggestedProductSlug?: "contact-pack-10";
      retryAfterSeconds?: number;
    }>;

export type StoredSearchSessionProof = Readonly<{
  id: string;
  companyId: string;
  membershipId: string;
  requestingUserId: string;
  filterHash: string;
  policyVersion: string;
  resultCount: number;
  normalizedFilters: unknown;
  expiresAt: Date;
  candidateProfileId: string;
}>;

export async function sendContactRequest(
  raw: unknown,
  dependencies: SendContactRequestDependencies,
): Promise<SendContactRequestResult> {
  const parsed = sendContactRequestInputSchema.safeParse(raw);
  const dependencyInput = z
    .strictObject({
      userId: z.uuid(),
      companyId: z.uuid(),
      membershipId: z.uuid(),
      correlationId: z.uuid(),
      now: z.date(),
    })
    .safeParse({
      ...dependencies.actor,
      correlationId: dependencies.correlationId,
      now: dependencies.now ?? new Date(),
    });
  if (
    !parsed.success ||
    !dependencyInput.success ||
    !Number.isFinite(dependencyInput.data.now.getTime())
  ) {
    return contactFailure("INVALID_INPUT");
  }
  const input = parsed.data;
  const now = new Date(dependencyInput.data.now);
  const commandFingerprint = fingerprintRadarContactCommand({
    actor: dependencies.actor,
    input,
  });

  return runSerializableContactCommand(dependencies.database, async (transaction) => {
    await acquireInitialContactLocks(transaction, dependencies.actor, input.idempotencyKey);

    // Deliberately complete every employer/trust/entitlement check before the
    // proof port or any CandidateProfile query can run.
    const employer = await loadCurrentEmployerTrust(
      transaction,
      dependencies.actor,
    );
    if (employer === null) return contactFailure("FORBIDDEN");
    const currentVerificationCount =
      await transaction.companyVerificationRequest.count({
        where: {
          companyId: dependencies.actor.companyId,
          status: "VERIFIED",
          supersededBy: null,
        },
      });
    if (currentVerificationCount !== 1) return contactFailure("FORBIDDEN");

    const entitlements = await getEffectiveEntitlements(
      dependencies.actor.companyId,
      now,
      createPrismaEntitlementRepository(transaction),
    );
    if (
      !entitlements.ok ||
      !entitlements.value.rights.TALENT_RADAR_ACCESS
    ) return contactFailure("FORBIDDEN");

    // An exact retry must remain replayable after the original request consumed
    // the company's final credit. Access/trust still apply, but current funding
    // is relevant only for a new mutation.
    const replay = await transaction.employerContactRequest.findUnique({
      where: {
        companyId_idempotencyKey: {
          companyId: dependencies.actor.companyId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        id: true,
        requestingUserId: true,
        subject: true,
        messagePreview: true,
        commandFingerprint: true,
        status: true,
        expiresAt: true,
        fundingSource: true,
      },
    });
    if (replay !== null) {
      return replay.requestingUserId === dependencies.actor.userId &&
        replay.subject === input.subject &&
        replay.messagePreview === input.messagePreview &&
        replay.commandFingerprint === commandFingerprint
        ? contactSuccess(
            {
              requestId: replay.id,
              status: replay.status,
              expiresAt: replay.expiresAt,
              fundingSource: replay.fundingSource,
            },
            true,
          )
        : contactFailure("IDEMPOTENCY_CONFLICT");
    }

    const fundingGate = canRequestContact(
      entitlements.value,
      entitlements.value.fundableBySource,
    );
    if (!fundingGate.allowed) {
      return fundingGate.reason === "CONTACT_FUNDING_UNAVAILABLE"
        ? contactLimit()
        : contactFailure("FORBIDDEN");
    }

    const proof = await dependencies.proofPort.authorizeForContact(
      {
        actorUserId: dependencies.actor.userId,
        companyId: dependencies.actor.companyId,
        membershipId: dependencies.actor.membershipId,
        opaqueCandidateId: input.opaqueCandidateId,
        signedSearchSession: input.signedSearchSession,
        now,
      },
      transaction,
    );
    if (!proof.ok || !isWellFormedAuthorizedProof(proof.value)) {
      return contactFailure("NOT_FOUND");
    }

    const session = await loadStoredSearchSessionProof(
      transaction,
      dependencies.actor,
      proof.value,
    );
    if (
      session === null ||
      !isAuthorizedRadarContactProofForSession(
        proof.value,
        session,
        dependencies.actor,
        now,
      )
    ) {
      return contactFailure("NOT_FOUND");
    }
    let normalizedSessionFilters: ReturnType<
      typeof parsePersistedRadarFiltersV1
    >;
    try {
      normalizedSessionFilters = parsePersistedRadarFiltersV1(
        session.normalizedFilters,
      );
    } catch {
      return contactFailure("NOT_FOUND");
    }
    if (normalizedSessionFilters.filterHash !== session.filterHash) {
      return contactFailure("NOT_FOUND");
    }

    await acquireCandidateContactLock(
      transaction,
      dependencies.actor.companyId,
      proof.value.candidateProfileId,
    );
    const candidateLock = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "CandidateProfile"
      WHERE "id" = ${proof.value.candidateProfileId}::uuid
      FOR UPDATE
    `;
    if (candidateLock.length !== 1) return contactFailure("NOT_FOUND");

    const candidate = await transaction.candidateProfile.findUnique({
      where: { id: proof.value.candidateProfileId },
      select: {
        ...buildRadarCandidateEligibilitySelect(now),
        userId: true,
        user: {
          select: {
            status: true,
            dataProvenance: true,
            email: true,
          },
        },
      },
    });
    if (
      candidate === null ||
      !isRadarCandidateEligible(
        toRadarCandidateEligibilityInput(candidate),
        now,
        dependencies.eligibilityEnvironment,
      )
    ) {
      return contactFailure("NOT_FOUND");
    }

    const currentCohortIsAuthorized =
      await isCurrentRadarContactCohortAuthorized(transaction, {
        filters: normalizedSessionFilters.filters,
        now,
        environment: dependencies.eligibilityEnvironment,
        candidateProfileId: candidate.id,
      });
    if (!currentCohortIsAuthorized) {
      return contactFailure("NOT_FOUND");
    }

    const rateLimit = await dependencies.rateLimitPort.consume({
      actorUserId: dependencies.actor.userId,
      companyId: dependencies.actor.companyId,
      candidateProfileId: candidate.id,
      now,
    });
    if (!rateLimit.allowed) {
      return contactRateLimited(rateLimit.retryAfterSeconds);
    }

    const pending = await transaction.employerContactRequest.findFirst({
      where: {
        companyId: dependencies.actor.companyId,
        candidateProfileId: candidate.id,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (pending !== null) return contactFailure("PENDING_DUPLICATE");

    const cooldownBoundary = new Date(
      now.getTime() - TALENT_CONTACT_POLICY_V1.recontactCooldownMilliseconds,
    );
    const recentTerminal = await transaction.employerContactRequest.findFirst({
      where: {
        companyId: dependencies.actor.companyId,
        candidateProfileId: candidate.id,
        terminalAt: { gt: cooldownBoundary },
      },
      select: { id: true },
    });
    if (recentTerminal !== null) return contactFailure("RECONTACT_COOLDOWN");

    // Re-resolve after all domain locks. This prevents a stale preflight
    // balance or entitlement from authorizing the ledger mutation.
    const lockedEntitlements = await getEffectiveEntitlements(
      dependencies.actor.companyId,
      now,
      createPrismaEntitlementRepository(transaction),
    );
    if (!lockedEntitlements.ok) return contactFailure("FORBIDDEN");
    const lockedGate = canRequestContact(
      lockedEntitlements.value,
      lockedEntitlements.value.fundableBySource,
    );
    if (!lockedGate.allowed) {
      return lockedGate.reason === "CONTACT_FUNDING_UNAVAILABLE"
        ? contactLimit()
        : contactFailure("FORBIDDEN");
    }

    const credit = await consumeOneCompanyCreditInLockedTransaction(
      transaction,
      {
        actorUserId: dependencies.actor.userId,
        capability: "EMPLOYER_TALENT_CONTACT_CREATE",
        companyId: dependencies.actor.companyId,
        correlationId: dependencies.correlationId,
        creditType: "TALENT_CONTACT",
        idempotencyKey: scopedOperationKey(
          "contact-credit",
          dependencies.actor.companyId,
          input.idempotencyKey,
        ),
        now,
        reasonCode: "CONTACT_REQUEST",
      },
    );
    if (!credit.ok) {
      return credit.code === "INSUFFICIENT_CREDITS"
        ? contactLimit()
        : contactFailure("IDEMPOTENCY_CONFLICT");
    }

    const requestId = randomUUID();
    const expiresAt = contactRequestExpiresAt(now);
    const request = await transaction.employerContactRequest.create({
      data: {
        id: requestId,
        companyId: dependencies.actor.companyId,
        candidateProfileId: candidate.id,
        radarSearchSessionId: session.id,
        requestingUserId: dependencies.actor.userId,
        creditLedgerEntryId: credit.entryId,
        subject: input.subject,
        messagePreview: input.messagePreview,
        idempotencyKey: input.idempotencyKey,
        commandFingerprint,
        status: "PENDING",
        fundingSource: credit.fundingSource,
        clusterPolicyVersion: session.policyVersion,
        cantonBucketSnapshot: proof.value.cantonBucketSnapshot,
        categoryBucketSnapshot: proof.value.categoryBucketSnapshot,
        expiresAt,
        terminalAt: null,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    await transaction.contactRequestEvent.create({
      data: {
        id: randomUUID(),
        contactRequestId: request.id,
        kind: "CREATED",
        actorUserId: dependencies.actor.userId,
        reasonCode: null,
        correlationId: dependencies.correlationId,
        idempotencyKey: contactEventKey(
          "created",
          dependencies.actor.userId,
          input.idempotencyKey,
        ),
        createdAt: now,
      },
    });
    await writeNotificationExactlyOnce(createPrismaNotificationPort(transaction), {
      recipientUserId: candidate.userId,
      kind: "CONTACT_REQUEST_RECEIVED",
      dedupeKey: `contact:${request.id}:received`,
      payload: { requestId: request.id, status: "PENDING" },
    });
    await writeContactRequestEmailInTransaction(transaction, {
      candidateEmail: candidate.user.email,
      companyName: employer.companyName,
      contactRequestId: request.id,
    });
    await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
      action: "CONTACT_REQUEST_SENT",
      actorKind: "USER",
      actorUserId: dependencies.actor.userId,
      capability: "EMPLOYER_TALENT_CONTACT_CREATE",
      companyId: dependencies.actor.companyId,
      correlationId: dependencies.correlationId,
      reasonCode: "CONTACT_REQUEST_CREATED",
      result: "SUCCEEDED",
      retainUntil: new Date(now.getTime() + AUDIT_RETENTION_MILLISECONDS),
      targetId: request.id,
      targetType: "CONTACT_REQUEST",
    });

    return contactSuccess({
      requestId: request.id,
      status: "PENDING",
      expiresAt,
      fundingSource: credit.fundingSource,
    });
  });
}

export function contactRequestExpiresAt(createdAt: Date): Date {
  if (!Number.isFinite(createdAt.getTime())) {
    throw new TypeError("Contact request creation time is invalid.");
  }
  return new Date(
    createdAt.getTime() + TALENT_CONTACT_POLICY_V1.requestLifetimeMilliseconds,
  );
}

export function recontactAvailableAt(terminalAt: Date): Date {
  if (!Number.isFinite(terminalAt.getTime())) {
    throw new TypeError("Contact request terminal time is invalid.");
  }
  return new Date(
    terminalAt.getTime() + TALENT_CONTACT_POLICY_V1.recontactCooldownMilliseconds,
  );
}

export function isAuthorizedRadarContactProofForSession(
  proof: AuthorizedRadarContactProof,
  session: StoredSearchSessionProof,
  actor: EmployerRadarContactActor,
  now: Date,
): boolean {
  return (
    isWellFormedAuthorizedProof(proof) &&
    Number.isFinite(now.getTime()) &&
    session.id === proof.radarSearchSessionId &&
    session.companyId === actor.companyId &&
    session.membershipId === actor.membershipId &&
    session.requestingUserId === actor.userId &&
    session.candidateProfileId === proof.candidateProfileId &&
    session.filterHash === proof.filterHash &&
    session.policyVersion === RADAR_PRIVACY_POLICY_V1.version &&
    session.resultCount === proof.cohortSize &&
    session.resultCount >= RADAR_PRIVACY_POLICY_V1.cohort.minimumSize &&
    Number.isFinite(session.expiresAt.getTime()) &&
    now.getTime() < session.expiresAt.getTime()
  );
}

async function loadCurrentEmployerTrust(
  transaction: Prisma.TransactionClient,
  actor: EmployerRadarContactActor,
): Promise<Readonly<{ companyName: string }> | null> {
  return transaction.company.findFirst({
    where: {
      id: actor.companyId,
      status: "ACTIVE",
      memberships: {
        some: {
          id: actor.membershipId,
          companyId: actor.companyId,
          userId: actor.userId,
          status: "ACTIVE",
          removedAt: null,
          role: { in: ["OWNER", "ADMIN", "RECRUITER"] },
          user: {
            status: "ACTIVE",
            role: { in: ["EMPLOYER", "RECRUITER"] },
          },
        },
      },
    },
    select: { name: true },
  }).then((company) =>
    company === null ? null : Object.freeze({ companyName: company.name }),
  );
}

async function loadStoredSearchSessionProof(
  transaction: Prisma.TransactionClient,
  actor: EmployerRadarContactActor,
  proof: AuthorizedRadarContactProof,
): Promise<StoredSearchSessionProof | null> {
  const session = await transaction.radarSearchSession.findFirst({
    where: {
      id: proof.radarSearchSessionId,
      companyId: actor.companyId,
      membershipId: actor.membershipId,
      requestingUserId: actor.userId,
      candidates: { some: { candidateProfileId: proof.candidateProfileId } },
    },
    select: {
      id: true,
      companyId: true,
      membershipId: true,
      requestingUserId: true,
      filterHash: true,
      policyVersion: true,
      resultCount: true,
      normalizedFilters: true,
      expiresAt: true,
      candidates: {
        where: { candidateProfileId: proof.candidateProfileId },
        take: 1,
        select: { candidateProfileId: true },
      },
    },
  });
  const candidateProfileId = session?.candidates[0]?.candidateProfileId;
  return session === null || candidateProfileId === undefined
    ? null
    : Object.freeze({
        id: session.id,
        companyId: session.companyId,
        membershipId: session.membershipId,
        requestingUserId: session.requestingUserId,
        filterHash: session.filterHash,
        policyVersion: session.policyVersion,
        resultCount: session.resultCount,
        normalizedFilters: session.normalizedFilters,
        expiresAt: session.expiresAt,
        candidateProfileId,
      });
}

function isWellFormedAuthorizedProof(
  proof: AuthorizedRadarContactProof,
): boolean {
  return (
    z.uuid().safeParse(proof.radarSearchSessionId).success &&
    z.uuid().safeParse(proof.candidateProfileId).success &&
    SHA_256_HEX.test(proof.filterHash) &&
    Number.isSafeInteger(proof.cohortSize) &&
    proof.cohortSize >= RADAR_PRIVACY_POLICY_V1.cohort.minimumSize &&
    isBoundedSafeBucket(proof.cantonBucketSnapshot, 64) &&
    isBoundedSafeBucket(proof.categoryBucketSnapshot, 120)
  );
}

function isBoundedSafeBucket(value: string, maximum: number): boolean {
  return (
    value.trim() === value &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= maximum &&
    SAFE_PLAIN_TEXT.test(value) &&
    !/[\r\n]/u.test(value)
  );
}

async function acquireInitialContactLocks(
  transaction: Prisma.TransactionClient,
  actor: EmployerRadarContactActor,
  idempotencyKey: string,
): Promise<void> {
  const keys = [
    `talent-contact:company:${actor.companyId}`,
    `talent-contact:idempotency:${actor.companyId}:${idempotencyKey}`,
  ]
    .map(sha256)
    .sort();
  for (const key of keys) {
    await transaction.$queryRaw<readonly { locked: boolean }[]>`
      SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
    `;
  }
  await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "Company" WHERE "id" = ${actor.companyId}::uuid FOR UPDATE
  `;
}

async function acquireCandidateContactLock(
  transaction: Prisma.TransactionClient,
  companyId: string,
  candidateProfileId: string,
): Promise<void> {
  const key = sha256(`talent-contact:candidate:${companyId}:${candidateProfileId}`);
  await transaction.$queryRaw<readonly { locked: boolean }[]>`
    SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS "locked"
  `;
}

async function writeContactRequestEmailInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    candidateEmail: string;
    companyName: string;
    contactRequestId: string;
  }>,
): Promise<void> {
  const provider = new MockEmailProvider(
    createTransactionEmailLogRepository(transaction),
  );
  await provider.send({
    to: input.candidateEmail,
    templateKey: "talent_contact_request_received",
    subject: "Neue Kontaktanfrage über Talent Radar",
    data: {
      companyName: input.companyName,
      idempotencyKey: `contact:${input.contactRequestId}`,
    },
  });
}

function createTransactionEmailLogRepository(
  transaction: Prisma.TransactionClient,
): EmailLogRepository {
  return Object.freeze({
    async record(input: MockEmailLogRecord) {
      try {
        const row = await transaction.emailLog.create({
          data: {
            ...(input.id === undefined ? {} : { id: input.id }),
            recipient: input.recipient,
            purpose: input.purpose,
            templateKey: input.templateKey,
            payload: input.payload as Prisma.InputJsonObject,
            status: input.status,
            providerReference: input.providerReference,
          },
          select: { id: true },
        });
        return { id: row.id, created: true };
      } catch (error) {
        if (input.id === undefined || databaseErrorCode(error) !== "P2002") {
          throw error;
        }
        const existing = await transaction.emailLog.findUnique({
          where: { id: input.id },
          select: {
            id: true,
            recipient: true,
            templateKey: true,
            providerReference: true,
          },
        });
        if (
          existing === null ||
          existing.recipient !== input.recipient ||
          existing.templateKey !== input.templateKey ||
          existing.providerReference !== input.providerReference
        ) {
          throw new EmailLogIdempotencyConflictError();
        }
        return { id: existing.id, created: false };
      }
    },
  });
}

function createTransactionOpaqueResolutionRepository(
  transaction: Prisma.TransactionClient,
) {
  return Object.freeze({
    async findByScopedLookups(input: Readonly<{
      companyId: string;
      epoch: Date;
      lookups: readonly Readonly<{
        lookupKeyVersion: string;
        lookupHmac: string;
      }>[];
    }>): Promise<readonly RadarOpaqueMappingRecord[]> {
      const rows = await transaction.radarOpaqueMapping.findMany({
        where: {
          companyId: input.companyId,
          epoch: input.epoch,
          OR: input.lookups.map((lookup) => ({
            lookupKeyVersion: lookup.lookupKeyVersion,
            lookupHmac: lookup.lookupHmac,
          })),
        },
        orderBy: { id: "asc" },
        take: 3,
        select: {
          id: true,
          candidateProfileId: true,
          companyId: true,
          epoch: true,
          lookupHmac: true,
          encryptedToken: true,
          nonce: true,
          authTag: true,
          lookupKeyVersion: true,
          encryptionKeyVersion: true,
          validFrom: true,
          validTo: true,
          revokedAt: true,
          revocationReason: true,
        },
      });
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            ...row,
            encryptedToken: Uint8Array.from(row.encryptedToken),
            nonce: Uint8Array.from(row.nonce),
            authTag: Uint8Array.from(row.authTag),
          }),
        ),
      );
    },
  });
}

function materializeOpaqueKeyring(
  entries:
    | ServerEnvironment["secrets"]["keyrings"]["RADAR_OPAQUE_LOOKUP_KEYS"]
    | ServerEnvironment["secrets"]["keyrings"]["RADAR_OPAQUE_ENCRYPTION_KEYS"],
): readonly RadarOpaqueKey[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze({
        version: entry.version,
        secret: entry.key.withValue((secret) => secret),
      }),
    ),
  );
}

function radarProofNotFound(): Extract<RadarContactProofResult, { ok: false }> {
  return Object.freeze({ ok: false as const, code: "NOT_FOUND" as const });
}

function radarContactSearchProofSignature(
  encodedPayload: string,
  secret: string,
): Buffer {
  const key = Buffer.from(secret, "base64");
  if (key.length < 32) {
    throw new TypeError("Radar contact search proof requires a valid signing key.");
  }
  return createHmac("sha256", key)
    .update(
      `${RADAR_CONTACT_SEARCH_PROOF_POLICY_V1.context}\0${encodedPayload}`,
      "utf8",
    )
    .digest();
}

function isCanonicalBase64Url(value: string): boolean {
  if (!BASE64URL.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value;
}

async function runSerializableContactCommand<T>(
  database: DatabaseClient,
  command: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T | Extract<SendContactRequestResult, { ok: false }>> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await database.$transaction(command, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableDatabaseError(error) || attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        return contactFailure("WRITE_FAILED");
      }
    }
  }
  return contactFailure("WRITE_FAILED");
}

function isRetryableDatabaseError(error: unknown): boolean {
  const code = databaseErrorCode(error);
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";
  return /could not serialize access|deadlock detected|write conflict/iu.test(
    message,
  );
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code.slice(0, 32)
    : undefined;
}

function contactSuccess(
  value: Extract<SendContactRequestResult, { ok: true }>["value"],
  replay = false,
): Extract<SendContactRequestResult, { ok: true }> {
  return Object.freeze({
    ok: true as const,
    value: Object.freeze(value),
    ...(replay ? { replay: true as const } : {}),
  });
}

function contactFailure(
  code: Extract<SendContactRequestResult, { ok: false }>["code"],
): Extract<SendContactRequestResult, { ok: false }> {
  return Object.freeze({ ok: false as const, code });
}

function contactLimit(): Extract<SendContactRequestResult, { ok: false }> {
  return Object.freeze({
    ok: false as const,
    code: "LIMIT" as const,
    suggestedProductSlug: TALENT_CONTACT_POLICY_V1.suggestedProductSlug,
  });
}

function contactRateLimited(
  retryAfterSeconds: number,
): Extract<SendContactRequestResult, { ok: false }> {
  return Object.freeze({
    ok: false as const,
    code: "RATE_LIMITED" as const,
    retryAfterSeconds:
      Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds
        : 1,
  });
}

function contactEventKey(
  kind: string,
  actorUserId: string,
  idempotencyKey: string,
): string {
  return `contact-event:${kind}:${sha256(`${actorUserId}\0${idempotencyKey}`)}`;
}

function scopedOperationKey(
  namespace: string,
  companyId: string,
  idempotencyKey: string,
): string {
  return `${namespace}:${sha256(`${companyId}\0${idempotencyKey}`)}`;
}

export function fingerprintRadarContactCommand(input: Readonly<{
  actor: EmployerRadarContactActor;
  input: SendContactRequestInput;
}>): string {
  return sha256(JSON.stringify({
    version: 1,
    actorUserId: input.actor.userId,
    companyId: input.actor.companyId,
    membershipId: input.actor.membershipId,
    opaqueCandidateId: input.input.opaqueCandidateId,
    signedSearchSession: input.input.signedSearchSession,
    subject: input.input.subject,
    messagePreview: input.input.messagePreview,
  }));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
