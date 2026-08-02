import type { Metadata } from "next";
import Link from "@/components/shared/app-link";

import { releaseHeldSettlementAction } from "@/app/admin/finance/reconciliation/actions";
import { StepUpGrantControl } from "@/components/security/step-up-grant-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasAdminCapability } from "@/lib/admin/capabilities";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getFinanceReconciliationPage } from "@/lib/billing/finance-read-model";
import { PAYMENT_SETTLEMENT_RELEASE_POLICY_V1 } from "@/lib/billing/payment-inbox";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatChfFromRappen, formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Finance Reconciliation",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function FinanceReconciliationPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    cursor?: string | string[];
    result?: string | string[];
  }>;
}>) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const cursor = typeof query.cursor === "string" ? query.cursor : null;
  const data = await getFinanceReconciliationPage(
    getDatabase(),
    {
      userId: admin.id,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    cursor,
  );
  if (data === null) return null;
  const environment = getServerEnvironment();
  const result = typeof query.result === "string" ? query.result : null;
  const canReleaseSettlement = hasAdminCapability(
    {
      userId: admin.id,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    "ADMIN_BILLING_MUTATE",
  );
  return (
    <div className="grid gap-7">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge>Finance · Read-only</Badge>
          <Badge variant="outline">
            Repair: {environment.FINANCE_REPAIR_ACTIONS ? "aktiv" : "gesperrt"}
          </Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">Payment-Abgleich</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Signierte Providerereignisse werden gegen Attempt, Bestellung,
          Rechnung, Subscription und Ledger abgeglichen. Abweichungen werden als
          Fälle gespeichert und niemals still korrigiert.
        </p>
      </header>

      {result === null ? null : (
        <Alert variant={result === "RELEASED" ? "default" : "destructive"}>
          <AlertTitle>
            {result === "RELEASED"
              ? "Settlement freigegeben"
              : "Freigabe nicht ausgeführt"}
          </AlertTitle>
          <AlertDescription>
            {result === "RELEASED"
              ? "Das signierte Ereignis wurde genau einmal wieder in die Projektions-Queue gestellt."
              : `Der sichere Freigabevertrag hat den Vorgang blockiert (${result}).`}
          </AlertDescription>
        </Alert>
      )}

      {!environment.FINANCE_REPAIR_ACTIONS ? (
        <Alert>
          <AlertTitle>Manuelle Reparatur gesperrt</AlertTitle>
          <AlertDescription>
            Phase 24 zeigt und klassifiziert Abweichungen. Geld- oder
            Ledgermutationen benötigen Phase-25-Capability, getrennte Freigabe,
            Step-up und Pflichtgrund.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Inbox empfangen"
          value={data.inboxCounts.RECEIVED ?? 0}
        />
        <Metric label="Inbox gehalten" value={data.inboxCounts.HELD ?? 0} />
        <Metric
          label="Versuche erfolgreich"
          value={data.attemptCounts.SUCCEEDED ?? 0}
        />
        <Metric
          label="Versuche gehalten"
          value={data.attemptCounts.HELD ?? 0}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Offene Abweichungen</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.openItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine offene Abweichung.
            </p>
          ) : (
            data.openItems.map((item) => (
              <div
                key={item.id}
                className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[10rem_10rem_minmax(0,1fr)_auto]"
              >
                <Badge variant="outline">{item.mismatchKind}</Badge>
                <span className="text-sm">{item.status}</span>
                <span className="text-sm text-muted-foreground">
                  Provider …{item.providerReference.slice(-8)} ·{" "}
                  {item.expectedAmountRappen === null
                    ? "kein Sollbetrag"
                    : formatChfFromRappen(item.expectedAmountRappen)}
                  {" → "}
                  {item.observedAmountRappen === null
                    ? "kein Istbetrag"
                    : formatChfFromRappen(item.observedAmountRappen)}
                </span>
                <time className="text-xs text-muted-foreground">
                  {formatDateTime(item.createdAt)}
                </time>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">
            Nach Provider-Widerruf gehaltene Zahlungen
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.heldSettlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine bereits bezahlte Providertransaktion wartet auf eine
              Finance-Entscheidung.
            </p>
          ) : (
            data.heldSettlements.map((settlement) => (
              <div className="rounded-lg border p-3" key={settlement.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{settlement.eventType}</span>
                  <time className="text-xs text-muted-foreground">
                    {formatDateTime(settlement.receivedAt)}
                  </time>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  Inbox {settlement.id}
                </p>
                {!environment.FINANCE_REPAIR_ACTIONS ||
                !canReleaseSettlement ||
                settlement.paymentAttempt === null ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Die Freigabe bleibt gesperrt, bis Reparaturmodus,
                    Billing-Mutation-Capability und eine gebundene Zahlung
                    gemeinsam vorliegen.
                  </p>
                ) : (
                  <form
                    action={releaseHeldSettlementAction}
                    className="mt-3 grid gap-3"
                  >
                    <input name="inboxId" type="hidden" value={settlement.id} />
                    <input
                      name="reasonCode"
                      type="hidden"
                      value="HISTORIC_SETTLEMENT_REVIEWED"
                    />
                    <StepUpGrantControl
                      action={PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.action}
                      purpose={PAYMENT_SETTLEMENT_RELEASE_POLICY_V1.purpose}
                      resourceId={settlement.id}
                      securityHref="/admin/security"
                      tenantId={settlement.paymentAttempt.companyId}
                    />
                    <Button type="submit">
                      Signierte Zahlung zur Projektion freigeben
                    </Button>
                  </form>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Abgleichsläufe</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.runs.map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span>
                <strong>{run.status}</strong>
                <span className="block text-xs text-muted-foreground">
                  {run.provider} · {run.environment} ·{" "}
                  {formatDateTime(run.startedAt)}
                </span>
              </span>
              <span className="text-right text-sm tabular-nums">
                {run.matchedCount} passend · {run.mismatchCount} offen
                <span className="block text-xs text-muted-foreground">
                  {run._count.items} Items
                </span>
              </span>
            </div>
          ))}
          {data.nextCursor === null ? null : (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/admin/finance/reconciliation?cursor=${encodeURIComponent(data.nextCursor)}`}
            >
              Weitere Läufe
            </Link>
          )}
        </CardContent>
      </Card>

      <Link
        href="/admin/finance/service-recovery"
        className={buttonVariants({ variant: "outline" })}
      >
        Zu Service-Recovery und Dunning
      </Link>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-2xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {label}
      </CardContent>
    </Card>
  );
}
