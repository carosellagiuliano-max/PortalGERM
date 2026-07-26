import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/lib/generated/prisma/client";

import { writeRequiredAudit } from "@/lib/audit/log";
import { createPrismaTransactionAuditPort } from "@/lib/audit/prisma-port";
import type { DatabaseClient } from "@/lib/db/factory";
import { applyCandidateRadarEligibilityLoss } from "@/lib/talentradar/eligibility-loss-effects";

const DAY_MILLISECONDS = 86_400_000;

export type PrivacyRestoreReconciliationResult = Readonly<{
  inspectedTombstones: number;
  reconciledTombstones: number;
  reconciledSubjects: number;
  unresolvedTombstones: number;
  scannedUsers: number;
}>;

/**
 * Bounded post-restore safety command. It deliberately reconciles only
 * canonical database identity/profile rows. Object-provider reconciliation is
 * left unresolved for the provider worker instead of claiming success.
 */
export async function reconcilePrivacyRestoreV1(
  database: DatabaseClient,
  input: Readonly<{
    now: Date;
    tombstoneLimit?: number;
    userScanLimit?: number;
  }>,
): Promise<PrivacyRestoreReconciliationResult> {
  if (!Number.isFinite(input.now.getTime())) {
    throw new TypeError("Privacy restore reconciliation requires a valid clock.");
  }
  const tombstoneLimit = bounded(input.tombstoneLimit ?? 100, 1, 500);
  const userScanLimit = bounded(input.userScanLimit ?? 10_000, 1, 100_000);
  const tombstones = await database.privacyTombstone.findMany({
    where: { reconciledAt: null },
    orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    take: tombstoneLimit,
  });
  const subjectHashes = new Set(
    tombstones.map(({ subjectReferenceHash }) => subjectReferenceHash),
  );
  const usersByHash = new Map<
    string,
    Readonly<{ id: string; email: string; candidateProfileId: string | null }>
  >();
  let scannedUsers = 0;
  let cursor: string | undefined;
  while (scannedUsers < userScanLimit && usersByHash.size < subjectHashes.size) {
    const take = Math.min(500, userScanLimit - scannedUsers);
    const users = await database.user.findMany({
      orderBy: { id: "asc" },
      take,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
      select: {
        id: true,
        email: true,
        candidateProfile: { select: { id: true } },
      },
    });
    if (users.length === 0) break;
    scannedUsers += users.length;
    cursor = users.at(-1)!.id;
    for (const user of users) {
      const hash = sha256(user.id);
      if (!subjectHashes.has(hash)) continue;
      usersByHash.set(
        hash,
        Object.freeze({
          id: user.id,
          email: user.email,
          candidateProfileId: user.candidateProfile?.id ?? null,
        }),
      );
    }
  }

  let reconciledTombstones = 0;
  let reconciledSubjects = 0;
  for (const [subjectReferenceHash, user] of usersByHash) {
    const subjectTombstones = tombstones.filter(
      (candidate) =>
        candidate.subjectReferenceHash === subjectReferenceHash &&
        isDatabaseReconciliationScope(candidate.entityKey),
    );
    if (subjectTombstones.length === 0) continue;
    await database.$transaction(async (transaction) => {
      if (user.candidateProfileId !== null) {
        await applyCandidateRadarEligibilityLoss(transaction, {
          candidateProfileId: user.candidateProfileId,
          candidateUserId: user.id,
          reason: "CANDIDATE_USER_UNAVAILABLE",
          actor: { kind: "SYSTEM" },
          correlationId: randomUUID(),
          now: input.now,
        });
      }
      await transaction.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await transaction.emailLog.updateMany({
        where: { recipient: user.email },
        data: {
          recipient: erasedEmail(subjectReferenceHash),
          payload: {
            redacted: true,
            policyVersion: "privacy-restore-reconciliation-v1",
          },
          updatedAt: input.now,
        },
      });
      await transaction.user.update({
        where: { id: user.id },
        data: {
          email: erasedEmail(subjectReferenceHash),
          emailNormalized: erasedEmail(subjectReferenceHash),
          emailAddressEpoch: { increment: 1 },
          name: null,
          status: "SUSPENDED",
          updatedAt: input.now,
        },
      });
      if (user.candidateProfileId !== null) {
        await transaction.candidateProfile.update({
          where: { id: user.candidateProfileId },
          data: {
            firstName: null,
            lastName: null,
            publicDisplayName: null,
            phone: null,
            postalCode: null,
            cityLabel: null,
            summary: null,
            workPermitType: null,
            updatedAt: input.now,
          },
        });
        await transaction.message.updateMany({
          where: { senderUserId: user.id },
          data: { body: "[anonymisiert]", editedAt: input.now },
        });
        await transaction.applicationCandidateNote.updateMany({
          where: {
            application: { candidateProfileId: user.candidateProfileId },
          },
          data: { body: "[anonymisiert]", updatedAt: input.now },
        });
      }
      for (const tombstone of subjectTombstones) {
        await transaction.privacyTombstone.update({
          where: { id: tombstone.id },
          data: { reconciledAt: input.now },
        });
        await writeRequiredAudit(
          createPrismaTransactionAuditPort(transaction),
          {
            action: "PRIVACY_RESTORE_RECONCILED",
            actorKind: "SYSTEM",
            capability: "PRIVACY_RESTORE_RECONCILE",
            correlationId: randomUUID(),
            metadata: {},
            reasonCode: "TOMBSTONE_REAPPLIED",
            result: "SUCCEEDED",
            retainUntil: new Date(
              input.now.getTime() + 400 * DAY_MILLISECONDS,
            ),
            targetId: tombstone.id,
            targetType: "PRIVACY_TOMBSTONE",
          },
        );
      }
    }, transactionOptions());
    reconciledSubjects += 1;
    reconciledTombstones += subjectTombstones.length;
  }

  return Object.freeze({
    inspectedTombstones: tombstones.length,
    reconciledTombstones,
    reconciledSubjects,
    unresolvedTombstones: tombstones.length - reconciledTombstones,
    scannedUsers,
  });
}

function isDatabaseReconciliationScope(entityKey: string) {
  return (
    entityKey === "USER_ACCOUNT" ||
    entityKey === "CANDIDATE_PROFILE" ||
    entityKey === "BACKUP_SNAPSHOT" ||
    entityKey === "SUBJECT_ROOT" ||
    entityKey === "EMAIL_PROVIDER_RECEIPT" ||
    entityKey === "OPTIONAL_PRODUCT_ANALYTICS"
  );
}

function erasedEmail(subjectReferenceHash: string) {
  return `erased-${subjectReferenceHash.slice(0, 24)}@invalid.local`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `Privacy restore bound must be within ${minimum}..${maximum}.`,
    );
  }
  return value;
}

function transactionOptions() {
  return {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 15_000,
    timeout: 30_000,
  } as const;
}
