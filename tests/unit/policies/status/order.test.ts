import { describe, expect, it } from "vitest";

import {
  ORDER_ACTOR_CAPABILITIES,
  ORDER_STATUSES,
  ORDER_TRANSITION_ACTIONS,
  decideOrderTransition,
  type OrderActorCapability,
  type OrderStatus,
  type OrderTransitionAction,
} from "@/lib/policies/status/order";

type ExpectedRule = Readonly<{
  actors: readonly OrderActorCapability[];
  from: readonly (OrderStatus | null)[];
  to: OrderStatus;
}>;

const paymentConfirmers = [
  "PAYMENT_PROCESSOR",
  "PLATFORM_BILLING_OPERATOR",
] as const;

const EXPECTED_RULES: Record<OrderTransitionAction, ExpectedRule> = {
  CREATE_DRAFT: {
    actors: ["AUTHORIZED_CHECKOUT"],
    from: [null],
    to: "DRAFT",
  },
  OPEN_CHECKOUT: {
    actors: ["AUTHORIZED_CHECKOUT"],
    from: ["DRAFT"],
    to: "PENDING",
  },
  CONFIRM_PAID: {
    actors: paymentConfirmers,
    from: ["PENDING"],
    to: "PAID",
  },
  CONFIRM_FAILED: {
    actors: paymentConfirmers,
    from: ["PENDING"],
    to: "FAILED",
  },
  CANCEL: {
    actors: ["AUTHORIZED_CHECKOUT", ...paymentConfirmers],
    from: ["PENDING"],
    to: "CANCELLED",
  },
  EXPIRE: {
    actors: ["SYSTEM_ORDER_LIFECYCLE"],
    from: ["PENDING"],
    to: "EXPIRED",
  },
};

describe("order transition policy", () => {
  it("exhaustively enforces checkout, payment and lifecycle capabilities", () => {
    const states: readonly (OrderStatus | null)[] = [null, ...ORDER_STATUSES];

    for (const action of ORDER_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of ORDER_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideOrderTransition({
            action,
            actor,
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

  it("makes same-target billing retries explicit and event-free", () => {
    for (const action of ORDER_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0] ?? "AUTHORIZED_CHECKOUT";
      const base = { action, actor, currentStatus: expected.to } as const;

      expect(decideOrderTransition(base).type, action).toBe("CONFLICT");
      expect(decideOrderTransition({ ...base, replay: true }), action).toMatchObject(
        {
          type: "OK",
          value: { changed: false, idempotent: true },
        },
      );
    }
  });

  it.each(["PAID", "FAILED", "CANCELLED", "EXPIRED"] as const)(
    "keeps %s terminal for a new command",
    (currentStatus) => {
      for (const action of ORDER_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "AUTHORIZED_CHECKOUT";
        expect(
          decideOrderTransition({ action, actor, currentStatus }).type,
          action,
        ).toBe("CONFLICT");
      }
    },
  );

  it("checks capability before accepting a payment replay", () => {
    expect(
      decideOrderTransition({
        action: "CONFIRM_PAID",
        actor: "AUTHORIZED_CHECKOUT",
        currentStatus: "PAID",
        replay: true,
      }),
    ).toMatchObject({
      type: "FORBIDDEN",
      reason: "ORDER_CAPABILITY_REQUIRED",
    });
  });
});
