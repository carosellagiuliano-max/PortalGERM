"use client";

import { useActionState } from "react";

import {
  submitTrustSafetyAppealAction,
  type TrustAppealActionState,
} from "@/app/security/trust-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const INITIAL_STATE: TrustAppealActionState = Object.freeze({
  status: "idle",
  message: "",
});

type OwnedTrustCase = Readonly<{
  id: string;
  category: string;
  severity: string;
  status: string;
  safeReasonCode: string;
  reviewDueAt: Date;
  holdExpiresAt: Date | null;
  appeals: readonly Readonly<{
    id: string;
    status: string;
    createdAt: Date;
  }>[];
}>;

export function TrustAppeals({
  cases,
}: Readonly<{ cases: readonly OwnedTrustCase[] }>) {
  if (cases.length === 0) return null;
  return (
    <section aria-labelledby="trust-holds-title" className="grid gap-4">
      <div>
        <h2 id="trust-holds-title" className="text-xl font-semibold">
          Sicherheitsprüfung und Widerspruch
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sichere Gründe und nächste Schritte werden gezeigt; interne
          Erkennungsdetails und Daten Dritter bleiben geschützt.
        </p>
      </div>
      {cases.map((trustCase) => (
        <TrustAppealCard key={trustCase.id} trustCase={trustCase} />
      ))}
    </section>
  );
}

function TrustAppealCard({
  trustCase,
}: Readonly<{ trustCase: OwnedTrustCase }>) {
  const [state, action, pending] = useActionState(
    submitTrustSafetyAppealAction,
    INITIAL_STATE,
  );
  const appealOpen = trustCase.appeals.length > 0;
  return (
    <article className="grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {trustCase.category} · {trustCase.status}
        </p>
        <span className="rounded-full border px-2 py-1 text-xs">
          Priorität {trustCase.severity}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Sicherer Grund: {trustCase.safeReasonCode}. Review bis{" "}
        {new Intl.DateTimeFormat("de-CH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Europe/Zurich",
        }).format(new Date(trustCase.reviewDueAt))}
        .
      </p>
      {appealOpen ? (
        <p role="status" className="text-sm font-medium">
          Dein Widerspruch ist offen und einer unabhängigen Prüfung zugeführt.
        </p>
      ) : (
        <form action={action} className="grid gap-3">
          <input type="hidden" name="caseId" value={trustCase.id} />
          <label className="text-sm font-medium" htmlFor={`appeal-${trustCase.id}`}>
            Warum soll der Entscheid erneut geprüft werden?
          </label>
          <Textarea
            id={`appeal-${trustCase.id}`}
            name="safeStatement"
            minLength={20}
            maxLength={2000}
            required
          />
          {state.status === "idle" ? null : (
            <p
              role={state.status === "success" ? "status" : "alert"}
              className={
                state.status === "success"
                  ? "text-sm text-emerald-700"
                  : "text-sm text-destructive"
              }
            >
              {state.message}
            </p>
          )}
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Widerspruch wird erfasst …" : "Widerspruch einreichen"}
          </Button>
        </form>
      )}
    </article>
  );
}
