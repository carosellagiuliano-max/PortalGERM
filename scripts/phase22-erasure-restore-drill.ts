import { createHash } from "node:crypto";

import { reconcilePrivacyRestoreV1 } from "@/lib/privacy/restore-reconciliation";
import {
  createPhase22Harness,
  PHASE22_NOW,
  seedPhase22Actors,
} from "@/tests/fixtures/phase22-privacy";

const harness = await createPhase22Harness("phase22_erasure_restore_drill");

try {
  const actors = await seedPhase22Actors(harness.client, "restore");
  const profile = await harness.client.candidateProfile.create({
    data: {
      userId: actors.requester.id,
      firstName: "RESTORED_FIRST_NAME_CANARY",
      lastName: "RESTORED_LAST_NAME_CANARY",
      publicDisplayName: "RESTORED_DISPLAY_CANARY",
      phone: "+41 79 999 99 99",
      cityLabel: "RESTORED_CITY_CANARY",
      summary: "RESTORED_SUMMARY_CANARY",
    },
  });
  const subjectReferenceHash = createHash("sha256")
    .update(actors.requester.id, "utf8")
    .digest("hex");
  const tombstone = await harness.client.privacyTombstone.create({
    data: {
      subjectReferenceHash,
      processorKey: "backup-restore",
      entityKey: "SUBJECT_ROOT",
      erasureProofDigest: createHash("sha256")
        .update(`restore-proof:${actors.requester.id}`, "utf8")
        .digest("hex"),
      effectiveAt: new Date(PHASE22_NOW.getTime() - 86_400_000),
    },
  });

  const before = JSON.stringify(
    await harness.client.user.findUniqueOrThrow({
      where: { id: actors.requester.id },
      include: { candidateProfile: true },
    }),
  );
  assert(before.includes("RESTORED_"), "restore canary was not present before reconciliation");

  const result = await reconcilePrivacyRestoreV1(harness.client, {
    now: PHASE22_NOW,
    tombstoneLimit: 100,
    userScanLimit: 1_000,
  });
  const [account, reconciledTombstone, auditCount] = await Promise.all([
    harness.client.user.findUniqueOrThrow({
      where: { id: actors.requester.id },
      include: { candidateProfile: true },
    }),
    harness.client.privacyTombstone.findUniqueOrThrow({
      where: { id: tombstone.id },
    }),
    harness.client.auditLog.count({
      where: {
        action: "PRIVACY_RESTORE_RECONCILED",
        targetId: tombstone.id,
      },
    }),
  ]);
  const after = JSON.stringify(account);
  assert(!after.includes("RESTORED_"), "restore reconciliation left PII canaries");
  assert(account.status === "SUSPENDED", "restored account remained active");
  assert(
    account.candidateProfile?.id === profile.id &&
      account.candidateProfile.firstName === null &&
      account.candidateProfile.phone === null,
    "restored candidate profile was not anonymized",
  );
  assert(
    reconciledTombstone.reconciledAt?.getTime() === PHASE22_NOW.getTime(),
    "tombstone was not reconciled",
  );
  assert(auditCount === 1, "restore reconciliation audit is missing or duplicated");
  assert(
    result.reconciledTombstones === 1 &&
      result.unresolvedTombstones === 0,
    "restore reconciliation result is incomplete",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        contract: "phase22-erasure-restore-drill-v1",
        simulatedRestoredSubjects: 1,
        reactivatedPiiCanariesAfterReconcile: 0,
        result,
        subjectDigest: subjectReferenceHash,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await harness.dispose();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
