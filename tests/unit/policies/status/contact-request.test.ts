import { describe, expect, it } from "vitest";

import {
  CONTACT_REQUEST_ACTOR_CAPABILITIES,
  CONTACT_REQUEST_CANCELLATION_REASONS,
  CONTACT_REQUEST_STATUSES,
  CONTACT_REQUEST_TRANSITION_ACTIONS,
  decideContactRequestTransition,
  isContactRequestCancellationReason,
  type ContactRequestActorCapability,
  type ContactRequestStatus,
  type ContactRequestTransitionAction,
} from "@/lib/policies/status/contact-request";

type ExpectedRule = Readonly<{
  actors: readonly ContactRequestActorCapability[];
  from: readonly (ContactRequestStatus | null)[];
  replay: boolean;
  to: ContactRequestStatus;
}>;

const EXPECTED_RULES: Record<ContactRequestTransitionAction, ExpectedRule> = {
  CREATE_PENDING: {
    actors: ["COMPANY_CONTACT_REQUESTER"],
    from: [null],
    replay: true,
    to: "PENDING",
  },
  ACCEPT: {
    actors: ["CANDIDATE_OWNER"],
    from: ["PENDING"],
    replay: false,
    to: "ACCEPTED",
  },
  DECLINE: {
    actors: ["CANDIDATE_OWNER"],
    from: ["PENDING"],
    replay: false,
    to: "DECLINED",
  },
  CANCEL_BY_REQUESTING_COMPANY: {
    actors: ["REQUESTING_COMPANY_MEMBER"],
    from: ["PENDING"],
    replay: false,
    to: "CANCELLED",
  },
  CANCEL_FOR_ELIGIBILITY_LOSS: {
    actors: ["SYSTEM_ELIGIBILITY_GUARD"],
    from: ["PENDING"],
    replay: true,
    to: "CANCELLED",
  },
  EXPIRE: {
    actors: ["SYSTEM_EXPIRY_PROJECTOR"],
    from: ["PENDING"],
    replay: true,
    to: "EXPIRED",
  },
};

const createdAt = new Date("2040-01-01T00:00:00.000Z");
const effectiveNow = new Date("2040-01-07T00:00:00.000Z");
const expiresAt = new Date("2040-01-15T00:00:00.000Z");

describe("contact-request transition policy", () => {
  it("narrows only the closed cancellation-reason vocabulary", () => {
    expect(
      CONTACT_REQUEST_CANCELLATION_REASONS.every(
        isContactRequestCancellationReason,
      ),
    ).toBe(true);
    expect(isContactRequestCancellationReason("FREE_TEXT")).toBe(false);
    expect(isContactRequestCancellationReason(undefined)).toBe(false);
  });

  it("exhaustively enforces candidate, requesting-company and system edges", () => {
    const states: readonly (ContactRequestStatus | null)[] = [
      null,
      ...CONTACT_REQUEST_STATUSES,
    ];

    for (const action of CONTACT_REQUEST_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      for (const actor of CONTACT_REQUEST_ACTOR_CAPABILITIES) {
        for (const currentStatus of states) {
          const result = decideContactRequestTransition({
            action,
            actor,
            cancellationReason: "CANDIDATE_OPTED_OUT",
            createdAt,
            currentStatus,
            expiresAt,
            now: action === "EXPIRE" ? expiresAt : effectiveNow,
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

  it.each(CONTACT_REQUEST_CANCELLATION_REASONS)(
    "accepts the closed eligibility-loss reason %s",
    (cancellationReason) => {
      expect(
        decideContactRequestTransition({
          action: "CANCEL_FOR_ELIGIBILITY_LOSS",
          actor: "SYSTEM_ELIGIBILITY_GUARD",
          cancellationReason,
          createdAt,
          currentStatus: "PENDING",
          expiresAt,
          now: effectiveNow,
        }),
      ).toMatchObject({ type: "OK", value: { nextStatus: "CANCELLED" } });
    },
  );

  it.each([undefined, "", "FREE_TEXT"])(
    "rejects an open eligibility-loss reason (%s)",
    (cancellationReason) => {
      expect(
        decideContactRequestTransition({
          action: "CANCEL_FOR_ELIGIBILITY_LOSS",
          actor: "SYSTEM_ELIGIBILITY_GUARD",
          cancellationReason,
          createdAt,
          currentStatus: "PENDING",
          expiresAt,
          now: effectiveNow,
        }),
      ).toMatchObject({
        type: "VALIDATION",
        reason: "CONTACT_REQUEST_CANCELLATION_REASON_INVALID",
      });
    },
  );

  it("uses the exact half-open effective window", () => {
    const beforeCreation = new Date(createdAt.getTime() - 1);

    expect(decideCandidateResponse(createdAt)).toMatchObject({ type: "OK" });
    expect(decideCandidateResponse(beforeCreation)).toMatchObject({
      type: "CONFLICT",
      reason: "CONTACT_REQUEST_NOT_EFFECTIVE",
    });
    expect(decideCandidateResponse(expiresAt)).toMatchObject({
      type: "CONFLICT",
      reason: "CONTACT_REQUEST_NOT_EFFECTIVE",
    });
  });

  it("expires only at or after the exclusive boundary", () => {
    expect(
      decideContactRequestTransition({
        action: "EXPIRE",
        actor: "SYSTEM_EXPIRY_PROJECTOR",
        currentStatus: "PENDING",
        expiresAt,
        now: new Date(expiresAt.getTime() - 1),
      }),
    ).toMatchObject({
      type: "CONFLICT",
      reason: "CONTACT_REQUEST_NOT_EFFECTIVE",
    });
    expect(
      decideContactRequestTransition({
        action: "EXPIRE",
        actor: "SYSTEM_EXPIRY_PROJECTOR",
        currentStatus: "PENDING",
        expiresAt,
        now: expiresAt,
      }),
    ).toMatchObject({ type: "OK", value: { nextStatus: "EXPIRED" } });
  });

  it("allows replays only for creation and the two idempotent system commands", () => {
    for (const action of CONTACT_REQUEST_TRANSITION_ACTIONS) {
      const expected = EXPECTED_RULES[action];
      const actor = expected.actors[0] ?? "CANDIDATE_OWNER";
      const result = decideContactRequestTransition({
        action,
        actor,
        cancellationReason: "CANDIDATE_OPTED_OUT",
        currentStatus: expected.to,
        replay: true,
      });

      if (expected.replay) {
        expect(result, action).toMatchObject({
          type: "OK",
          value: { changed: false, idempotent: true },
        });
      } else {
        expect(result.type, action).toBe("CONFLICT");
      }
    }
  });

  it.each(["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const)(
    "keeps %s terminal for new commands",
    (currentStatus) => {
      for (const action of CONTACT_REQUEST_TRANSITION_ACTIONS) {
        const actor = EXPECTED_RULES[action].actors[0] ?? "CANDIDATE_OWNER";
        const result = decideContactRequestTransition({
          action,
          actor,
          cancellationReason: "CANDIDATE_OPTED_OUT",
          createdAt,
          currentStatus,
          expiresAt,
          now: action === "EXPIRE" ? expiresAt : effectiveNow,
        });
        expect(result.type, action).toBe("CONFLICT");
      }
    },
  );
});

function decideCandidateResponse(now: Date) {
  return decideContactRequestTransition({
    action: "ACCEPT",
    actor: "CANDIDATE_OWNER",
    createdAt,
    currentStatus: "PENDING",
    expiresAt,
    now,
  });
}
