"use client";

import { useActionState } from "react";

import { confirmMockPaymentAction } from "@/app/mock/checkout/[orderId]/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";

export function MockPaymentForm({
  orderId,
  idempotencyKey,
}: Readonly<{ orderId: string; idempotencyKey: string }>) {
  const [state, action, pending] = useActionState(
    confirmMockPaymentAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <EmployerActionFeedback state={state} />
      <EmployerSubmitButton
        pending={pending}
        label="Mock bezahlen"
        pendingLabel="Zahlung wird verbucht …"
      />
    </form>
  );
}
