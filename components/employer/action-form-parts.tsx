"use client";

import { Button } from "@/components/ui/button";
import type { EmployerActionState } from "@/lib/employer/action-state";

export function EmployerActionFeedback({ state }: Readonly<{ state: EmployerActionState }>) {
  if (state.status === "idle" || state.message === undefined) return null;
  return (
    <p
      role={state.status === "error" || state.status === "conflict" ? "alert" : "status"}
      className={state.status === "success" ? "text-sm text-emerald-700" : "text-sm text-destructive"}
    >
      {state.message}
    </p>
  );
}

export function EmployerSubmitButton({
  pending,
  label,
  pendingLabel = "Wird gespeichert …",
  variant = "default",
  disabled = false,
}: Readonly<{
  pending: boolean;
  label: string;
  pendingLabel?: string;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link";
  disabled?: boolean;
}>) {
  return <Button type="submit" disabled={pending || disabled} variant={variant}>{pending ? pendingLabel : label}</Button>;
}
