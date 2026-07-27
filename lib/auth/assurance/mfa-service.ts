import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import type { DatabaseClient } from "@/lib/db/factory";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  buildTotpUri,
  createRecoveryCodes,
  createTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCodeForLookup,
  TOTP_POLICY_V1,
  verifyTotp,
} from "@/lib/auth/assurance/totp";

export const ADMIN_MFA_POLICY_V1 = Object.freeze({
  policyVersion: "ADMIN_MFA_POLICY_V1",
  challengeTtlMilliseconds: 5 * 60 * 1_000,
  assuranceTtlMilliseconds: 12 * 60 * 60 * 1_000,
  recoveryAssuranceTtlMilliseconds: 30 * 60 * 1_000,
  maxAttempts: 5,
});

type MfaActor = Readonly<{
  userId: string;
  sessionId: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
}>;

export type MfaDependencies = Readonly<{
  actor: MfaActor;
  correlationId: string;
  database: DatabaseClient;
  environment: Pick<
    ServerEnvironment,
    "APP_URL" | "NEXT_PUBLIC_APP_NAME" | "secrets"
  >;
  now?: Date;
}>;

export type MfaResult<T> =
  | Readonly<{ ok: true; value: Readonly<T> }>
  | Readonly<{
      ok: false;
      code:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "INVALID_CHALLENGE"
        | "INVALID_FACTOR"
        | "CONFLICT"
        | "LAST_FACTOR"
        | "WRITE_FAILED";
    }>;

const labelSchema = z.string().trim().min(2).max(100);
const uuidSchema = z.uuid();
const totpCodeSchema = z.string().trim().regex(/^\d{6}$/u);

