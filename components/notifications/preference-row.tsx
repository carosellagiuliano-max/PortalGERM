"use client";

import { useActionState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import { FormFeedback } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { setNotificationPreferenceAction } from "@/lib/notifications/server-actions";

export function PreferenceRow({
  purpose,
  title,
  description,
  enabled,
  version,
  activationAvailable,
}: Readonly<{
  purpose: "JOB_ALERT" | "COMMERCIAL_OPTIONAL";
  title: string;
  description: string;
  enabled: boolean;
  version: number;
  activationAvailable: boolean;
}>) {
  const [state, action, pending] = useActionState(
    setNotificationPreferenceAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const submittedVersion =
    typeof state.values?.version === "string"
      ? Number(state.values.version)
      : Number.NaN;
  const expectedVersion = Number.isSafeInteger(submittedVersion)
    ? submittedVersion
    : version;
  return (
    <form
      action={action}
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
    >
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="expectedVersion" value={expectedVersion} />
      <div>
        <Label
          htmlFor={`preference-${purpose}`}
          className="text-base font-semibold"
        >
          {title}
        </Label>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        {!activationAvailable ? (
          <p className="mt-2 text-xs font-medium text-amber-700" role="status">
            Die Präferenz wird gespeichert; optionale externe Zustellung ist
            bis zur rechtlichen Freigabe pausiert.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <input
          id={`preference-${purpose}`}
          name="enabled"
          type="checkbox"
          value="true"
          defaultChecked={enabled}
          className="size-5 rounded border-input accent-primary"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Speichert …" : "Speichern"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
