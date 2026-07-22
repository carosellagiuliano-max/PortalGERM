import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { writeBestEffortAudit, writeRequiredAudit } from "@/lib/audit/log";
import { candidateAnalyticsSubjectV1 } from "@/lib/analytics/pseudonyms";
import {
  createPrismaTransactionAnalyticsWriter,
  trackAnalyticsEventV1,
} from "@/lib/analytics/track";
import {
  createPrismaAuditPort,
  createPrismaTransactionAuditPort,
} from "@/lib/audit/prisma-port";
import {
  getCompanyClaimSignalCodes,
  normalizeEmployerRegistrationSignals,
  toClaimSignalAuditMetadata,
  toPersistedCompanyRegistrationSignals,
  type ClaimSignalCode,
} from "@/lib/auth/employer-registration-signals";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeAuthRateLimit, hashAuthIdentifier } from "@/lib/auth/rate-limit-runtime";
import {
  createRegistrationMarketingConsent,
  createRegistrationTermsConsent,
} from "@/lib/auth/registration-consent";
import type { AuthRequestContext } from "@/lib/auth/request-context";
import { resolveSafeNext, type AuthRoleV1 } from "@/lib/auth/safe-next";
import { issueSession } from "@/lib/auth/session-issuance";
import type { CreatedSession } from "@/lib/auth/session";
import { PASSWORD_HASH_POLICY_V1 } from "@/lib/auth/password";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { EmailProvider } from "@/lib/providers/email/email-provider";
import { hashIpWithFirstKey } from "@/lib/utils/hash";
import { slugify } from "@/lib/utils/slug";
import type {
  CandidateRegistrationInput,
  EmployerRegistrationInput,
  LoginInput,
  ResetPasswordInput,
} from "@/lib/validation/auth";

const AUTH_AUDIT_RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;
const PASSWORD_RESET_TTL_MILLISECONDS = 15 * 60 * 1_000;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const FORGOT_TIMING_FLOOR_MILLISECONDS = 650;

// A fixed cost-12 hash makes an unknown account follow the same single bcrypt
// verification path as a known account without creating a process-start timing oracle.
const DUMMY_PASSWORD_HASH =
  "$2b$12$2GonRFTuqr7MSiOR665JxebfF8KcZPoqrjaXaPUGQTLta.l9GLrFO";

export type AuthServiceDependencies = Readonly<{
  database: DatabaseClient;
  environment: ServerEnvironment;
  request: AuthRequestContext;
  now?: Date;
}>;

export type EmployerRegistrationDependencies = AuthServiceDependencies &
  Readonly<{ claimedCompanyId?: string }>;

export type LoginResult =
  | Readonly<{
      ok: true;
      session: CreatedSession;
      destination: string;
      role: AuthRoleV1;
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_CREDENTIALS" | "RATE_LIMITED";
      retryAfterSeconds?: number;
    }>;

export type RegistrationResult =
  | Readonly<{
      ok: true;
      session: CreatedSession;
      destination: string;
      branch: "CANDIDATE" | "COMPANY_CREATED" | "COMPANY_CLAIM";
    }>
  | Readonly<{
      ok: false;
      code: "REGISTRATION_FAILED" | "RATE_LIMITED";
      retryAfterSeconds?: number;
    }>;

export type PasswordResetRequestResult = Readonly<{
  ok: true;
  rateLimited: boolean;
  retryAfterSeconds?: number;
}>;

export type PasswordResetResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "INVALID_RESET_TOKEN" }>;

