import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseClient } from "@/lib/db/factory";
import {
  createPhase31Fixture,
  PHASE31_ADMIN_OPS,
  PHASE31_NOW,
  phase31Digest,
  type Phase31Fixture,
} from "@/tests/fixtures/phase31-commercial";

describe.sequential("Phase 31 customer-facing recovery release PostgreSQL boundary", () => {
  let fixture: Phase31Fixture | undefined;
  let database: DatabaseClient;
  let releaseId = "";

  beforeAll(async () => {
    fixture = await createPhase31Fixture("phase31_service_recovery");
    database = fixture.database;
  }, 600_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it("rejects a paid-service policy without extension, credit and refund", async () => {
    await expect(
      database.servicePolicyRelease.create({
        data: {
          id: randomUUID(),
          versionCode: "phase31-incomplete-recovery",
          status: "APPROVED",
          policyDigest: phase31Digest("incomplete-policy"),
          customerCopyDigest: phase31Digest("incomplete-copy"),
          supportedOfferKinds: ["HIRING_SPRINT"],
          responseSlaMinutes: 240,
          remedyCodes: ["RETRY"],
          escalationOwner: "Ops",
          approvedByUserId: PHASE31_ADMIN_OPS,
          approvedAt: PHASE31_NOW,
        },
      }),
    ).rejects.toThrow();
  });

  it("records a complete versioned policy without mutating Phase-24 finance truth", async () => {
    const release = await database.servicePolicyRelease.create({
      data: {
        id: randomUUID(),
        versionCode: "phase31-recovery-v1",
        status: "APPROVED",
        policyDigest: phase31Digest("phase31-recovery-policy-v1"),
        customerCopyDigest: phase31Digest("phase31-recovery-copy-v1"),
        supportedOfferKinds: ["HIRING_SPRINT", "MANAGED_IMPORT"],
        responseSlaMinutes: 240,
        remedyCodes: [
          "RETRY",
          "EXTENSION",
          "REPLACEMENT",
          "CREDIT",
          "PARTIAL_REFUND",
          "REFUND",
        ],
        escalationOwner: "Customer Success / Finance",
        approvedByUserId: PHASE31_ADMIN_OPS,
        approvedAt: PHASE31_NOW,
      },
    });
    releaseId = release.id;
    expect(release).toMatchObject({
      status: "APPROVED",
      responseSlaMinutes: 240,
      remedyCodes: expect.arrayContaining(["EXTENSION", "CREDIT", "REFUND"]),
    });
    await expect(database.serviceDeliveryAssessment.count()).resolves.toBe(0);
    await expect(database.refund.count()).resolves.toBe(0);
    await expect(database.creditLedgerEntry.count()).resolves.toBe(0);
  });

  it("prevents silent policy edits and deletions", async () => {
    await expect(
      database.servicePolicyRelease.update({
        where: { id: releaseId },
        data: { responseSlaMinutes: 10_000 },
      }),
    ).rejects.toThrow("append-only");
    await expect(
      database.servicePolicyRelease.delete({ where: { id: releaseId } }),
    ).rejects.toThrow("append-only");
  });
});
