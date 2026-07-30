import { describe, expect, it } from "vitest";

import { evaluatePaidServiceRecoveryRelease } from "@/lib/commercial/paid-service-recovery-policy";

describe("Phase 31 paid-service recovery release", () => {
  it("requires public copy, owner, SLA, idempotency and finance reconciliation", () => {
    expect(
      evaluatePaidServiceRecoveryRelease({
        customerCopyPublished: true,
        escalationOwnerAssigned: true,
        idempotencyTestPassed: true,
        remedies: ["RETRY", "EXTENSION", "CREDIT", "REFUND"],
        responseSlaMinutes: 240,
        reversalReconciliationTestPassed: true,
        supportCapacityReserved: true,
      }),
    ).toMatchObject({ allowed: true, missing: [] });
  });

  it("blocks sales when refund/reversal recovery is not operational", () => {
    expect(
      evaluatePaidServiceRecoveryRelease({
        customerCopyPublished: false,
        escalationOwnerAssigned: false,
        idempotencyTestPassed: false,
        remedies: ["RETRY"],
        responseSlaMinutes: 0,
        reversalReconciliationTestPassed: false,
        supportCapacityReserved: false,
      }).missing,
    ).toEqual(
      expect.arrayContaining([
        "CUSTOMER_RECOVERY_COPY",
        "ESCALATION_OWNER",
        "IDEMPOTENT_REMEDY",
        "REFUND_REVERSAL_RECONCILIATION",
        "SUPPORT_CAPACITY",
        "RESPONSE_SLA",
        "MINIMUM_REMEDY_SET",
      ]),
    );
  });
});