export async function loginWithPassword(
  input: LoginInput & Readonly<{ next?: string | null }>,
  dependencies: AuthServiceDependencies,
): Promise<LoginResult> {
  const now = dependencies.now ?? new Date();
  const rate = await consumeAuthRateLimit(
    "LOGIN",
    { normalizedEmail: input.email },
    dependencies.request,
    now,
    { environment: dependencies.environment, database: dependencies.database },
  );
  if (!rate.allowed) {
    await auditRateLimit(dependencies, "LOGIN", rate.audit.scope, now);
    return Object.freeze({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const user = await dependencies.database.user.findUnique({
    where: { emailNormalized: input.email },
    select: {
      id: true,
      role: true,
      status: true,
      credential: { select: { passwordHash: true } },
    },
  });
  const passwordMatches = await verifyPassword(
    input.password,
    user?.credential?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (user === null || user.status !== "ACTIVE" || !passwordMatches) {
    await auditFailedLogin(dependencies, input.email, user?.id, now);
    return Object.freeze({ ok: false, code: "INVALID_CREDENTIALS" });
  }

  const session = await dependencies.database.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
      select: { id: true },
    });
    const created = await issueSession(transaction, {
      userId: user.id,
      now,
      request: dependencies.request,
      auditIpKeyring:
        dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
    });
    await writeRequiredAudit(
      createPrismaTransactionAuditPort(transaction),
      {
        action: "USER_LOGIN",
        actorKind: "USER",
        actorUserId: user.id,
        capability: "AUTH_LOGIN",
        correlationId: dependencies.request.correlationId,
        result: "SUCCEEDED",
        retainUntil: auditRetainUntil(now),
        targetId: created.record.id,
        targetType: "SESSION",
      },
      auditIpContext(dependencies),
    );
    return created;
  });

  return Object.freeze({
    ok: true,
    session,
    role: user.role,
    destination: resolveSafeNext(input.next, user.role),
  });
}

export async function registerCandidate(
  input: CandidateRegistrationInput & Readonly<{ next?: string | null }>,
  dependencies: AuthServiceDependencies,
): Promise<RegistrationResult> {
  if (!hasExplicitTermsAcceptance(input)) {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
  const now = dependencies.now ?? new Date();
  const limited = await registrationRateLimit(dependencies, now);
  if (limited !== null) return limited;

  const passwordHash = await hashPassword(input.password);
  try {
    const session = await dependencies.database.$transaction(
      async (transaction) => {
        const user = await transaction.user.create({
          data: {
            email: input.email,
            emailNormalized: input.email,
            name: input.name,
            role: "CANDIDATE",
            credential: {
              create: {
                passwordHash,
                algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
                algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
                passwordChangedAt: now,
              },
            },
          },
          select: { id: true, dataProvenance: true },
        });
        const profile = await transaction.candidateProfile.create({
          data: { userId: user.id, onboardingStatus: "DRAFT" },
          select: { id: true },
        });
        await transaction.candidateOnboardingEvent.create({
          data: {
            candidateProfileId: profile.id,
            kind: "DRAFT_CREATED",
            actorUserId: user.id,
            reasonCode: "REGISTRATION",
            correlationId: dependencies.request.correlationId,
            createdAt: now,
          },
          select: { id: true },
        });
        await persistRegistrationConsents(
          transaction,
          user.id,
          input.marketingConsent,
          now,
        );
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "USER_REGISTERED",
            actorKind: "USER",
            actorUserId: user.id,
            capability: "AUTH_REGISTER_CANDIDATE",
            correlationId: dependencies.request.correlationId,
            metadata: { role: "CANDIDATE" },
            result: "SUCCEEDED",
            retainUntil: auditRetainUntil(now),
            targetId: user.id,
            targetType: "USER",
          },
          auditIpContext(dependencies),
        );
        await trackAnalyticsEventV1(
          {
            schemaVersion: "1",
            producerEventId: `candidate-registered:${user.id}`,
            occurredAt: now,
            kind: "CANDIDATE_REGISTERED",
            pseudonymousActorId: candidateAnalyticsSubjectV1(user.id),
            properties: {
              onboardingRuleVersion: "candidate-registration-v1",
            },
          },
          {
            producer: "auth-registration",
            productAnalyticsEnabled: false,
            provenance: { actor: user.dataProvenance },
          },
          createPrismaTransactionAnalyticsWriter(transaction),
        );
        return issueSession(transaction, {
          userId: user.id,
          now,
          request: dependencies.request,
          auditIpKeyring:
            dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
        });
      },
    );
    return Object.freeze({
      ok: true,
      session,
      destination:
        input.next == null
          ? "/candidate/jobpass"
          : resolveSafeNext(input.next, "CANDIDATE"),
      branch: "CANDIDATE",
    });
  } catch {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
}

