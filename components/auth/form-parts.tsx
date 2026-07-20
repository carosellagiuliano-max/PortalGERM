"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { AuthActionState } from "@/components/auth/auth-action-state";
import { cn } from "@/lib/utils";

export function FieldError({
  state,
  field,
}: Readonly<{ state: AuthActionState; field: string }>) {
  const messages = state.fieldErrors?.[field];
  if (messages === undefined || messages.length === 0) return null;

  return (
    <div id={`${field}-error`} className="text-sm text-destructive" aria-live="polite">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

export function FormFeedback({ state }: Readonly<{ state: AuthActionState }>) {
  if (state.status === "idle" || state.message === undefined) return null;
  const failed = state.status === "error" || state.status === "rate_limited";

  return (
    <Alert variant={failed ? "destructive" : "default"} aria-live="polite">
      <AlertTitle>
        {state.status === "success"
          ? "Erledigt"
          : state.status === "rate_limited"
            ? "Bitte kurz warten"
            : "Eingabe prüfen"}
      </AlertTitle>
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

export function SubmitButton({
  pending,
  disabled = false,
  idleLabel,
  pendingLabel,
}: Readonly<{
  pending: boolean;
  disabled?: boolean;
  idleLabel: string;
  pendingLabel: string;
}>) {
  const unavailable = pending || disabled;
  return (
    <Button
      type="submit"
      size="lg"
      className="h-11 w-full"
      disabled={unavailable}
      aria-disabled={unavailable}
    >
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}

export function NativeCheckboxField({
  id,
  name,
  label,
  description,
  state,
  required = false,
}: Readonly<{
  id: string;
  name: string;
  label: React.ReactNode;
  description?: string;
  state: AuthActionState;
  required?: boolean;
}>) {
  const errorId = state.fieldErrors?.[name]?.length ? `${name}-error` : undefined;
  const descriptionId = description === undefined ? undefined : `${id}-description`;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          value="true"
          required={required}
          defaultChecked={state.values?.[name] === true}
          aria-invalid={errorId === undefined ? undefined : true}
          aria-describedby={describedBy}
          className="mt-1 size-4 shrink-0 rounded border-input accent-primary"
        />
        <div className="grid gap-1">
          <Label htmlFor={id} className="text-sm leading-6 font-normal">
            {label}
          </Label>
          {description === undefined ? null : (
            <p id={descriptionId} className="text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <FieldError state={state} field={name} />
    </div>
  );
}

export function formControlClassName(invalid: boolean, className?: string) {
  return cn(
    "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
    invalid && "border-destructive",
    className,
  );
}
