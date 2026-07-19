import { describe, expect, it } from "vitest";

import {
  COMPANY_ACTOR_CAPABILITIES,
  COMPANY_STATUSES,
  COMPANY_TRANSITION_ACTIONS,
  decideCompanyTransition,
  type CompanyActorCapability,
  type CompanyStatus,
  type CompanyTransitionAction,
} from "@/lib/policies/status/company";

type ExpectedRule = Readonly<{
  actors: readonly CompanyActorCapability[];
  from: readonly (CompanyStatus | null)[];
  to: CompanyStatus;
}>;

const EXPECTED_RULES: Record<CompanyTransitionAction, ExpectedRule> = {
  CREATE_DRAFT: {
    actors: ["AUTH_REGISTRATION"],
    from: [null],
    to: "DRAFT",
  },
  COMPLETE_ONBOARDING: {
    actors: ["COMPANY_OWNER", "COMPANY_ADMIN"],
    from: ["DRAFT"],
    to: "ACTIVE",
  },
  SUSPEND: {
    actors: ["PLATFORM_COMPANY_MODERATOR"],
    from: ["ACTIVE"],
    to: "SUSPENDED",
  },
  REACTIVATE: {
    actors: ["PLATFORM_COMPANY_MODERATOR"],
    from: ["SUSPENDED"],
    to: "ACTIVE",
  },
  CLOSE: {
    actors: ["PLATFORM_COMPANY_MODERATOR"],
    from: ["SUSPENDED"],
    to: "CLOSED",
  },
};

describe("company transition policy", () => {
  it("exhaustively enforces registration, tenant and platform capabilities", () => {
    const states: readonly (CompanyStatus | null)[] = [
      null,
      ...COMPANY_STATUSES,
    ];

    for (const action of COMPANY_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of COMPANY_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideCompanyTransition({
            action,
            actor,
            currentStatus,
            onboardingComplete: true,
            reasonCode: "MODERATION_REASON",
          });

          if (!expected.actors.includes(actor)) {
            expect(result.type, `${action}/${actor}/${currentStatus}`).toBe(
              "FORBIDDEN",
            );
          } else if (!expected.from.includes(currentStatus)) {
            expect(result.type, `${action}/${actor}/${currentStatus}`).toBe(
              "CONFLICT",
            );
          } else {
            expect(result).toMatchObject({
              type: "OK",
              value: {
                action,
                currentStatus,
                nextStatus: expected.to,
              },
            });
          }
        }
      }
    }
  });

  it("keeps completion tied to the server-derived onboarding predicate", () => {
    expect(
      decideCompanyTransition({
        action: "COMPLETE_ONBOARDING",
        actor: "COMPANY_OWNER",
        currentStatus: "DRAFT",
        onboardingComplete: false,
      }),
    ).toMatchObject({
      type: "VALIDATION",
      reason: "COMPANY_ONBOARDING_INCOMPLETE",
    });
  });

  it.each(["SUSPEND", "REACTIVATE", "CLOSE"] as const)(
    "requires an explicit reason for %s",
    (action) => {
      const currentStatus = action === "SUSPEND" ? "ACTIVE" : "SUSPENDED";
      expect(
        decideCompanyTransition({
          action,
          actor: "PLATFORM_COMPANY_MODERATOR",
          currentStatus,
          reasonCode: " ",
        }),
      ).toMatchObject({
        type: "VALIDATION",
        reason: "COMPANY_REASON_REQUIRED",
      });
    },
  );

  it("keeps CLOSED terminal and rejects unrecorded same-target no-ops", () => {
    for (const action of COMPANY_TRANSITION_ACTIONS) {
      const actor = EXPECTED_RULES[action].actors[0] ?? "COMPANY_OWNER";
      const result = decideCompanyTransition({
        action,
        actor,
        currentStatus: "CLOSED",
        onboardingComplete: true,
        reasonCode: "MODERATION_REASON",
      });
      expect(result.type, action).toBe("CONFLICT");
    }

    expect(
      decideCompanyTransition({
        action: "REACTIVATE",
        actor: "PLATFORM_COMPANY_MODERATOR",
        currentStatus: "ACTIVE",
        reasonCode: "MODERATION_REASON",
      }),
    ).toMatchObject({ type: "CONFLICT" });
  });
});