export async function registerEmployer(
  input: EmployerRegistrationInput,
  dependencies: EmployerRegistrationDependencies,
): Promise<RegistrationResult> {
  if (!hasExplicitTermsAcceptance(input)) {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
  if (
    dependencies.claimedCompanyId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      dependencies.claimedCompanyId,
    )
  ) {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
  const now = dependencies.now ?? new Date();
  const limited = await registrationRateLimit(dependencies, now);
  if (limited !== null) return limited;

  let signals: ReturnType<typeof normalizeEmployerRegistrationSignals>;
  try {
    signals = normalizeEmployerRegistrationSignals(input);
  } catch {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
  const passwordHash = await hashPassword(input.password);

  try {
    const registration = await dependencies.database.$transaction(
      async (transaction) => {
        const canton = await transaction.canton.findFirst({
          where: { code: signals.cantonCode, isActive: true },
          select: { id: true },
        });
        if (canton === null) throw new Error("REGISTRATION_CANTON_MISSING");
        const persistedSignals = toPersistedCompanyRegistrationSignals(
          signals,
          canton.id,
        );

        await lockEmployerRegistrationSignals(transaction, persistedSignals);
        const candidates = await transaction.company.findMany({
          where:
            dependencies.claimedCompanyId === undefined
              ? {
                  OR: [
                ...(persistedSignals.uid === null
                  ? []
                  : [{ uid: persistedSignals.uid }]),
                    {
                      registrationEmailDomainNormalized:
                        persistedSignals.registrationEmailDomainNormalized,
                    },
                    {
                      registrationNameNormalized:
                        persistedSignals.registrationNameNormalized,
                      registrationCantonId:
                        persistedSignals.registrationCantonId,
                    },
                  ],
                }
              : { id: dependencies.claimedCompanyId, status: "ACTIVE" },
          orderBy: { id: "asc" },
          take: 2,
          select: {
            id: true,
            uid: true,
            registrationEmailDomainNormalized: true,
            registrationNameNormalized: true,
            registrationCantonId: true,
          },
        });
        if (
          dependencies.claimedCompanyId !== undefined &&
          candidates.length !== 1
        ) {
          throw new Error("CLAIMED_COMPANY_NOT_AVAILABLE");
        }
        if (candidates.length > 1) {
          throw new Error("AMBIGUOUS_COMPANY_REGISTRATION_SIGNALS");
        }

        const user = await transaction.user.create({
          data: {
            email: input.email,
            emailNormalized: input.email,
            name: input.name,
            role: "EMPLOYER",
            credential: {
              create: {
                passwordHash,
                algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
                algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
                passwordChangedAt: now,
              },
            },
            employerProfile: { create: { displayName: input.name } },
          },
          select: { id: true },
        });
        await persistRegistrationConsents(
          transaction,
          user.id,
          input.marketingConsent,
          now,
        );
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "USER_REGISTERED",
            actorKind: "USER",
            actorUserId: user.id,
            capability: "AUTH_REGISTER_EMPLOYER",
            correlationId: dependencies.request.correlationId,
            metadata: { role: "EMPLOYER" },
            result: "SUCCEEDED",
            retainUntil: auditRetainUntil(now),
            targetId: user.id,
            targetType: "USER",
          },
          auditIpContext(dependencies),
        );

        let branch: "COMPANY_CREATED" | "COMPANY_CLAIM";
        let destination: "/employer/dashboard" | "/employer/company/claim-pending";
        const candidate = candidates[0];
        if (candidate === undefined) {
          const company = await transaction.company.create({
            data: {
              name: input.companyName,
              slug: registrationSlug(input.companyName, user.id),
              uid: persistedSignals.uid,
              registrationEmailDomainNormalized:
                persistedSignals.registrationEmailDomainNormalized,
              registrationNameNormalized:
                persistedSignals.registrationNameNormalized,
              registrationCantonId: persistedSignals.registrationCantonId,
              size: input.companySize,
              status: "DRAFT",
            },
            select: { id: true },
          });
          await transaction.companyStatusEvent.create({
            data: {
              companyId: company.id,
              kind: "DRAFT_CREATED",
              toStatus: "DRAFT",
              actorUserId: user.id,
              reasonCode: "REGISTRATION",
              correlationId: dependencies.request.correlationId,
              createdAt: now,
            },
            select: { id: true },
          });
          const membership = await transaction.companyMembership.create({
            data: {
              companyId: company.id,
              userId: user.id,
              role: "OWNER",
              status: "ACTIVE",
              joinedAt: now,
            },
            select: { id: true },
          });
          await transaction.companyMembershipEvent.create({
            data: {
              membershipId: membership.id,
              kind: "CREATED",
              toRole: "OWNER",
              actorUserId: user.id,
              reasonCode: "REGISTRATION",
              correlationId: dependencies.request.correlationId,
              createdAt: now,
            },
            select: { id: true },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "COMPANY_CREATED_WITH_OWNER",
              actorKind: "USER",
              actorUserId: user.id,
              capability: "COMPANY_REGISTER",
              companyId: company.id,
              correlationId: dependencies.request.correlationId,
              metadata: toClaimSignalAuditMetadata(
                submittedSignalCodes(persistedSignals.uid !== null),
              ),
              result: "SUCCEEDED",
              retainUntil: auditRetainUntil(now),
              targetId: company.id,
              targetType: "COMPANY",
            },
            auditIpContext(dependencies),
          );
          branch = "COMPANY_CREATED";
          destination = "/employer/dashboard";
        } else {
          const matchSignalCodes = getCompanyClaimSignalCodes(
            persistedSignals,
            candidate,
          );
          if (matchSignalCodes.length === 0) {
            throw new Error("COMPANY_SIGNAL_MATCH_MISSING");
          }
          const claim = await transaction.companyClaimRequest.create({
            data: {
              requesterEmployerUserId: user.id,
              candidateCompanyId: candidate.id,
              requestedRole: "OWNER",
              matchSignals: [...matchSignalCodes],
              status: "PENDING",
              idempotencyKey: `registration:${user.id}`,
              events: {
                create: {
                  kind: "CREATED",
                  actorUserId: user.id,
                  reasonCode: "REGISTRATION_SIGNAL_MATCH",
                  correlationId: dependencies.request.correlationId,
                  createdAt: now,
                },
              },
            },
            select: { id: true },
          });
          await writeRequiredAudit(
            createPrismaTransactionAuditPort(transaction),
            {
              action: "COMPANY_CLAIM_REQUESTED",
              actorKind: "USER",
              actorUserId: user.id,
              capability: "COMPANY_CLAIM_REQUEST",
              companyId: candidate.id,
              correlationId: dependencies.request.correlationId,
              metadata: toClaimSignalAuditMetadata(matchSignalCodes),
              result: "SUCCEEDED",
              retainUntil: auditRetainUntil(now),
              targetId: claim.id,
              targetType: "CLAIM_REQUEST",
            },
            auditIpContext(dependencies),
          );
          branch = "COMPANY_CLAIM";
          destination = "/employer/company/claim-pending";
        }

        const session = await issueSession(transaction, {
          userId: user.id,
          now,
          request: dependencies.request,
          auditIpKeyring:
            dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
        });
        return Object.freeze({ branch, destination, session });
      },
    );

    return Object.freeze({ ok: true, ...registration });
  } catch {
    return Object.freeze({ ok: false, code: "REGISTRATION_FAILED" });
  }
}

