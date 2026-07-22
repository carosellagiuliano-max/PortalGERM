"use client";

import { useActionState } from "react";

import { startBillingCheckoutAction } from "@/app/employer/billing/checkout/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";

export function CheckoutSubmitForm({
  kind,
  slug,
  quantity,
  idempotencyKey,
  retentionOptions = [],
  targetJobId = null,
  importSetupApprovalId = null,
}: Readonly<{
  kind: "PLAN" | "PRODUCT";
  slug: string;
  quantity: number;
  idempotencyKey: string;
  retentionOptions?: readonly Readonly<{
    membershipId: string;
    label: string;
    role: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
    selectedByDefault: boolean;
  }>[];
  targetJobId?: string | null;
  importSetupApprovalId?: string | null;
}>) {
  const [state, action, pending] = useActionState(
    startBillingCheckoutAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="quantity" value={quantity} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {targetJobId === null ? null : (
        <input type="hidden" name="targetJobId" value={targetJobId} />
      )}
      {importSetupApprovalId === null ? null : (
        <input
          type="hidden"
          name="importSetupApprovalId"
          value={importSetupApprovalId}
        />
      )}
      {retentionOptions.length === 0 ? null : (
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <input type="hidden" name="retentionRequired" value="yes" />
          <legend className="px-1 text-sm font-semibold">
            Team nach dem Downgrade beibehalten
          </legend>
          <p className="text-xs leading-5 text-muted-foreground">
            Wähle höchstens so viele Personen wie der Zielplan erlaubt. Mindestens
            eine aktive Owner-Mitgliedschaft muss erhalten bleiben.
          </p>
          {retentionOptions.map((membership) => (
            <label key={membership.membershipId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="retainedMembershipIds"
                value={membership.membershipId}
                defaultChecked={membership.selectedByDefault}
                className="size-4 accent-primary"
              />
              <span>{membership.label} · {membership.role}</span>
            </label>
          ))}
        </fieldset>
      )}
      <EmployerActionFeedback state={state} />
      <EmployerSubmitButton
        pending={pending}
        label="Zum sicheren Mock-Checkout"
        pendingLabel="Bestellung wird erstellt …"
      />
    </form>
  );
}
