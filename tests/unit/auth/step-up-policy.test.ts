import { describe, expect, it } from "vitest";

import {
  resolveStepUpPolicy,
  STEP_UP_POLICIES_V1,
  STEP_UP_POLICY_VERSION,
} from "@/lib/auth/assurance/step-up-policy";

describe("Phase 25 action-bound step-up policy", () => {
  it("has unique closed policy codes with short AAL2 grants", () => {
    expect(new Set(STEP_UP_POLICIES_V1.map(({ code }) => code)).size).toBe(
      STEP_UP_POLICIES_V1.length,
    );
    for (const policy of STEP_UP_POLICIES_V1) {
      expect(policy.policyVersion).toBe(STEP_UP_POLICY_VERSION);
      expect(policy.requiredLevel).toBe("AAL2");
      expect(policy.grantTtlMilliseconds).toBeLessThanOrEqual(5 * 60_000);
    }
  });

  it("allows the exact owner checkout binding", () => {
    const decision = resolveStepUpPolicy({
      actorRole: "EMPLOYER",
      purpose: "EMPLOYER_BILLING",
      action: "BILLING_CHECKOUT_CREATE",
      tenantId: crypto.randomUUID(),
      resourceId: "checkout-idempotency-key",
    });
    expect(decision.allowed).toBe(true);
  });

  it("binds notification outcome reconciliation to one resolution and outbox", () => {
    const resourceId = crypto.randomUUID();
    expect(
      resolveStepUpPolicy({
        actorRole: "ADMIN",
        purpose: "NOTIFICATION_RECONCILIATION",
        action: "NOTIFICATION_OUTCOME_RECONCILE:ACCEPTED",
        resourceId,
      }).allowed,
    ).toBe(true);
    expect(
      resolveStepUpPolicy({
        actorRole: "ADMIN",
        purpose: "NOTIFICATION_RECONCILIATION",
        action: "NOTIFICATION_OUTCOME_RECONCILE:UNKNOWN",
      }),
    ).toEqual({ allowed: false, reason: "RESOURCE_REQUIRED" });
    expect(
      resolveStepUpPolicy({
        actorRole: "ADMIN",
        purpose: "NOTIFICATION_RECONCILIATION",
        action: "NOTIFICATION_OUTCOME_RECONCILE:ACCEPTED",
        resourceId,
        tenantId: crypto.randomUUID(),
      }),
    ).toEqual({ allowed: false, reason: "TENANT_FORBIDDEN" });
    expect(
      resolveStepUpPolicy({
        actorRole: "EMPLOYER",
        purpose: "NOTIFICATION_RECONCILIATION",
        action: "NOTIFICATION_OUTCOME_RECONCILE:ACCEPTED",
        resourceId,
      }),
    ).toEqual({ allowed: false, reason: "ROLE_FORBIDDEN" });
  });

  it("binds persona creation to the exact identity or invitation scope", () => {
    const identityId = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const invitationId = crypto.randomUUID();
    expect(
      resolveStepUpPolicy({
        actorRole: "EMPLOYER",
        purpose: "IDENTITY_PERSONA",
        action: "PERSONA_CANDIDATE_CREATE",
        resourceId: identityId,
      }).allowed,
    ).toBe(true);
    expect(
      resolveStepUpPolicy({
        actorRole: "CANDIDATE",
        purpose: "IDENTITY_PERSONA",
        action: "PERSONA_EMPLOYER_CREATE",
        tenantId: companyId,
        resourceId: invitationId,
      }).allowed,
    ).toBe(true);
    expect(
      resolveStepUpPolicy({
        actorRole: "CANDIDATE",
        purpose: "IDENTITY_PERSONA",
        action: "PERSONA_EMPLOYER_CREATE",
        resourceId: invitationId,
      }),
    ).toEqual({ allowed: false, reason: "TENANT_REQUIRED" });
    expect(
      resolveStepUpPolicy({
        actorRole: "EMPLOYER",
        purpose: "IDENTITY_PERSONA",
        action: "PERSONA_CANDIDATE_CREATE",
        tenantId: companyId,
        resourceId: identityId,
      }),
    ).toEqual({ allowed: false, reason: "TENANT_FORBIDDEN" });
  });

  it.each([
    [
      "unknown action",
      {
        actorRole: "EMPLOYER",
        purpose: "EMPLOYER_BILLING",
        action: "BILLING_ARBITRARY",
        tenantId: crypto.randomUUID(),
        resourceId: "resource",
      },
      "UNKNOWN_ACTION",
    ],
    [
      "wrong role",
      {
        actorRole: "CANDIDATE",
        purpose: "EMPLOYER_TEAM",
        action: "TEAM_INVITE",
        tenantId: crypto.randomUUID(),
        resourceId: "resource",
      },
      "ROLE_FORBIDDEN",
    ],
    [
      "missing tenant",
      {
        actorRole: "EMPLOYER",
        purpose: "EMPLOYER_TEAM",
        action: "TEAM_INVITE",
        resourceId: "resource",
      },
      "TENANT_REQUIRED",
    ],
    [
      "cross-domain tenant on candidate privacy",
      {
        actorRole: "CANDIDATE",
        purpose: "CANDIDATE_PRIVACY",
        action: "PRIVACY_EXPORT",
        tenantId: crypto.randomUUID(),
        resourceId: "resource",
      },
      "TENANT_FORBIDDEN",
    ],
    [
      "missing resource",
      {
        actorRole: "CANDIDATE",
        purpose: "ACCOUNT_SECURITY",
        action: "LOGIN_EMAIL_CHANGE",
      },
      "RESOURCE_REQUIRED",
    ],
  ] as const)("denies %s fail closed", (_label, input, expectedReason) => {
    expect(resolveStepUpPolicy(input)).toEqual({
      allowed: false,
      reason: expectedReason,
    });
  });
});