export async function requestPasswordReset(
  input: Readonly<{ email: string }>,
  dependencies: AuthServiceDependencies & Readonly<{ emailProvider: EmailProvider }>,
): Promise<PasswordResetRequestResult> {
  const startedAt = Date.now();
  const now = dependencies.now ?? new Date();
  const rate = await consumeAuthRateLimit(
    "FORGOT_PASSWORD",
    { normalizedEmail: input.email },
    dependencies.request,
    now,
    { environment: dependencies.environment, database: dependencies.database },
  );
  if (!rate.allowed) {
    await auditRateLimit(dependencies, "FORGOT_PASSWORD", rate.audit.scope, now);
    await completeTimingEnvelope(startedAt);
    return Object.freeze({
      ok: true,
      rateLimited: true,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  try {
    const user = await dependencies.database.user.findUnique({
      where: { emailNormalized: input.email },
      select: { id: true, email: true, status: true, credential: { select: { id: true } } },
    });
    if (user?.status === "ACTIVE" && user.credential !== null) {
      const rawToken = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
      const tokenHash = hashPasswordResetToken(rawToken);
      const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MILLISECONDS);
      const reset = await dependencies.database.$transaction(async (transaction) => {
        const created = await transaction.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
            requestedIpHash: auditIpHash(dependencies),
            requestedUserAgent: dependencies.request.userAgent,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "PASSWORD_RESET_REQUESTED",
            actorKind: "ANONYMOUS",
            capability: "AUTH_PASSWORD_RESET_REQUEST",
            correlationId: dependencies.request.correlationId,
            result: "SUCCEEDED",
            retainUntil: auditRetainUntil(now),
            targetId: user.id,
            targetType: "USER",
          },
          auditIpContext(dependencies),
        );
        return created;
      });
      const resetUrl = new URL("/reset-password", dependencies.environment.APP_URL);
      // Keep the bearer secret out of the HTTP request target. URL fragments are
      // not sent to Next.js, reverse proxies or access logs; the reset page reads
      // the token in the browser, removes the fragment, and submits it by POST.
      resetUrl.hash = new URLSearchParams({ token: rawToken }).toString();
      await dependencies.emailProvider.send({
        to: user.email,
        templateKey: "password_reset_mock",
        subject: "Passwort für SwissTalentHub zurücksetzen",
        data: {
          resetUrl: resetUrl.toString(),
          expiresInMinutes: 15,
          idempotencyKey: reset.id,
        },
      });
    }
  } catch {
    // Enumeration-safe public contract: provider and persistence failures do not
    // reveal whether an account exists. Operators retain redacted audit/log data.
  }

  await completeTimingEnvelope(startedAt);
  return Object.freeze({ ok: true, rateLimited: false });
}

