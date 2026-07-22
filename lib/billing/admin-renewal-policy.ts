import { addZurichCalendarMonthsClampedV1 } from "@/lib/billing/billing-policy-v1";

export type AdminMockRenewalPeriodDecision = Readonly<
  | {
      ok: true;
      value: Readonly<{ periodStart: Date; periodEnd: Date }>;
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "NOT_DUE" | "RENEWAL_WINDOW_ELAPSED";
    }
>;

/**
 * ADR-004 manual renewals are deliberately a due-only projection. The next
 * half-open term starts at the persisted predecessor boundary, never at the
 * time an Admin happens to run the command.
 */
export function deriveAdminMockRenewalPeriodV1(
  input: Readonly<{
    currentPeriodEnd: Date;
    termMonthsSnapshot: number;
    now: Date;
  }>,
): AdminMockRenewalPeriodDecision {
  if (
    !isValidDate(input.currentPeriodEnd) ||
    !isValidDate(input.now) ||
    !Number.isSafeInteger(input.termMonthsSnapshot) ||
    input.termMonthsSnapshot < 1
  ) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  if (input.currentPeriodEnd.getTime() > input.now.getTime()) {
    return Object.freeze({ ok: false, code: "NOT_DUE" });
  }
  const nextBoundary = addZurichCalendarMonthsClampedV1(
    input.currentPeriodEnd,
    input.termMonthsSnapshot,
  );
  if (!nextBoundary.ok) {
    return Object.freeze({ ok: false, code: "INVALID_INPUT" });
  }
  if (input.now.getTime() >= nextBoundary.value.getTime()) {
    return Object.freeze({ ok: false, code: "RENEWAL_WINDOW_ELAPSED" });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      periodStart: new Date(input.currentPeriodEnd),
      periodEnd: new Date(nextBoundary.value),
    }),
  });
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
