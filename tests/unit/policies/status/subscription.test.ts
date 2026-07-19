import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_ACTOR_CAPABILITIES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TRANSITION_ACTIONS,
  decideSubscriptionTransition,
  type SubscriptionActorCapability,
  type SubscriptionStatus,
  type SubscriptionTransitionAction,
} from "@/lib/policies/status/subscription";

type ExpectedRule = Readonly<{
  actors: readonly SubscriptionActorCapability[];
  boundary: boolean;
  from: readonly (SubscriptionStatus | null)[];
  to: SubscriptionStatus;
}>;

const EXPECTED_RULES: Record<SubscriptionTransitionAction, ExpectedRule> = {
  CREATE_ACTIVE: {
    actors: ["BILLING_FULFILLMENT"],
    boundary: false,
    from: [null],
    to: "ACTIVE",
  },
  CREATE_SCHEDULED: {
    actors: ["BILLING_FULFILLMENT"],
    boundary: false,
    from: [null],
    to: "SCHEDULED",
  },
  ACTIVATE_SCHEDULED: {
    actors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    boundary: true,
    from: ["SCHEDULED"],
    to: "ACTIVE",
  },
  SCHEDULE_CANCELLATION: {
    actors: ["COMPANY_OWNER", "PLATFORM_BILLING_OPERATOR"],
    boundary: false,
    from: ["ACTIVE"],
    to: "CANCELLING",
  },
  APPLY_CANCELLATION: {
    actors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    boundary: true,
    from: ["CANCELLING"],
    to: "CANCELLED",
  },
  EXPIRE_NATURALLY: {
    actors: ["SYSTEM_SUBSCRIPTION_PROJECTOR"],
    boundary: true,
    from: ["ACTIVE"],
    to: "EXPIRED",
  },
  EXPIRE_REPLACED: {
    actors: ["BILLING_FULFILLMENT", "SYSTEM_SUBSCRIPTION_PROJECTOR"],
    boundary: false,
    from: ["ACTIVE"],
    to: "EXPIRED",
  },
};

const boundaryAt = new Date("2040-02-01T00:00:00.000Z");

describe("subscription transition policy", () => {
  it("exhaustively enforces fulfillment, owner and projector edges", () => {
    const states: readonly (SubscriptionStatus | null)[] = [
      null,
      ...SUBSCRIPTION_STATUSES,
    ];

    for (const action of SUBSCRIPTION_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of SUBSCRIPTION_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideSubscriptionTransition({
            action,
            actor,
            at: boundaryAt,
            boundaryAt,
            currentStatus,
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

  it.each([
    ["ACTIVATE_SCHEDULED", "SCHEDULED"],
    ["APPLY_CANCELLATION", "CANCELLING"],
    ["EXPIRE_NATURALLY", "ACTIVE"],
  ] as const)("enforces the exact boundary for %s", (action, currentStatus) => {
    const actor = "SYSTEM_SUBSCRIPTION_PROJECTOR" as const;
    expect(
      decideSubscriptionTransition({
        action,
        actor,
        at: new Date(boundaryAt.getTime() - 1),
        boundaryAt,
        currentStatus,
      }),
    ).toMatchObject({
      type: "CONFLICT",
      reason: "SUBSCRIPTION_BOUNDARY_NOT_REACHED",
    });
    expect(
      decideSubscriptionTransition({
        action,
        actor,
        at: boundaryAt,
        boundaryAt,
        currentStatus,
      }),
    ).toMatchObject({ type: "OK" });
    expect(
      decideSubscriptionTransition({
        action,
        actor,
        at: new Date(boundaryAt.getTime() + 1),
        boundaryAt,
        currentStatus,
      }),
    ).toMatchObject({ type: "OK" });
  });

  it("fails closed when a projector lacks its injected boundary context", () => {
    expect(
      decideSubscriptionTransition({
        action: "APPLY_CANCELLATION",
        actor: "SYSTEM_SUBSCRIPTION_PROJECTOR",
        currentStatus: "CANCELLING",
      }),
    ).toMatchObject({
      type: "VALIDATION",
      reason: "SUBSCRIPTION_BOUNDARY_CONTEXT_INVALID",
    });
  });

  it("does not collapse cancellation, natural expiry and replacement", () => {
    expect(
      decideSubscriptionTransition({
        action: "APPLY_CANCELLATION",
        actor: "SYSTEM_SUBSCRIPTION_PROJECTOR",
        at: boundaryAt,
        boundaryAt,
        currentStatus: "ACTIVE",
      }),
    ).toMatchObject({ type: "CONFLICT" });
    expect(
      decideSubscriptionTransition({
        action: "EXPIRE_NATURALLY",
        actor: "SYSTEM_SUBSCRIPTION_PROJECTOR",
        at: boundaryAt,
        boundaryAt,
        currentStatus: "CANCELLING",
      }),
    ).toMatchObject({ type: "CONFLICT" });
  });

  it("makes exactly-once fulfillment and projector retries explicit", () => {
    for (const action of SUBSCRIPTION_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0] ?? "BILLING_FULFILLMENT";
      const base = { action, actor, currentStatus: expected.to } as const;

      expect(decideSubscriptionTransition(base).type, action).toBe("CONFLICT");
      expect(
        decideSubscriptionTransition({ ...base, replay: true }),
        action,
      ).toMatchObject({
        type: "OK",
        value: { changed: false, idempotent: true },
      });
    }
  });

  it.each(["EXPIRED", "CANCELLED"] as const)(
    "keeps %s terminal for new commands",
    (currentStatus) => {
      for (const action of SUBSCRIPTION_TRANSITION_ACTIONS) {
        const actor =
          EXPECTED_RULES[action].actors[0] ?? "BILLING_FULFILLMENT";
        const result = decideSubscriptionTransition({
          action,
          actor,
          at: boundaryAt,
          boundaryAt,
          currentStatus,
        });
        expect(result.type, action).toBe("CONFLICT");
      }
    },
  );
});