export async function resetPassword(
  input: ResetPasswordInput,
  dependencies: AuthServiceDependencies,
): Promise<PasswordResetResult> {
  const now = dependencies.now ?? new Date();
  const tokenHash = hashPasswordResetToken(input.token);

  try {
    // Reject arbitrary bearer-shaped input before the intentionally expensive
    // bcrypt operation. The conditional update below remains the authoritative
    // single-use/concurrency boundary after this optimistic lookup.
    const eligible = await dependencies.database.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true, usedAt: true, expiresAt: true },
    });
    if (
      eligible === null ||
      eligible.usedAt !== null ||
      eligible.expiresAt.getTime() <= now.getTime()
    ) {
      if (eligible !== null) {
        await auditFailedPasswordReset(dependencies, eligible.userId, now);
      }
      return Object.freeze({ ok: false, code: "INVALID_RESET_TOKEN" });
    }
    const passwordHash = await hashPassword(input.password);
    const succeeded = await dependencies.database.$transaction(
      async (transaction) => {
        const consumed = await transaction.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) return false;
        const token = await transaction.passwordResetToken.findUnique({
          where: { tokenHash },
          select: { userId: true },
        });
        if (token === null) return false;
        await transaction.credential.update({
          where: { userId: token.userId },
          data: {
            passwordHash,
            algorithm: PASSWORD_HASH_POLICY_V1.algorithm,
            algorithmVersion: PASSWORD_HASH_POLICY_V1.algorithmVersion,
            passwordChangedAt: now,
          },
          select: { id: true },
        });
        await transaction.passwordResetToken.updateMany({
          where: { userId: token.userId, usedAt: null },
          data: { usedAt: now },
        });
        await transaction.session.updateMany({
          where: { userId: token.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "PASSWORD_RESET_COMPLETED",
            actorKind: "ANONYMOUS",
            capability: "AUTH_PASSWORD_RESET",
            correlationId: dependencies.request.correlationId,
            result: "SUCCEEDED",
            retainUntil: auditRetainUntil(now),
            targetId: token.userId,
            targetType: "USER",
          },
          auditIpContext(dependencies),
        );
        return true;
      },
    );
    if (!succeeded) {
      await auditFailedPasswordReset(dependencies, eligible.userId, now);
      return Object.freeze({ ok: false, code: "INVALID_RESET_TOKEN" });
    }
    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({ ok: false, code: "INVALID_RESET_TOKEN" });
  }
}

function hasExplicitTermsAcceptance(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    "acceptedTerms" in input &&
    input.acceptedTerms === true
  );
}

export function hashPasswordResetToken(rawToken: string): string {
  if (rawToken.length < 32 || rawToken.length > 256) {
    throw new TypeError("Password reset token is malformed.");
  }
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

async function persistRegistrationConsents(
  transaction: Prisma.TransactionClient,
  userId: string,
  marketingConsent: boolean,
  now: Date,
) {
  const terms = createRegistrationTermsConsent({ userId, effectiveAt: now });
  const marketing = createRegistrationMarketingConsent({
    userId,
    effectiveAt: now,
    granted: marketingConsent,
  });
  await transaction.userConsentEvent.createMany({ data: [terms, marketing] });
}

async function registrationRateLimit(
  dependencies: AuthServiceDependencies,
  now: Date,
): Promise<Extract<RegistrationResult, { ok: false }> | null> {
  const rate = await consumeAuthRateLimit(
    "REGISTER",
    {},
    dependencies.request,
    now,
    { environment: dependencies.environment, database: dependencies.database },
  );
  if (rate.allowed) return null;
  await auditRateLimit(dependencies, "REGISTER", rate.audit.scope, now);
  return Object.freeze({
    ok: false,
    code: "RATE_LIMITED",
    retryAfterSeconds: rate.retryAfterSeconds,
  });
}

async function lockEmployerRegistrationSignals(
  transaction: Prisma.TransactionClient,
  signals: Readonly<{
    uid: string | null;
    registrationEmailDomainNormalized: string | null;
    registrationNameNormalized: string | null;
    registrationCantonId: string | null;
  }>,
) {
  const keys = [
    ...(signals.uid === null ? [] : [`uid:${signals.uid}`]),
    `domain:${signals.registrationEmailDomainNormalized}`,
    `name-canton:${signals.registrationNameNormalized}:${signals.registrationCantonId}`,
  ]
    .map((value) =>
      createHash("sha256")
        .update(`company-registration-v1\0${value}`, "utf8")
        .digest("hex"),
    )
    .sort();
  for (const key of keys) {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS "locked"',
      key,
    );
  }
}

