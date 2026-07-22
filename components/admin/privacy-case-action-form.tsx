"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  adminPrivacyCaseAction,
  INITIAL_ADMIN_PRIVACY_CASE_ACTION_STATE,
} from "@/app/admin/privacy-requests/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PrivacyCaseActionForm({
  operation,
  requestId,
  version,
  idempotencyKey,
  label,
  destructive = false,
  children,
  className,
}: Readonly<{
  operation: string;
  requestId: string;
  version: number;
  idempotencyKey: string;
  label: string;
  destructive?: boolean;
  children?: React.ReactNode;
  className?: string;
}>) {
  const [state, action] = useActionState(
    adminPrivacyCaseAction,
    INITIAL_ADMIN_PRIVACY_CASE_ACTION_STATE,
  );
  return (
    <form action={action} className={cn("grid gap-3 rounded-lg border bg-card p-3", className)}>
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {children}
      <PrivacyCaseSubmitButton label={label} destructive={destructive} />
      {state.status === "idle" ? null : (
        <p
          aria-live="polite"
          className={
            state.status === "error"
              ? "text-xs text-destructive"
              : "text-xs text-emerald-700"
          }
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

function PrivacyCaseSubmitButton({
  label,
  destructive,
}: Readonly<{ label: string; destructive: boolean }>) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={destructive ? "destructive" : "default"}
      disabled={pending}
    >
      {pending ? "Wird verarbeitet …" : label}
    </Button>
  );
}
