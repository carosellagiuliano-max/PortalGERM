import { describe, expect, it } from "vitest";

import {
  INVOICE_ACTOR_CAPABILITIES,
  INVOICE_STATUSES,
  INVOICE_TRANSITION_ACTIONS,
  decideInvoiceTransition,
  type InvoiceActorCapability,
  type InvoiceStatus,
  type InvoiceTransitionAction,
} from "@/lib/policies/status/invoice";

type ExpectedRule = Readonly<{
  actors: readonly InvoiceActorCapability[];
  from: readonly (InvoiceStatus | null)[];
  to: InvoiceStatus;
}>;

const EXPECTED_RULES: Record<InvoiceTransitionAction, ExpectedRule> = {
  CREATE_DRAFT: {
    actors: ["BILLING_FULFILLMENT"],
    from: [null],
    to: "DRAFT",
  },
  ISSUE: {
    actors: ["BILLING_FULFILLMENT", "PLATFORM_BILLING_OPERATOR"],
    from: ["DRAFT"],
    to: "ISSUED",
  },
  MARK_PAID: {
    actors: ["BILLING_FULFILLMENT", "PLATFORM_BILLING_OPERATOR"],
    from: ["ISSUED"],
    to: "PAID",
  },
  VOID: {
    actors: ["PLATFORM_BILLING_OPERATOR"],
    from: ["ISSUED"],
    to: "VOID",
  },
};

describe("invoice transition policy", () => {
  it("exhaustively enforces fulfillment and platform billing capabilities", () => {
    const states: readonly (InvoiceStatus | null)[] = [
      null,
      ...INVOICE_STATUSES,
    ];

    for (const action of INVOICE_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of INVOICE_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideInvoiceTransition({
            action,
            actor,
            currentStatus,
            reasonCode: "VOID_REASON",
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

  it("requires a reason and platform capability to void an invoice", () => {
    expect(
      decideInvoiceTransition({
        action: "VOID",
        actor: "PLATFORM_BILLING_OPERATOR",
        currentStatus: "ISSUED",
        reasonCode: " ",
      }),
    ).toMatchObject({
      type: "VALIDATION",
      reason: "INVOICE_REASON_REQUIRED",
    });
    expect(
      decideInvoiceTransition({
        action: "VOID",
        actor: "BILLING_FULFILLMENT",
        currentStatus: "ISSUED",
        reasonCode: "VOID_REASON",
      }),
    ).toMatchObject({
      type: "FORBIDDEN",
      reason: "INVOICE_CAPABILITY_REQUIRED",
    });
  });

  it("makes exactly-once issue/payment/void retries explicit", () => {
    for (const action of INVOICE_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0] ?? "BILLING_FULFILLMENT";
      const base = {
        action,
        actor,
        currentStatus: expected.to,
        reasonCode: "VOID_REASON",
      } as const;

      expect(decideInvoiceTransition(base).type, action).toBe("CONFLICT");
      expect(
        decideInvoiceTransition({ ...base, replay: true }),
        action,
      ).toMatchObject({
        type: "OK",
        value: { changed: false, idempotent: true },
      });
    }
  });

  it.each(["PAID", "VOID"] as const)(
    "keeps %s terminal and forbids resetting it to DRAFT",
    (currentStatus) => {
      for (const action of INVOICE_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "BILLING_FULFILLMENT";
        expect(
          decideInvoiceTransition({
            action,
            actor,
            currentStatus,
            reasonCode: "VOID_REASON",
          }).type,
          action,
        ).toBe("CONFLICT");
      }
    },
  );
});