async function auditFailedLogin(
  dependencies: AuthServiceDependencies,
  normalizedEmail: string,
  existingUserId: string | undefined,
  now: Date,
) {
  await writeBestEffortAudit(
    createPrismaAuditPort(dependencies.database),
    {
      action: "USER_LOGIN_FAILED",
      actorKind: "ANONYMOUS",
      capability: "AUTH_LOGIN",
      correlationId: dependencies.request.correlationId,
      metadata: {
        identifierHash: hashAuthIdentifier(
          normalizedEmail,
          dependencies.environment,
        ),
      },
      reasonCode: "INVALID_CREDENTIALS",
      result: "DENIED",
      retainUntil: auditRetainUntil(now),
      targetId: existingUserId ?? randomUUID(),
      targetType: "USER",
    },
    undefined,
    auditIpContext(dependencies),
  );
}

async function auditFailedPasswordReset(
  dependencies: AuthServiceDependencies,
  userId: string,
  now: Date,
) {
  await writeBestEffortAudit(
    createPrismaAuditPort(dependencies.database),
    {
      action: "PASSWORD_RESET_COMPLETED",
      actorKind: "ANONYMOUS",
      capability: "AUTH_PASSWORD_RESET",
      correlationId: dependencies.request.correlationId,
      reasonCode: "INVALID_RESET_TOKEN",
      result: "DENIED",
      retainUntil: auditRetainUntil(now),
      targetId: userId,
      targetType: "USER",
    },
    undefined,
    auditIpContext(dependencies),
  );
}

async function auditRateLimit(
  dependencies: AuthServiceDependencies,
  preset: "LOGIN" | "REGISTER" | "FORGOT_PASSWORD",
  scope: string,
  now: Date,
) {
  await writeBestEffortAudit(
    createPrismaAuditPort(dependencies.database),
    {
      action: "RATE_LIMITED",
      actorKind: "ANONYMOUS",
      capability: "AUTH_RATE_LIMIT",
      correlationId: dependencies.request.correlationId,
      metadata: { preset, scope },
      reasonCode: "RATE_LIMITED",
      result: "DENIED",
      retainUntil: auditRetainUntil(now),
      targetId: randomUUID(),
      targetType: "USER",
    },
    undefined,
    auditIpContext(dependencies),
  );
}

function auditIpContext(dependencies: AuthServiceDependencies) {
  return Object.freeze({
    sourceIp: dependencies.request.sourceIp,
    keyring: dependencies.environment.secrets.keyrings.AUDIT_IP_HASH_KEYS,
  });
}

function auditIpHash(dependencies: AuthServiceDependencies): string {
  const context = auditIpContext(dependencies);
  return hashIpWithFirstKey(
    context.sourceIp,
    context.keyring,
    "AUDIT_IP_HASH_KEYS",
  );
}

function auditRetainUntil(now: Date) {
  return new Date(now.getTime() + AUTH_AUDIT_RETENTION_MILLISECONDS);
}

function submittedSignalCodes(hasUid: boolean): readonly ClaimSignalCode[] {
  return Object.freeze([
    ...(hasUid ? (["UID"] as const) : []),
    "EMAIL_DOMAIN",
    "NAME_CANTON",
  ]);
}

function registrationSlug(companyName: string, userId: string): string {
  const base = slugify(companyName).slice(0, 180).replace(/-+$/u, "");
  return `${base || "unternehmen"}-${userId.slice(0, 8)}`;
}

async function completeTimingEnvelope(startedAt: number) {
  const remaining = FORGOT_TIMING_FLOOR_MILLISECONDS - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}
