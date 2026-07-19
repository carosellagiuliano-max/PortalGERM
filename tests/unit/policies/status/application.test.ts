import { describe, expect, it } from "vitest";

import {
  APPLICATION_ACTOR_CAPABILITIES,
  APPLICATION_REJECTION_REASONS,
  APPLICATION_STATUSES,
  APPLICATION_TRANSITION_ACTIONS,
  decideApplicationTransition,
  isApplicationRejectionReason,
  type ApplicationActorCapability,
  type ApplicationStatus,
  type ApplicationTransitionAction,
} from "@/lib/policies/status/application";

type ExpectedRule = Readonly<{
  actors: readonly ApplicationActorCapability[];
  from: readonly (ApplicationStatus | null)[];
  to: ApplicationStatus;
}>;

const pipelineActors = [
  "COMPANY_OWNER_PIPELINE",
  "COMPANY_ADMIN_PIPELINE",
  "RECRUITER_EDITOR_PIPELINE",
  "RECRUITER_PIPELINE",
] as const;

const EXPECTED_RULES: Record<ApplicationTransitionAction, ExpectedRule> = {
  CREATE_SUBMISSION: {
    actors: ["CANDIDATE_OWNER"],
    from: [null],
    to: "SUBMITTED",
  },
  WITHDRAW: {
    actors: ["CANDIDATE_OWNER"],
    from: ["SUBMITTED", "IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER"],
    to: "WITHDRAWN",
  },
  START_REVIEW: {
    actors: pipelineActors,
    from: ["SUBMITTED"],
    to: "IN_REVIEW",
  },
  SHORTLIST: {
    actors: pipelineActors,
    from: ["IN_REVIEW"],
    to: "SHORTLISTED",
  },
  SCHEDULE_INTERVIEW: {
    actors: pipelineActors,
    from: ["SHORTLISTED"],
    to: "INTERVIEW",
  },
  MAKE_OFFER: {
    actors: pipelineActors,
    from: ["INTERVIEW"],
    to: "OFFER",
  },
  HIRE: { actors: pipelineActors, from: ["OFFER"], to: "HIRED" },
  REJECT: {
    actors: pipelineActors,
    from: ["IN_REVIEW", "SHORTLISTED", "INTERVIEW", "OFFER"],
    to: "REJECTED",
  },
};

describe("application transition policy", () => {
  it("narrows only the closed rejection-reason vocabulary", () => {
    expect(
      APPLICATION_REJECTION_REASONS.every(isApplicationRejectionReason),
    ).toBe(true);
    expect(isApplicationRejectionReason("FREE_TEXT")).toBe(false);
    expect(isApplicationRejectionReason(undefined)).toBe(false);
  });

  it("exhaustively enforces every actor-by-current-state edge", () => {
    const states: readonly (ApplicationStatus | null)[] = [
      null,
      ...APPLICATION_STATUSES,
    ];

    for (const action of APPLICATION_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of APPLICATION_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideApplicationTransition({
            action,
            actor,
            currentStatus,
            rejectionReason: "NOT_A_MATCH",
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
                idempotent: false,
                nextStatus: expected.to,
              },
            });
          }
        }
      }
    }
  });

  it.each(APPLICATION_REJECTION_REASONS)(
    "accepts the closed rejection reason %s",
    (rejectionReason) => {
      expect(
        decideApplicationTransition({
          action: "REJECT",
          actor: "COMPANY_OWNER_PIPELINE",
          currentStatus: "IN_REVIEW",
          rejectionReason,
        }),
      ).toMatchObject({ type: "OK", value: { nextStatus: "REJECTED" } });
    },
  );

  it.each([undefined, "", "UNREVIEWED_FREE_TEXT"])(
    "rejects a missing or open rejection reason (%s)",
    (rejectionReason) => {
      expect(
        decideApplicationTransition({
          action: "REJECT",
          actor: "COMPANY_OWNER_PIPELINE",
          currentStatus: "IN_REVIEW",
          rejectionReason,
        }),
      ).toMatchObject({
        type: "VALIDATION",
        reason: "APPLICATION_REJECTION_REASON_INVALID",
      });
    },
  );

  it("accepts same-target retries only when explicitly marked as replays", () => {
    for (const action of APPLICATION_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0] ?? "CANDIDATE_OWNER";
      const base = {
        action,
        actor,
        currentStatus: expected.to,
        rejectionReason: "NOT_A_MATCH",
      } as const;

      expect(decideApplicationTransition(base).type, action).toBe("CONFLICT");
      expect(
        decideApplicationTransition({ ...base, replay: true }),
        action,
      ).toMatchObject({
        type: "OK",
        value: { changed: false, idempotent: true },
      });
    }
  });

  it.each(["HIRED", "REJECTED", "WITHDRAWN"] as const)(
    "keeps %s terminal for new commands",
    (currentStatus) => {
      for (const action of APPLICATION_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "CANDIDATE_OWNER";
        expect(
          decideApplicationTransition({
            action,
            actor,
            currentStatus,
            rejectionReason: "NOT_A_MATCH",
          }).type,
          action,
        ).toBe("CONFLICT");
      }
    },
  );

  it("still checks the actor capability on an idempotent replay", () => {
    expect(
      decideApplicationTransition({
        action: "HIRE",
        actor: "CANDIDATE_OWNER",
        currentStatus: "HIRED",
        replay: true,
      }),
    ).toMatchObject({
      type: "FORBIDDEN",
      reason: "APPLICATION_CAPABILITY_REQUIRED",
    });
  });
});
