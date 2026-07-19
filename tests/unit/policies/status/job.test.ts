import { describe, expect, it } from "vitest";

import {
  JOB_ACTOR_CAPABILITIES,
  JOB_STATUSES,
  JOB_TRANSITION_ACTIONS,
  decideJobTransition,
  type JobActorCapability,
  type JobStatus,
  type JobTransitionAction,
} from "@/lib/policies/status/job";

type ExpectedRule = Readonly<{
  actors: readonly JobActorCapability[];
  from: readonly (JobStatus | null)[];
  to: JobStatus;
}>;

const managers = ["COMPANY_OWNER", "COMPANY_ADMIN"] as const;
const editors = [...managers, "RECRUITER_EDITOR"] as const;

const EXPECTED_RULES: Record<JobTransitionAction, ExpectedRule> = {
  CREATE_DRAFT: {
    actors: [...editors, "PLATFORM_IMPORT_OPERATOR"],
    from: [null],
    to: "DRAFT",
  },
  SUBMIT: {
    actors: editors,
    from: ["DRAFT", "CHANGES_REQUESTED"],
    to: "SUBMITTED",
  },
  START_REVIEW: {
    actors: ["PLATFORM_REVIEWER"],
    from: ["SUBMITTED"],
    to: "IN_REVIEW",
  },
  REQUEST_CHANGES: {
    actors: ["PLATFORM_REVIEWER"],
    from: ["IN_REVIEW"],
    to: "CHANGES_REQUESTED",
  },
  APPROVE: {
    actors: ["PLATFORM_REVIEWER"],
    from: ["IN_REVIEW"],
    to: "APPROVED",
  },
  REJECT: {
    actors: ["PLATFORM_REVIEWER"],
    from: ["IN_REVIEW"],
    to: "REJECTED",
  },
  PUBLISH: {
    actors: ["PLATFORM_PUBLISHER"],
    from: ["APPROVED"],
    to: "PUBLISHED",
  },
  PAUSE_UNCHANGED: { actors: managers, from: ["PUBLISHED"], to: "PAUSED" },
  PAUSE_FOR_MATERIAL_EDIT: {
    actors: managers,
    from: ["PUBLISHED"],
    to: "PAUSED",
  },
  REACTIVATE_UNCHANGED: {
    actors: managers,
    from: ["PAUSED"],
    to: "PUBLISHED",
  },
  CREATE_REVISION_FROM_PAUSED: {
    actors: managers,
    from: ["PAUSED"],
    to: "DRAFT",
  },
  CLONE_REJECTED_REVISION: {
    actors: managers,
    from: ["REJECTED"],
    to: "DRAFT",
  },
  CLOSE: {
    actors: managers,
    from: ["PUBLISHED", "PAUSED", "EXPIRED"],
    to: "CLOSED",
  },
  EXPIRE: {
    actors: ["SYSTEM_JOB_LIFECYCLE"],
    from: ["PUBLISHED"],
    to: "EXPIRED",
  },
  ROLLBACK_IMPORT: {
    actors: ["PLATFORM_IMPORT_OPERATOR"],
    from: ["DRAFT"],
    to: "REMOVED",
  },
};

describe("job transition policy", () => {
  it("exhaustively enforces the actor-by-current-state matrix", () => {
    const states: readonly (JobStatus | null)[] = [null, ...JOB_STATUSES];

    for (const action of JOB_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of JOB_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideJobTransition({
            action,
            actor,
            currentStatus,
            reasonCode: "REVIEW_REASON",
          });
          const actorAllowed = expected.actors.includes(actor);
          const stateAllowed = expected.from.includes(currentStatus);

          if (!actorAllowed) {
            expect(result.type, `${action}/${actor}/${currentStatus}`).toBe(
              "FORBIDDEN",
            );
          } else if (!stateAllowed) {
            expect(result.type, `${action}/${actor}/${currentStatus}`).toBe(
              "CONFLICT",
            );
          } else {
            expect(result, `${action}/${actor}/${currentStatus}`).toMatchObject({
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

  it.each(["REQUEST_CHANGES", "REJECT"] as const)(
    "requires a bounded domain reason for %s",
    (action) => {
      const result = decideJobTransition({
        action,
        actor: "PLATFORM_REVIEWER",
        currentStatus: "IN_REVIEW",
        reasonCode: "   ",
      });

      expect(result).toMatchObject({
        type: "VALIDATION",
        reason: "JOB_REASON_REQUIRED",
      });
    },
  );

  it("permits only the rejected-revision clone as an in-machine replay", () => {
    for (const action of JOB_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0];
      expect(actor).toBeDefined();

      const result = decideJobTransition({
        action,
        actor: actor ?? "COMPANY_OWNER",
        currentStatus: expected.to,
        reasonCode: "REVIEW_REASON",
        replay: true,
      });

      if (action === "CLONE_REJECTED_REVISION") {
        expect(result).toMatchObject({
          type: "OK",
          value: { changed: false, idempotent: true, nextStatus: "DRAFT" },
        });
      } else {
        expect(result.type, action).toBe("CONFLICT");
      }
    }
  });

  it.each(["CLOSED", "REMOVED"] as const)(
    "keeps %s terminal",
    (currentStatus) => {
      for (const action of JOB_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "COMPANY_OWNER";
        const result = decideJobTransition({
          action,
          actor,
          currentStatus,
          reasonCode: "REVIEW_REASON",
        });

        expect(result.type, action).toBe("CONFLICT");
      }
    },
  );
});
