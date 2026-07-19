import { describe, expect, it } from "vitest";

import {
  policyConflict,
  policyForbidden,
  policyLimit,
  policyNotFound,
  policyOk,
  policyRateLimited,
  policyValidation,
  transitionDecision,
} from "@/lib/policies/result";

describe("policy result contract", () => {
  it("returns closed discriminated result variants", () => {
    expect(policyOk({ id: "value" })).toEqual({
      type: "OK",
      value: { id: "value" },
    });
    expect(policyValidation("FIELD_INVALID", ["profile", "name"])).toEqual({
      type: "VALIDATION",
      reason: "FIELD_INVALID",
      issues: [
        {
          code: "FIELD_INVALID",
          path: ["profile", "name"],
        },
      ],
    });
    expect(policyForbidden("ROLE_REQUIRED")).toEqual({
      type: "FORBIDDEN",
      reason: "ROLE_REQUIRED",
    });
    expect(policyNotFound()).toEqual({
      type: "NOT_FOUND",
      reason: "RESOURCE_NOT_FOUND",
    });
    expect(policyConflict("STALE_VERSION")).toEqual({
      type: "CONFLICT",
      reason: "STALE_VERSION",
    });
    expect(
      policyLimit("PLAN_LIMIT", {
        suggestedPlanSlug: "pro",
        suggestedProductSlug: "additional-job-30d",
      }),
    ).toEqual({
      type: "LIMIT",
      reason: "PLAN_LIMIT",
      suggestedPlanSlug: "pro",
      suggestedProductSlug: "additional-job-30d",
    });
    expect(policyRateLimited("TOO_MANY_ATTEMPTS", 42)).toEqual({
      type: "RATE_LIMITED",
      reason: "TOO_MANY_ATTEMPTS",
      retryAfterSeconds: 42,
    });
  });

  it("uses one safe not-found shape without object details", () => {
    const result = policyNotFound();

    expect(Object.keys(result).sort()).toEqual(["reason", "type"]);
    expect(JSON.stringify(result)).not.toContain("company");
    expect(JSON.stringify(result)).not.toContain("candidate");
  });

  it("rejects invalid retry-after values", () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => policyRateLimited("TOO_MANY_ATTEMPTS", value)).toThrow(
        RangeError,
      );
    }
  });

  it("marks transitions and explicit replays without mutating the input", () => {
    const changed = transitionDecision({
      action: "PUBLISH",
      currentStatus: "APPROVED",
      nextStatus: "PUBLISHED",
    });
    const replay = transitionDecision({
      action: "PUBLISH",
      currentStatus: "PUBLISHED",
      nextStatus: "PUBLISHED",
      idempotent: true,
    });

    expect(changed).toMatchObject({ changed: true, idempotent: false });
    expect(replay).toMatchObject({ changed: false, idempotent: true });
    expect(Object.isFrozen(changed)).toBe(true);
    expect(Object.isFrozen(replay)).toBe(true);
  });
});
