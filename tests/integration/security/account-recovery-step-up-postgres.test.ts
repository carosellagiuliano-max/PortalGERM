import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requestLoginEmailChange } from "@/lib/auth/email-change-service";
import {
  beginStepUpChallenge,
  completeStepUpChallenge,
} from "@/lib/auth/assurance/step-up-service";
import { consumeEmailVerification } from "@/lib/auth/email-verification-service";
import { createVerificationToken } from "@/lib/auth/verification-token";
import type { ServerEnvironment } from "@/lib/config/env-schema";
import { createDatabaseClient, type DatabaseClient } from "@/lib/db/factory";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";
import {
  createPhase20User,
  issuePhase20Session,
  PHASE20_NOW,
  PHASE20_PASSWORD,
  phase20Environment,
  phase20Request,
} from "@/tests/fixtures/phase20-identity";

type Migrated = Awaited<ReturnType<typeof createMigratedTestDatabase>>;

describe("Phase 25 account recovery and login-email step-up", () => {
  let migrated: Migrated;
  let database: DatabaseClient;
  let environment: ServerEnvironment;

  beforeAll(async () => {
    migrated = await createMigratedTestDatabase(
      "phase25_account_recovery_step_up",
    );
    database = createDatabaseClient(migrated.connectionString);
    await database.$connect();
    environment = phase20Environment(migrated.connectionString, {
      IDENTITY_VERIFICATION_ENFORCEMENT: "true",
      LOGIN_EMAIL_CHANGE: "true",
      PRIVILEGED_STEP_UP_MODE: "enforce",
    });
  });

  afterAll(async () => {
    await database.$disconnect().catch(() => undefined);
    await migrated.dispose();
  });

  it("requires action-bound AAL2, then revokes every old session and grant on completion", async () => {
    const user = await createPhase20User(database, {
      email: "phase25-old-email@example.test",
      verified: true,
    });
    const initiating = await issuePhase20Session(
      database,
      environment,
      user.id,
      phase20Request(1),
    );
    const other = await issuePhase20Session(
      database,
      environment,
      user.id,
      phase20Request(2),
    );
    await database.sessionAssurance.create({
      data: {
        sessionId: initiating.record.id,
        userId: user.id,
        level: "AAL2",
        method: "WEBAUTHN",
        policyVersion: "ADMIN_MFA_POLICY_V1",
        verifiedAt: new Date(PHASE20_NOW.getTime() - 30_000),
        expiresAt: new Date(PHASE20_NOW.getTime() + 60 * 60_000),
        createdAt: PHASE20_NOW,
      },
    });
    const dependencies = {
      actor: {
        userId: user.id,
        sessionId: initiating.record.id,
        role: "CANDIDATE",
        status: "ACTIVE",
      },
      correlationId: crypto.randomUUID(),
      database,
      now: PHASE20_NOW,
    } as const;
    const challenge = await beginStepUpChallenge(
      {
        purpose: "ACCOUNT_SECURITY",
        action: "LOGIN_EMAIL_CHANGE",
        resourceId: user.id,
      },
      dependencies,
    );
    expect(challenge.ok).toBe(true);
    if (!challenge.ok) return;
    const grant = await completeStepUpChallenge(
      {
        challengeId: challenge.value.challengeId,
        challengeToken: challenge.value.challengeToken,
      },
      dependencies,
    );
    expect(grant.ok).toBe(true);
    if (!grant.ok) return;

    const withoutGrant = await requestLoginEmailChange(
      {
        userId: user.id,
        actorRole: "CANDIDATE",
        sessionToken: initiating.token,
        targetEmail: "phase25-without-grant@example.test",
        password: PHASE20_PASSWORD,
      },
      {
        database,
        environment,
        request: phase20Request(3),
        now: PHASE20_NOW,
      },
    );
    expect(withoutGrant.ok).toBe(false);
    expect(
      await database.pendingEmailChange.count({ where: { userId: user.id } }),
    ).toBe(0);

    const requested = await requestLoginEmailChange(
      {
        userId: user.id,
        actorRole: "CANDIDATE",
        sessionToken: initiating.token,
        targetEmail: "phase25-new-email@example.test",
        password: PHASE20_PASSWORD,
        stepUpEvidenceId: grant.value.evidenceId,
        stepUpGrantToken: grant.value.grantToken,
      },
      {
        database,
        environment,
        request: phase20Request(4),
        now: PHASE20_NOW,
      },
    );
    expect(requested).toMatchObject({ ok: true, status: "PENDING" });

    const pending = await database.pendingEmailChange.findFirstOrThrow({
      where: { userId: user.id, status: "PENDING" },
      include: { challenge: true },
    });
    const verificationToken = createVerificationToken(
      pending.challenge.id,
      pending.challenge.purpose,
      pending.challenge.addressEpoch,
      environment.secrets.session,
    );
    const completed = await consumeEmailVerification(
      verificationToken,
      initiating.token,
      {
        database,
        environment,
        request: phase20Request(5),
        now: new Date(PHASE20_NOW.getTime() + 1_000),
      },
    );
    expect(completed).toMatchObject({
      ok: true,
      status: "VERIFIED",
    });

    const [sessions, liveOldGrants, liveOldAssurance] = await Promise.all([
      database.session.findMany({
        where: {
          id: { in: [initiating.record.id, other.record.id] },
        },
      }),
      database.authAssuranceEvidence.count({
        where: {
          userId: user.id,
          sessionId: initiating.record.id,
          usedAt: null,
          revokedAt: null,
        },
      }),
      database.sessionAssurance.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ]);
    expect(sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true);
    expect(liveOldGrants).toBe(0);
    expect(liveOldAssurance).toBe(0);
    expect(
      await database.notificationOutbox.count({
        where: {
          purpose: {
            in: [
              "LOGIN_EMAIL_CHANGE_VERIFICATION",
              "LOGIN_EMAIL_CHANGED_NOTICE",
            ],
          },
        },
      }),
    ).toBe(2);
  });
});
