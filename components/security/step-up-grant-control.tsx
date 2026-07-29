"use client";

import Link from "@/components/shared/app-link";
import { useState, useTransition } from "react";

import { issueBoundStepUpGrantAction } from "@/app/security/step-up-actions";
import { Button } from "@/components/ui/button";

export function StepUpGrantControl({
  purpose,
  action,
  tenantId,
  resourceId,
  securityHref,
}: Readonly<{
  purpose: string;
  action: string;
  tenantId?: string | null;
  resourceId?: string | null;
  securityHref: string;
}>) {
  const [pending, startTransition] = useTransition();
  const [grant, setGrant] = useState<{
    evidenceId: string;
    grantToken: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <input
        name="stepUpEvidenceId"
        type="hidden"
        value={grant?.evidenceId ?? ""}
      />
      <input
        name="stepUpGrantToken"
        type="hidden"
        value={grant?.grantToken ?? ""}
      />
      <p className="text-sm font-medium">Aktionsgebundene Bestätigung</p>
      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
        {purpose} · {action} · {tenantId ?? "ohne Tenant"} ·{" "}
        {resourceId ?? "ohne Ressource"}
      </p>
      {grant ? (
        <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300" role="status">
          Bestätigung ausgestellt; einmalig gültig bis{" "}
          {new Intl.DateTimeFormat("de-CH", {
            timeStyle: "short",
            timeZone: "Europe/Zurich",
          }).format(new Date(grant.expiresAt))}
          .
        </p>
      ) : (
        <Button
          className="mt-3"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await issueBoundStepUpGrantAction({
                purpose,
                action,
                tenantId,
                resourceId,
              });
              if (!result.ok) {
                setError({ code: result.code, message: result.message });
                return;
              }
              setGrant(result.value);
            });
          }}
          type="button"
          variant="outline"
        >
          {pending ? "Bestätigung wird gebunden …" : "Sicherheitsbestätigung ausstellen"}
        </Button>
      )}
      {error ? (
        <div className="mt-2 text-sm text-destructive" role="alert">
          {error.message}{" "}
          {error.code === "AAL2_REQUIRED" ? (
            <Link className="underline" href={securityHref}>
              Sitzung jetzt bestätigen
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
