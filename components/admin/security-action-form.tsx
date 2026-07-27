"use client";

import { useActionState } from "react";

import {
  INITIAL_ADMIN_SECURITY_ACTION_STATE,
  type AdminSecurityActionState,
} from "@/app/admin/security/action-state";
import { adminSecurityAction } from "@/app/admin/security/actions";

export function SecurityActionForm({
  children,
  className,
}: Readonly<{
  children: React.ReactNode;
  className?: string;
}>) {
  const [state, action, pending] = useActionState<
    AdminSecurityActionState,
    FormData
  >(adminSecurityAction, INITIAL_ADMIN_SECURITY_ACTION_STATE);
  return (
    <form action={action} className={className}>
      <fieldset className="contents" disabled={pending}>
        {children}
      </fieldset>
      {state.status !== "idle" ? (
        <p
          className={
            state.status === "error"
              ? "mt-3 text-sm text-destructive"
              : "mt-3 text-sm text-emerald-700 dark:text-emerald-300"
          }
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
