// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPostgresPrivacyCaseService,
  type PrivacyCaseAdminActor,
  type PrivacyCaseAdminCapability,
} from "@/lib/privacy/privacy-case-service";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-07-23T10:00:00.000Z");

const WITHOUT_READ = Object.freeze([
  [],
  ["PRIVACY_CASE_VERIFY"],
  ["PRIVACY_CASE_PROCESS"],
  ["PRIVACY_CASE_VERIFY", "PRIVACY_CASE_PROCESS"],
] as const satisfies readonly (readonly PrivacyCaseAdminCapability[])[]);

const WITHOUT_VERIFY = Object.freeze([
  [],
  ["PRIVACY_CASE_READ"],
  ["PRIVACY_CASE_PROCESS"],
  ["PRIVACY_CASE_READ", "PRIVACY_CASE_PROCESS"],
] as const satisfies readonly (readonly PrivacyCaseAdminCapability[])[]);

const WITHOUT_PROCESS = Object.freeze([
  [],
  ["PRIVACY_CASE_READ"],
  ["PRIVACY_CASE_VERIFY"],
  ["PRIVACY_CASE_READ", "PRIVACY_CASE_VERIFY"],
] as const satisfies readonly (readonly PrivacyCaseAdminCapability[])[]);

describe("Privacy case Admin capability matrix", () => {
  it("denies both read operations for every capability set without READ", async () => {
    const transaction = vi.fn();
    const service = createPostgresPrivacyCaseService({
      $transaction: transaction,
    } as never);

    for (const capabilities of WITHOUT_READ) {
      const deniedActor = actor(capabilities);
      await expect(
        service.listAdminQueue(deniedActor, { limit: 25 }, NOW),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        service.getAdminDetail(
          deniedActor,
          { requestId: REQUEST_ID, justificationCode: "LEGAL_REVIEW" },
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    }

    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies both identity-verification operations for every capability set without VERIFY", async () => {
    const transaction = vi.fn();
    const service = createPostgresPrivacyCaseService({
      $transaction: transaction,
    } as never);

    for (const capabilities of WITHOUT_VERIFY) {
      const deniedActor = actor(capabilities);
      await expect(
        service.startIdentityCheck(
          deniedActor,
          command("verify-start"),
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        service.verifyIdentity(
          deniedActor,
          command("verify-complete"),
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    }

    expect(transaction).not.toHaveBeenCalled();
  });

  it("denies every processing operation for every capability set without PROCESS", async () => {
    const transaction = vi.fn();
    const service = createPostgresPrivacyCaseService({
      $transaction: transaction,
    } as never);

    for (const capabilities of WITHOUT_PROCESS) {
      const deniedActor = actor(capabilities);
      await expect(
        service.completeDeletionAssessment(
          deniedActor,
          {
            ...command("delete"),
            dependencyCodes: ["NONE"],
            outcomeCode: "ASSESSMENT_COMPLETED_NO_ERASURE",
          },
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        service.completeCorrectionOutcome(
          deniedActor,
          {
            ...command("correct"),
            reviewedFieldCodes: ["EMAIL"],
            outcomeCode: "CORRECTED_VIA_CANONICAL_COMMAND",
            domainEventRefs: [EVENT_ID],
          },
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        service.rejectRequest(
          deniedActor,
          {
            ...command("reject"),
            reasonCode: "INSUFFICIENT_INFORMATION",
          },
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
      await expect(
        service.addInternalNote(
          deniedActor,
          {
            ...command("note"),
            note: "Capability-matrix internal note.",
          },
          NOW,
        ),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    }

    expect(transaction).not.toHaveBeenCalled();
  });
});

function actor(
  capabilities: readonly PrivacyCaseAdminCapability[],
): PrivacyCaseAdminActor {
  return Object.freeze({ userId: ADMIN_ID, capabilities });
}

function command(suffix: string) {
  return {
    requestId: REQUEST_ID,
    version: 1,
    idempotencyKey: `capability-matrix-${suffix}`,
  } as const;
}
