"use client";

import { useActionState } from "react";

import Link from "next/link";

import {
  activateIncludedBoostAction,
  cancelEmployerBoostAction,
} from "@/app/employer/jobs/[id]/boost/actions";
import { EmployerActionFeedback, EmployerSubmitButton } from "@/components/employer/action-form-parts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { BoostPurchaseView } from "@/lib/billing/boosts";
import { INITIAL_BILLING_ACTION_STATE } from "@/lib/billing/employer-action-state";
import { formatChfFromRappen } from "@/lib/utils/format";

export function BoostDialog({
  view,
  creditIdempotencyKey,
  cancellationIdempotencyKey,
}: Readonly<{
  view: BoostPurchaseView;
  creditIdempotencyKey: string;
  cancellationIdempotencyKey: string;
}>) {
  const sevenDay = view.products.find((product) => product.slug === "boost-7d")!;
  const thirtyDay = view.products.find((product) => product.slug === "boost-30d")!;
  const active = view.currentBoost?.status === "ACTIVE" ? view.currentBoost : null;
  return (
    <div className="grid gap-6">
      {active === null ? null : (
        <ActiveBoostCard
          boost={active}
          idempotencyKey={cancellationIdempotencyKey}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle as="h2">7 Tage</CardTitle>
              <Badge>{formatChfFromRappen(sevenDay.netPriceRappen)}</Badge>
            </div>
            <CardDescription>Start sofort, Ende nach exakt sieben Tagen.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {view.creditSource === null ? (
              <p className="text-sm text-muted-foreground">Kein Plan- oder Admin-Credit verfügbar.</p>
            ) : (
              <CreditForm
                jobId={view.job.id}
                idempotencyKey={creditIdempotencyKey}
                source={view.creditSource}
                disabled={active !== null}
              />
            )}
            <Link
              aria-disabled={active !== null}
              className={buttonVariants({ variant: "outline" })}
              href={active === null
                ? `/employer/billing/checkout?product=boost-7d&job=${view.job.id}`
                : `/employer/jobs/${view.job.id}/boost`}
            >
              Mit Zahlung boosten
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle as="h2">30 Tage</CardTitle>
              <Badge>{formatChfFromRappen(thirtyDay.netPriceRappen)}</Badge>
            </div>
            <CardDescription>30 Tage werden immer als einmaliges Produkt bezahlt.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              aria-disabled={active !== null}
              className={buttonVariants({ className: "w-full" })}
              href={active === null
                ? `/employer/billing/checkout?product=boost-30d&job=${view.job.id}`
                : `/employer/jobs/${view.job.id}/boost`}
            >
              Mit Zahlung boosten
            </Link>
          </CardContent>
        </Card>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Ein Boost erhöht nur die zeitlich begrenzte Sichtbarkeit in relevanten Ergebnissen.
        Er verändert weder den Fair-Job-Score noch die inhaltliche Eignung und verspricht keine Bewerbungen.
      </p>
    </div>
  );
}

function CreditForm({
  jobId,
  idempotencyKey,
  source,
  disabled,
}: Readonly<{
  jobId: string;
  idempotencyKey: string;
  source: NonNullable<BoostPurchaseView["creditSource"]>;
  disabled: boolean;
}>) {
  const [state, action, pending] = useActionState(
    activateIncludedBoostAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  return (
    <form action={action} className="grid gap-3 rounded-lg border p-4">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <p className="text-sm font-medium">Exakte Quelle: {source.fundingSource === "PLAN_ALLOWANCE" ? "Plan-Credit" : "Admin-Gutschrift"}</p>
      <p className="text-xs text-muted-foreground">Quelle gültig bis {formatDate(source.validTo)}. Die Laufzeit des aktivierten Boosts wird dadurch nicht verkürzt.</p>
      <EmployerActionFeedback state={state} />
      <EmployerSubmitButton
        disabled={disabled}
        label="Boost-Credit verwenden"
        pending={pending}
        pendingLabel="Boost wird aktiviert …"
      />
    </form>
  );
}

function ActiveBoostCard({
  boost,
  idempotencyKey,
}: Readonly<{
  boost: NonNullable<BoostPurchaseView["currentBoost"]>;
  idempotencyKey: string;
}>) {
  const [state, action, pending] = useActionState(
    cancelEmployerBoostAction,
    INITIAL_BILLING_ACTION_STATE,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Aktiver Boost</CardTitle>
        <CardDescription>Geboostet bis {formatDate(boost.endsAt)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid max-w-xl gap-3">
          <input type="hidden" name="boostId" value={boost.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <label className="grid gap-2 text-sm font-medium">
            Grund für das Beenden
            <Input name="reason" minLength={5} maxLength={500} required placeholder="z. B. Stelle wird nicht mehr priorisiert" />
          </label>
          <p className="text-sm font-medium text-destructive">Keine Rückerstattung im MVP</p>
          <EmployerActionFeedback state={state} />
          <EmployerSubmitButton
            label="Boost beenden"
            pending={pending}
            pendingLabel="Boost wird beendet …"
            variant="destructive"
          />
        </form>
      </CardContent>
    </Card>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("de-CH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zurich",
  }).format(value);
}
