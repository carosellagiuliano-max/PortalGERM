import { describe, expect, it } from "vitest";

import {
  CANDIDATE_ONBOARDING_ACTOR_CAPABILITIES,
  CANDIDATE_ONBOARDING_STATUSES,
  CANDIDATE_ONBOARDING_TRANSITION_ACTIONS,
  decideCandidateOnboardingTransition,
  type CandidateOnboardingActorCapability,
  type CandidateOnboardingStatus,
  type CandidateOnboardingTransitionAction,
} from "@/lib/policies/status/candidate-onboarding";

type ExpectedRule = Readonly<{
  actor: CandidateOnboardingActorCapability;
  from: CandidateOnboardingStatus | null;
  requirementsComplete?: boolean;
  to: CandidateOnboardingStatus;
}>;

const EXPECTED_RULES: Record<
  CandidateOnboardingTransitionAction,
  ExpectedRule
> = {
  CREATE_DRAFT: {
    actor: "AUTH_REGISTRATION",
    from: null,
    to: "DRAFT",
  },
  COMPLETE: {
    actor: "CANDIDATE_OWNER",
    from: "DRAFT",
    requirementsComplete: true,
    to: "COMPLETE",
  },
  REOPEN_AFTER_REQUIRED_DATA_REMOVAL: {
    actor: "CANDIDATE_OWNER",
    from: "COMPLETE",
    requirementsComplete: false,
    to: "DRAFT",
  },
};

describe("candidate onboarding transition policy", () => {
  it("exhaustively binds each edge to its actor and current state", () => {
    const states: readonly (CandidateOnboardingStatus | null)[] = [
      null,
      ...CANDIDATE_ONBOARDING_STATUSES,
    ];

    for (const action of CANDIDATE_ONBOARDING_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of CANDIDATE_ONBOARDING_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideCandidateOnboardingTransition({
            action,
            actor,
            currentStatus,
            onboardingRequirementsComplete: expected.requirementsComplete,
          });

          if (actor !== expected.actor) {
            expect(result.type, `${action}/${actor}/${currentStatus}`).toBe(
              "FORBIDDEN",
            );
          } else if (currentStatus !== expected.from) {
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

  it("rejects completion until every server-derived requirement is present", () => {
    expect(
      decideCandidateOnboardingTransition({
        action: "COMPLETE",
        actor: "CANDIDATE_OWNER",
        currentStatus: "DRAFT",
        onboardingRequirementsComplete: false,
      }),
    ).toMatchObject({
      type: "VALIDATION",
      reason: "CANDIDATE_ONBOARDING_REQUIREMENTS_INCOMPLETE",
    });
  });

  it("reopens only after a required value is actually absent", () => {
    expect(
      decideCandidateOnboardingTransition({
        action: "REOPEN_AFTER_REQUIRED_DATA_REMOVAL",
        actor: "CANDIDATE_OWNER",
        currentStatus: "COMPLETE",
        onboardingRequirementsComplete: true,
      }),
    ).toMatchObject({
      type: "VALIDATION",
      reason: "CANDIDATE_ONBOARDING_REQUIREMENTS_STILL_COMPLETE",
    });
  });

  it("does not treat repeated complete/reopen calls as status no-ops", () => {
    expect(
      decideCandidateOnboardingTransition({
        action: "COMPLETE",
        actor: "CANDIDATE_OWNER",
        currentStatus: "COMPLETE",
        onboardingRequirementsComplete: true,
      }),
    ).toMatchObject({ type: "CONFLICT" });
    expect(
      decideCandidateOnboardingTransition({
        action: "REOPEN_AFTER_REQUIRED_DATA_REMOVAL",
        actor: "CANDIDATE_OWNER",
        currentStatus: "DRAFT",
        onboardingRequirementsComplete: false,
      }),
    ).toMatchObject({ type: "CONFLICT" });
  });
});
