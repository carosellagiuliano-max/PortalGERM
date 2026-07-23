"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { INITIAL_ADMIN_ACTION_STATE } from "@/app/admin/action-state";
import { adminCommandAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminActionForm({ operation, hidden, label, destructive = false, children, className }: Readonly<{ operation: string; hidden?: Readonly<Record<string, string | number | boolean | null | undefined>>; label: string; destructive?: boolean; children?: React.ReactNode; className?: string }>) {
  const [state, action] = useActionState(adminCommandAction, INITIAL_ADMIN_ACTION_STATE);
  return <form action={action} className={cn("grid gap-3 rounded-lg border bg-card p-3", className)}>
    <input type="hidden" name="operation" value={operation} />
    {Object.entries(hidden ?? {}).map(([name, value]) => value === undefined || value === null ? null : <input key={name} type="hidden" name={name} value={String(value)} />)}
    {children}
    <SubmitButton label={label} destructive={destructive} />
    {state.status === "idle" ? null : <p aria-live="polite" className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-emerald-700"}>{state.message}</p>}
  </form>;
}

function SubmitButton({ label, destructive }: Readonly<{ label: string; destructive: boolean }>) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>{pending ? "Wird verarbeitet …" : label}</Button>;
}

export const adminInputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
export const adminTextareaClass = "min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30";