export async function getMfaOverview(dependencies: MfaDependencies) {
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const [authenticators, recovery, assurance] = await Promise.all([
    dependencies.database.authenticator.findMany({
      where: { userId: dependencies.actor.userId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        label: true,
        verifiedAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    }),
    dependencies.database.recoveryCode.count({
      where: {
        userId: dependencies.actor.userId,
        usedAt: null,
        revokedAt: null,
      },
    }),
    dependencies.database.sessionAssurance.findFirst({
      where: {
        sessionId: dependencies.actor.sessionId,
        userId: dependencies.actor.userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        level: true,
        method: true,
        verifiedAt: true,
        expiresAt: true,
      },
    }),
  ]);
  return mfaSuccess({
    authenticators,
    remainingRecoveryCodes: recovery,
    assurance,
  });
}

export async function beginTotpEnrollment(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<
  MfaResult<{
    authenticatorId: string;
    challengeId: string;
    secret: string;
    uri: string;
    expiresAt: Date;
  }>
> {
  const parsed = z.strictObject({ label: labelSchema }).safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const expiresAt = new Date(
    now.getTime() + TOTP_POLICY_V1.enrollmentTtlMilliseconds,
  );
  const secret = createTotpSecret();
  const encrypted = await withSessionSecret(
    dependencies,
    (sessionSecret) => encryptTotpSecret(secret.bytes, sessionSecret),
  );
  const authenticatorId = randomUUID();
  const challengeId = randomUUID();
  const challenge = randomBytes(32).toString("base64url");

  try {
    await dependencies.database.$transaction(async (transaction) => {
      await assertSessionActor(transaction, dependencies.actor, now);
      await transaction.authenticator.create({
        data: {
          id: authenticatorId,
          userId: dependencies.actor.userId,
          kind: "TOTP",
          status: "PENDING",
          label: parsed.data.label,
          createdAt: now,
          updatedAt: now,
          totp: {
            create: {
              secretCiphertext: Uint8Array.from(encrypted.ciphertext),
              secretNonce: Uint8Array.from(encrypted.nonce),
              secretTag: Uint8Array.from(encrypted.tag),
              keyVersion: encrypted.keyVersion,
              algorithm: TOTP_POLICY_V1.algorithm,
              digits: TOTP_POLICY_V1.digits,
              periodSeconds: TOTP_POLICY_V1.periodSeconds,
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        select: { id: true },
      });
      await transaction.authenticatorChallenge.create({
        data: {
          id: challengeId,
          userId: dependencies.actor.userId,
          sessionId: dependencies.actor.sessionId,
          authenticatorId,
          kind: "TOTP_ENROLLMENT",
          status: "PENDING",
          challengeDigest: digest(challenge),
          context: { policyVersion: ADMIN_MFA_POLICY_V1.policyVersion },
          maxAttempts: ADMIN_MFA_POLICY_V1.maxAttempts,
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeMfaAudit(transaction, dependencies, now, {
        action: "AUTHENTICATOR_ENROLLMENT_STARTED",
        capability: "AUTHENTICATOR_ENROLL",
        targetId: authenticatorId,
        targetType: "AUTHENTICATOR",
      });
    });
  } catch {
    return mfaFailure("WRITE_FAILED");
  }

  return mfaSuccess({
    authenticatorId,
    challengeId,
    secret: secret.base32,
    uri: buildTotpUri({
      accountName: dependencies.actor.email,
      issuer: dependencies.environment.NEXT_PUBLIC_APP_NAME,
      secretBase32: secret.base32,
    }),
    expiresAt,
  });
}

export async function completeTotpEnrollment(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ recoveryCodes: readonly string[]; expiresAt: Date }>> {
  const parsed = z
    .strictObject({
      challengeId: uuidSchema,
      authenticatorId: uuidSchema,
      code: totpCodeSchema,
    })
    .safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await lockAuthenticatorAndChallenge(
          transaction,
          parsed.data.authenticatorId,
          parsed.data.challengeId,
        );
        const challenge = await transaction.authenticatorChallenge.findFirst({
          where: {
            id: parsed.data.challengeId,
            authenticatorId: parsed.data.authenticatorId,
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            kind: "TOTP_ENROLLMENT",
            status: "PENDING",
            expiresAt: { gt: now },
            attemptCount: { lt: ADMIN_MFA_POLICY_V1.maxAttempts },
          },
          select: {
            id: true,
            authenticator: true,
          },
        });
        if (challenge === null) return mfaFailure("INVALID_CHALLENGE");
        const credential = await transaction.totpCredential.findUnique({
          where: { authenticatorId: parsed.data.authenticatorId },
        });
        if (
          credential === null ||
          challenge.authenticator?.status !== "PENDING"
        ) {
          return mfaFailure("INVALID_CHALLENGE");
        }
        const secret = await withSessionSecret(
          dependencies,
          (sessionSecret) =>
            decryptTotpSecret(
              {
                ciphertext: credential.secretCiphertext,
                nonce: credential.secretNonce,
                tag: credential.secretTag,
                keyVersion: credential.keyVersion,
              },
              sessionSecret,
            ),
        );
        const verified = verifyTotp(
          parsed.data.code,
          secret,
          now,
          credential.lastAcceptedStep,
        );
        if (!verified.valid || verified.acceptedStep === null) {
          await registerChallengeFailure(transaction, challenge.id);
          return mfaFailure("INVALID_FACTOR");
        }

        const recovery = await activateAuthenticator(
          transaction,
          dependencies,
          {
            authenticatorId: parsed.data.authenticatorId,
            challengeId: challenge.id,
            method: "TOTP",
            acceptedTotpStep: verified.acceptedStep,
          },
          now,
        );
        return mfaSuccess(recovery);
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function beginWebAuthnEnrollment(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<
  MfaResult<{
    authenticatorId: string;
    challengeId: string;
    options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
    expiresAt: Date;
  }>
> {
  const parsed = z.strictObject({ label: labelSchema }).safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const origin = new URL(dependencies.environment.APP_URL).origin;
  const rpID = new URL(origin).hostname;
  const existing = await dependencies.database.webAuthnCredential.findMany({
    where: {
      authenticator: {
        userId: dependencies.actor.userId,
        status: { in: ["PENDING", "ACTIVE"] },
      },
    },
    orderBy: { credentialId: "asc" },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: dependencies.environment.NEXT_PUBLIC_APP_NAME,
    rpID,
    userName: dependencies.actor.email,
    userDisplayName: dependencies.actor.name ?? dependencies.actor.email,
    userID: uuidToBytes(dependencies.actor.userId),
    timeout: ADMIN_MFA_POLICY_V1.challengeTtlMilliseconds,
    attestationType: "none",
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as never[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  const authenticatorId = randomUUID();
  const challengeId = randomUUID();
  const expiresAt = new Date(
    now.getTime() + ADMIN_MFA_POLICY_V1.challengeTtlMilliseconds,
  );

  try {
    await dependencies.database.$transaction(async (transaction) => {
      await assertSessionActor(transaction, dependencies.actor, now);
      await transaction.authenticator.create({
        data: {
          id: authenticatorId,
          userId: dependencies.actor.userId,
          kind: "WEBAUTHN",
          status: "PENDING",
          label: parsed.data.label,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      });
      await transaction.authenticatorChallenge.create({
        data: {
          id: challengeId,
          userId: dependencies.actor.userId,
          sessionId: dependencies.actor.sessionId,
          authenticatorId,
          kind: "WEBAUTHN_REGISTRATION",
          status: "PENDING",
          challengeDigest: digest(options.challenge),
          context: { origin, rpID, policyVersion: ADMIN_MFA_POLICY_V1.policyVersion },
          maxAttempts: ADMIN_MFA_POLICY_V1.maxAttempts,
          expiresAt,
          createdAt: now,
        },
        select: { id: true },
      });
      await writeMfaAudit(transaction, dependencies, now, {
        action: "AUTHENTICATOR_ENROLLMENT_STARTED",
        capability: "AUTHENTICATOR_ENROLL",
        targetId: authenticatorId,
        targetType: "AUTHENTICATOR",
      });
    });
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
  return mfaSuccess({ authenticatorId, challengeId, options, expiresAt });
}

export async function completeWebAuthnEnrollment(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ recoveryCodes: readonly string[]; expiresAt: Date }>> {
  const parsed = z
    .strictObject({
      challengeId: uuidSchema,
      authenticatorId: uuidSchema,
      response: z.custom<RegistrationResponseJSON>(
        (value) => value !== null && typeof value === "object",
      ),
    })
    .safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const challenge =
    await dependencies.database.authenticatorChallenge.findFirst({
      where: {
        id: parsed.data.challengeId,
        authenticatorId: parsed.data.authenticatorId,
        userId: dependencies.actor.userId,
        sessionId: dependencies.actor.sessionId,
        kind: "WEBAUTHN_REGISTRATION",
        status: "PENDING",
        expiresAt: { gt: now },
      },
      select: { challengeDigest: true, context: true },
    });
  if (challenge === null) return mfaFailure("INVALID_CHALLENGE");
  const context = parseWebAuthnContext(challenge.context);
  if (context === null) return mfaFailure("INVALID_CHALLENGE");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response,
      expectedChallenge: (supplied) =>
        digest(supplied) === challenge.challengeDigest,
      expectedOrigin: context.origin,
      expectedRPID: context.rpID,
      requireUserVerification: true,
    });
  } catch {
    return mfaFailure("INVALID_FACTOR");
  }
  if (!verification.verified) return mfaFailure("INVALID_FACTOR");

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await lockAuthenticatorAndChallenge(
          transaction,
          parsed.data.authenticatorId,
          parsed.data.challengeId,
        );
        const consumed = await transaction.authenticatorChallenge.updateMany({
          where: {
            id: parsed.data.challengeId,
            authenticatorId: parsed.data.authenticatorId,
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            status: "PENDING",
            expiresAt: { gt: now },
          },
          data: { status: "VERIFIED", verifiedAt: now },
        });
        if (consumed.count !== 1) return mfaFailure("CONFLICT");
        const info = verification.registrationInfo;
        await transaction.webAuthnCredential.create({
          data: {
            authenticatorId: parsed.data.authenticatorId,
            credentialId: info.credential.id,
            publicKey: Buffer.from(info.credential.publicKey),
            counter: BigInt(info.credential.counter),
            transports: [...(info.credential.transports ?? [])],
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            createdAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        const recovery = await activateAuthenticator(
          transaction,
          dependencies,
          {
            authenticatorId: parsed.data.authenticatorId,
            challengeId: parsed.data.challengeId,
            method: "WEBAUTHN",
          },
          now,
          true,
        );
        return mfaSuccess(recovery);
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function beginWebAuthnAuthentication(
  dependencies: MfaDependencies,
): Promise<
  MfaResult<{
    challengeId: string;
    options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
    expiresAt: Date;
  }>
> {
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const credentials =
    await dependencies.database.webAuthnCredential.findMany({
      where: {
        authenticator: {
          userId: dependencies.actor.userId,
          status: "ACTIVE",
          revokedAt: null,
        },
      },
      orderBy: { credentialId: "asc" },
      select: { credentialId: true, transports: true },
    });
  if (credentials.length === 0) return mfaFailure("INVALID_FACTOR");
  const rpID = new URL(dependencies.environment.APP_URL).hostname;
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: ADMIN_MFA_POLICY_V1.challengeTtlMilliseconds,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as never[],
    })),
  });
  const challengeId = randomUUID();
  const expiresAt = new Date(
    now.getTime() + ADMIN_MFA_POLICY_V1.challengeTtlMilliseconds,
  );
  try {
    await dependencies.database.authenticatorChallenge.create({
      data: {
        id: challengeId,
        userId: dependencies.actor.userId,
        sessionId: dependencies.actor.sessionId,
        kind: "WEBAUTHN_AUTHENTICATION",
        status: "PENDING",
        challengeDigest: digest(options.challenge),
        context: {
          origin: new URL(dependencies.environment.APP_URL).origin,
          rpID,
          policyVersion: ADMIN_MFA_POLICY_V1.policyVersion,
        },
        maxAttempts: ADMIN_MFA_POLICY_V1.maxAttempts,
        expiresAt,
        createdAt: now,
      },
      select: { id: true },
    });
    return mfaSuccess({ challengeId, options, expiresAt });
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function completeWebAuthnAuthentication(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ expiresAt: Date }>> {
  const parsed = z
    .strictObject({
      challengeId: uuidSchema,
      response: z.custom<AuthenticationResponseJSON>(
        (value) => value !== null && typeof value === "object",
      ),
    })
    .safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  const [challenge, credential] = await Promise.all([
    dependencies.database.authenticatorChallenge.findFirst({
      where: {
        id: parsed.data.challengeId,
        userId: dependencies.actor.userId,
        sessionId: dependencies.actor.sessionId,
        kind: "WEBAUTHN_AUTHENTICATION",
        status: "PENDING",
        expiresAt: { gt: now },
      },
      select: { challengeDigest: true, context: true },
    }),
    dependencies.database.webAuthnCredential.findUnique({
      where: { credentialId: parsed.data.response.id },
      include: { authenticator: true },
    }),
  ]);
  if (
    challenge === null ||
    credential === null ||
    credential.authenticator.userId !== dependencies.actor.userId ||
    credential.authenticator.status !== "ACTIVE"
  ) {
    return mfaFailure("INVALID_CHALLENGE");
  }
  const context = parseWebAuthnContext(challenge.context);
  if (context === null) return mfaFailure("INVALID_CHALLENGE");
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: parsed.data.response,
      expectedChallenge: (supplied) =>
        digest(supplied) === challenge.challengeDigest,
      expectedOrigin: context.origin,
      expectedRPID: context.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: Number(credential.counter),
        transports: credential.transports as never[],
      },
    });
  } catch {
    return mfaFailure("INVALID_FACTOR");
  }
  if (!verification.verified) return mfaFailure("INVALID_FACTOR");

  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await lockAuthenticatorAndChallenge(
          transaction,
          credential.authenticatorId,
          parsed.data.challengeId,
        );
        const consumed = await transaction.authenticatorChallenge.updateMany({
          where: {
            id: parsed.data.challengeId,
            userId: dependencies.actor.userId,
            sessionId: dependencies.actor.sessionId,
            status: "PENDING",
            expiresAt: { gt: now },
          },
          data: { status: "VERIFIED", verifiedAt: now },
        });
        if (consumed.count !== 1) return mfaFailure("CONFLICT");
        const updated = await transaction.webAuthnCredential.updateMany({
          where: {
            id: credential.id,
            counter: credential.counter,
            authenticator: { userId: dependencies.actor.userId, status: "ACTIVE" },
          },
          data: {
            counter: BigInt(verification.authenticationInfo.newCounter),
            backedUp: verification.authenticationInfo.credentialBackedUp,
            deviceType: verification.authenticationInfo.credentialDeviceType,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) return mfaFailure("CONFLICT");
        const result = await grantSessionAssurance(
          transaction,
          dependencies,
          credential.authenticatorId,
          "WEBAUTHN",
          now,
        );
        return mfaSuccess(result);
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function completeTotpAuthentication(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ expiresAt: Date }>> {
  const parsed = z
    .strictObject({ authenticatorId: uuidSchema, code: totpCodeSchema })
    .safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await transaction.$queryRaw`
          SELECT "id" FROM "Authenticator"
          WHERE "id" = ${parsed.data.authenticatorId}::uuid
          FOR UPDATE
        `;
        const credential = await transaction.totpCredential.findUnique({
          where: { authenticatorId: parsed.data.authenticatorId },
          include: { authenticator: true },
        });
        if (
          credential === null ||
          credential.authenticator.userId !== dependencies.actor.userId ||
          credential.authenticator.status !== "ACTIVE"
        ) {
          return mfaFailure("INVALID_FACTOR");
        }
        const secret = await withSessionSecret(
          dependencies,
          (sessionSecret) =>
            decryptTotpSecret(
              {
                ciphertext: credential.secretCiphertext,
                nonce: credential.secretNonce,
                tag: credential.secretTag,
                keyVersion: credential.keyVersion,
              },
              sessionSecret,
            ),
        );
        const verification = verifyTotp(
          parsed.data.code,
          secret,
          now,
          credential.lastAcceptedStep,
        );
        if (!verification.valid || verification.acceptedStep === null) {
          return mfaFailure("INVALID_FACTOR");
        }
        const updated = await transaction.totpCredential.updateMany({
          where: {
            id: credential.id,
            lastAcceptedStep: credential.lastAcceptedStep,
          },
          data: { lastAcceptedStep: verification.acceptedStep, updatedAt: now },
        });
        if (updated.count !== 1) return mfaFailure("CONFLICT");
        const result = await grantSessionAssurance(
          transaction,
          dependencies,
          credential.authenticatorId,
          "TOTP",
          now,
        );
        return mfaSuccess(result);
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function consumeRecoveryCode(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ expiresAt: Date }>> {
  const parsed = z.strictObject({ code: z.string().trim().max(64) }).safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  let codeHash: string;
  try {
    codeHash = await withSessionSecret(dependencies, (secret) =>
      hashRecoveryCodeForLookup(parsed.data.code, secret),
    );
  } catch {
    return mfaFailure("INVALID_INPUT");
  }
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await transaction.$queryRaw`
          SELECT "id" FROM "RecoveryCode"
          WHERE "codeHash" = ${codeHash}
          FOR UPDATE
        `;
        const consumed = await transaction.recoveryCode.updateMany({
          where: {
            codeHash,
            userId: dependencies.actor.userId,
            usedAt: null,
            revokedAt: null,
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) return mfaFailure("INVALID_FACTOR");
        const assurance = await grantSessionAssurance(
          transaction,
          dependencies,
          null,
          "RECOVERY",
          now,
          "RECOVERY",
        );
        await writeMfaAudit(transaction, dependencies, now, {
          action: "RECOVERY_CODE_USED",
          capability: "AUTHENTICATOR_RECOVERY",
          targetId: dependencies.actor.sessionId,
          targetType: "SESSION_ASSURANCE",
        });
        return mfaSuccess(assurance);
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function revokeAuthenticator(
  raw: unknown,
  dependencies: MfaDependencies,
): Promise<MfaResult<{ authenticatorId: string }>> {
  const parsed = z
    .strictObject({
      authenticatorId: uuidSchema,
      reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
    })
    .safeParse(raw);
  if (!parsed.success) return mfaFailure("INVALID_INPUT");
  if (!validActor(dependencies.actor)) return mfaFailure("FORBIDDEN");
  const now = mfaNow(dependencies.now);
  try {
    return await dependencies.database.$transaction(
      async (transaction) => {
        await assertSessionActor(transaction, dependencies.actor, now);
        await transaction.$queryRaw`
          SELECT "id" FROM "Authenticator"
          WHERE "userId" = ${dependencies.actor.userId}::uuid
          ORDER BY "id"
          FOR UPDATE
        `;
        const active = await transaction.authenticator.findMany({
          where: {
            userId: dependencies.actor.userId,
            status: "ACTIVE",
            revokedAt: null,
          },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (!active.some(({ id }) => id === parsed.data.authenticatorId)) {
          return mfaFailure("INVALID_FACTOR");
        }
        if (active.length <= 1) return mfaFailure("LAST_FACTOR");
        const changed = await transaction.authenticator.updateMany({
          where: {
            id: parsed.data.authenticatorId,
            userId: dependencies.actor.userId,
            status: "ACTIVE",
            revokedAt: null,
          },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokedByUserId: dependencies.actor.userId,
            updatedAt: now,
          },
        });
        if (changed.count !== 1) return mfaFailure("CONFLICT");
        await transaction.sessionAssurance.updateMany({
          where: {
            userId: dependencies.actor.userId,
            authenticatorId: parsed.data.authenticatorId,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        await transaction.authenticatorEvent.create({
          data: {
            authenticatorId: parsed.data.authenticatorId,
            actorUserId: dependencies.actor.userId,
            kind: "REVOKED",
            reasonCode: parsed.data.reasonCode,
            correlationId: dependencies.correlationId,
            createdAt: now,
          },
          select: { id: true },
        });
        await writeMfaAudit(transaction, dependencies, now, {
          action: "AUTHENTICATOR_REVOKED",
          capability: "AUTHENTICATOR_REVOKE",
          targetId: parsed.data.authenticatorId,
          targetType: "AUTHENTICATOR",
          reasonCode: parsed.data.reasonCode,
        });
        return mfaSuccess({ authenticatorId: parsed.data.authenticatorId });
      },
      { isolationLevel: "Serializable" },
    );
  } catch {
    return mfaFailure("WRITE_FAILED");
  }
}

export async function hasCurrentAal2(
  database: DatabaseClient,
  input: Readonly<{ userId: string; sessionId: string; now?: Date }>,
): Promise<boolean> {
  const now = mfaNow(input.now);
  return (
    (await database.sessionAssurance.count({
      where: {
        userId: input.userId,
        sessionId: input.sessionId,
        level: "AAL2",
        revokedAt: null,
        expiresAt: { gt: now },
        session: { revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      },
    })) === 1
  );
}

async function activateAuthenticator(
  transaction: Prisma.TransactionClient,
  dependencies: MfaDependencies,
  input: Readonly<{
    authenticatorId: string;
    challengeId: string;
    method: "TOTP" | "WEBAUTHN";
    acceptedTotpStep?: bigint;
  }>,
  now: Date,
  challengeAlreadyConsumed = false,
) {
  if (!challengeAlreadyConsumed) {
    const challenge = await transaction.authenticatorChallenge.updateMany({
      where: {
        id: input.challengeId,
        authenticatorId: input.authenticatorId,
        userId: dependencies.actor.userId,
        sessionId: dependencies.actor.sessionId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: { status: "VERIFIED", verifiedAt: now },
    });
    if (challenge.count !== 1) throw new Error("CHALLENGE_CONFLICT");
  }
  if (input.acceptedTotpStep !== undefined) {
    await transaction.totpCredential.update({
      where: { authenticatorId: input.authenticatorId },
      data: { lastAcceptedStep: input.acceptedTotpStep, updatedAt: now },
      select: { id: true },
    });
  }
  const activated = await transaction.authenticator.updateMany({
    where: {
      id: input.authenticatorId,
      userId: dependencies.actor.userId,
      status: "PENDING",
    },
    data: {
      status: "ACTIVE",
      verifiedAt: now,
      lastUsedAt: now,
      updatedAt: now,
    },
  });
  if (activated.count !== 1) throw new Error("AUTHENTICATOR_CONFLICT");
  await transaction.authenticatorEvent.create({
    data: {
      authenticatorId: input.authenticatorId,
      actorUserId: dependencies.actor.userId,
      kind: "ACTIVATED",
      reasonCode: `${input.method}_VERIFIED`,
      correlationId: dependencies.correlationId,
      createdAt: now,
    },
    select: { id: true },
  });
  const recoveryCodes = await rotateRecoveryCodes(
    transaction,
    dependencies,
    now,
  );
  const assurance = await grantSessionAssurance(
    transaction,
    dependencies,
    input.authenticatorId,
    input.method,
    now,
  );
  await writeMfaAudit(transaction, dependencies, now, {
    action: "AUTHENTICATOR_ACTIVATED",
    capability: "AUTHENTICATOR_ENROLL",
    targetId: input.authenticatorId,
    targetType: "AUTHENTICATOR",
  });
  return Object.freeze({ ...assurance, recoveryCodes });
}

async function rotateRecoveryCodes(
  transaction: Prisma.TransactionClient,
  dependencies: MfaDependencies,
  now: Date,
): Promise<readonly string[]> {
  const codes = await withSessionSecret(dependencies, createRecoveryCodes);
  const batchId = randomUUID();
  await transaction.recoveryCode.updateMany({
    where: {
      userId: dependencies.actor.userId,
      usedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  await transaction.recoveryCode.createMany({
    data: codes.map(({ hash }) => ({
      userId: dependencies.actor.userId,
      batchId,
      codeHash: hash,
      createdAt: now,
    })),
  });
  await writeMfaAudit(transaction, dependencies, now, {
    action: "RECOVERY_CODES_ROTATED",
    capability: "AUTHENTICATOR_RECOVERY",
    targetId: dependencies.actor.userId,
    targetType: "USER",
  });
  return Object.freeze(codes.map(({ raw }) => raw));
}

async function grantSessionAssurance(
  transaction: Prisma.TransactionClient,
  dependencies: MfaDependencies,
  authenticatorId: string | null,
  method: "TOTP" | "WEBAUTHN" | "RECOVERY",
  now: Date,
  level: "AAL2" | "RECOVERY" = "AAL2",
) {
  const session = await transaction.session.findFirst({
    where: {
      id: dependencies.actor.sessionId,
      userId: dependencies.actor.userId,
      revokedAt: null,
      expiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
    },
    select: { absoluteExpiresAt: true },
  });
  if (session === null) throw new Error("SESSION_UNAVAILABLE");
  const ttl =
    level === "RECOVERY"
      ? ADMIN_MFA_POLICY_V1.recoveryAssuranceTtlMilliseconds
      : ADMIN_MFA_POLICY_V1.assuranceTtlMilliseconds;
  const expiresAt = new Date(
    Math.min(session.absoluteExpiresAt.getTime(), now.getTime() + ttl),
  );
  await transaction.sessionAssurance.upsert({
    where: { sessionId: dependencies.actor.sessionId },
    create: {
      sessionId: dependencies.actor.sessionId,
      userId: dependencies.actor.userId,
      authenticatorId,
      level,
      method,
      policyVersion: ADMIN_MFA_POLICY_V1.policyVersion,
      verifiedAt: now,
      expiresAt,
      createdAt: now,
    },
    update: {
      authenticatorId,
      level,
      method,
      policyVersion: ADMIN_MFA_POLICY_V1.policyVersion,
      verifiedAt: now,
      expiresAt,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (authenticatorId !== null) {
    await transaction.authenticator.update({
      where: { id: authenticatorId },
      data: { lastUsedAt: now, updatedAt: now },
      select: { id: true },
    });
    await transaction.authenticatorEvent.create({
      data: {
        authenticatorId,
        actorUserId: dependencies.actor.userId,
        kind: "USED",
        reasonCode: "SESSION_ASSURANCE",
        correlationId: dependencies.correlationId,
        createdAt: now,
      },
      select: { id: true },
    });
  }
  await writeMfaAudit(transaction, dependencies, now, {
    action: "SESSION_ASSURANCE_GRANTED",
    capability: "AUTHENTICATOR_VERIFY",
    targetId: dependencies.actor.sessionId,
    targetType: "SESSION_ASSURANCE",
  });
  return Object.freeze({ expiresAt });
}

async function assertSessionActor(
  transaction: Prisma.TransactionClient,
  actor: MfaActor,
  now: Date,
): Promise<void> {
  const session = await transaction.session.count({
    where: {
      id: actor.sessionId,
      userId: actor.userId,
      revokedAt: null,
      expiresAt: { gt: now },
      absoluteExpiresAt: { gt: now },
      user: { status: "ACTIVE" },
    },
  });
  if (session !== 1) throw new Error("SESSION_ACTOR_MISMATCH");
}

async function lockAuthenticatorAndChallenge(
  transaction: Prisma.TransactionClient,
  authenticatorId: string,
  challengeId: string,
) {
  await transaction.$queryRaw`
    SELECT "id" FROM "Authenticator"
    WHERE "id" = ${authenticatorId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id" FROM "AuthenticatorChallenge"
    WHERE "id" = ${challengeId}::uuid
    FOR UPDATE
  `;
}

async function registerChallengeFailure(
  transaction: Prisma.TransactionClient,
  challengeId: string,
) {
  await transaction.authenticatorChallenge.updateMany({
    where: { id: challengeId, status: "PENDING" },
    data: { attemptCount: { increment: 1 } },
  });
}

function parseWebAuthnContext(
  value: Prisma.JsonValue,
): Readonly<{ origin: string; rpID: string }> | null {
  const parsed = z
    .strictObject({
      origin: z.url(),
      rpID: z.string().min(1).max(253),
      policyVersion: z.literal(ADMIN_MFA_POLICY_V1.policyVersion),
    })
    .safeParse(value);
  return parsed.success
    ? Object.freeze({ origin: parsed.data.origin, rpID: parsed.data.rpID })
    : null;
}

async function writeMfaAudit(
  transaction: Prisma.TransactionClient,
  dependencies: MfaDependencies,
  now: Date,
  input: Readonly<{
    action:
      | "AUTHENTICATOR_ENROLLMENT_STARTED"
      | "AUTHENTICATOR_ACTIVATED"
      | "AUTHENTICATOR_REVOKED"
      | "RECOVERY_CODES_ROTATED"
      | "RECOVERY_CODE_USED"
      | "SESSION_ASSURANCE_GRANTED";
    capability: string;
    targetId: string;
    targetType:
      | "USER"
      | "AUTHENTICATOR"
      | "SESSION_ASSURANCE";
    reasonCode?: string;
  }>,
) {
  await writeRequiredAudit(createPrismaTransactionAuditPort(transaction), {
    action: input.action,
    actorKind: "USER",
    actorUserId: dependencies.actor.userId,
    capability: input.capability,
    correlationId: dependencies.correlationId,
    reasonCode: input.reasonCode ?? null,
    result: "SUCCEEDED",
    retainUntil: new Date(now.getTime() + 400 * 86_400_000),
    targetId: input.targetId,
    targetType: input.targetType,
  });
}

function validActor(actor: MfaActor): boolean {
  return (
    actor.status === "ACTIVE" &&
    ["ADMIN", "CANDIDATE", "EMPLOYER", "RECRUITER"].includes(actor.role)
  );
}

function mfaNow(value?: Date): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid MFA clock.");
  return new Date(now);
}

function mfaSuccess<T>(value: T): MfaResult<T> {
  return Object.freeze({ ok: true, value: Object.freeze(value) });
}

function mfaFailure(code: Extract<MfaResult<never>, { ok: false }>["code"]) {
  return Object.freeze({ ok: false, code }) as MfaResult<never>;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uuidToBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    Buffer.from(value.replaceAll("-", ""), "hex"),
  ) as Uint8Array<ArrayBuffer>;
}

function withSessionSecret<T>(
  dependencies: MfaDependencies,
  operation: (secret: string) => T,
): T {
  return dependencies.environment.secrets.session.withValue(operation);
}
