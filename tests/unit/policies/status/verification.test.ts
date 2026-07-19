import { describe, expect, it } from "vitest";

import {
  VERIFICATION_ACTOR_CAPABILITIES,
  VERIFICATION_STATUSES,
  VERIFICATION_TRANSITION_ACTIONS,
  decideVerificationTransition,
  type VerificationActorCapability,
  type VerificationStatus,
  type VerificationTransitionAction,
} from "@/lib/policies/status/verification";

type ExpectedRule = Readonly<{
  actors: readonly VerificationActorCapability[];
  from: readonly (VerificationStatus | null)[];
  to: VerificationStatus;
}>;

const companyActors = ["COMPANY_OWNER", "COMPANY_ADMIN"] as const;

const EXPECTED_RULES: Record<VerificationTransitionAction, ExpectedRule> = {
  CREATE_DRAFT: { actors: companyActors, from: [null], to: "DRAFT" },
  SUBMIT: { actors: companyActors, from: ["DRAFT"], to: "PENDING" },
  REQUEST_CHANGES: {
    actors: ["PLATFORM_VERIFICATION_REVIEWER"],
    from: ["PENDING"],
    to: "CHANGES_REQUESTED",
  },
  RESUBMIT: {
    actors: companyActors,
    from: ["CHANGES_REQUESTED"],
    to: "PENDING",
  },
  VERIFY: {
    actors: ["PLATFORM_VERIFICATION_REVIEWER"],
    from: ["PENDING"],
    to: "VERIFIED",
  },
  REJECT: {
    actors: ["PLATFORM_VERIFICATION_REVIEWER"],
    from: ["PENDING"],
    to: "REJECTED",
  },
  REVOKE: {
    actors: ["PLATFORM_VERIFICATION_REVIEWER"],
    from: ["VERIFIED"],
    to: "REVOKED",
  },
};

describe("company verification transition policy", () => {
  it("exhaustively enforces the company/reviewer matrix", () => {
    const states: readonly (VerificationStatus | null)[] = [
      null,
      ...VERIFICATION_STATUSES,
    ];

    for (const action of VERIFICATION_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of VERIFICATION_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideVerificationTransition({
            action,
            actor,
            currentStatus,
            reasonCode: "REVIEW_REASON",
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
                changed: true,
                currentStatus,
                nextStatus: expected.to,
              },
            });
          }
        }
      }
    }
  });

  it.each(["REQUEST_CHANGES", "REJECT", "REVOKE"] as const)(
    "requires a review reason for %s",
    (action) => {
      const currentStatus = action === "REVOKE" ? "VERIFIED" : "PENDING";
      expect(
        decideVerificationTransition({
          action,
          actor: "PLATFORM_VERIFICATION_REVIEWER",
          currentStatus,
          reasonCode: "",
        }),
      ).toMatchObject({
        type: "VALIDATION",
        reason: "VERIFICATION_REASON_REQUIRED",
      });
    },
  );

  it.each(["REJECTED", "REVOKED"] as const)(
    "keeps the closed %s cycle terminal",
    (currentStatus) => {
      for (const action of VERIFICATION_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "COMPANY_OWNER";
        expect(
          decideVerificationTransition({
            action,
            actor,
            currentStatus,
            reasonCode: "REVIEW_REASON",
          }).type,
          action,
        ).toBe("CONFLICT");
      }
    },
  );

  it("does not treat same-target commands as implicit retries", () => {
    expect(
      decideVerificationTransition({
        action: "VERIFY",
        actor: "PLATFORM_VERIFICATION_REVIEWER",
        currentStatus: "VERIFIED",
      }),
    ).toMatchObject({ type: "CONFLICT" });
  });
});
