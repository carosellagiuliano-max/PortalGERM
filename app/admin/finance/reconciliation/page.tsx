import type { Metadata } from "next";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getFinanceReconciliationPage } from "@/lib/billing/finance-read-model";
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
  searchParams: Promise<{ cursor?: string | string[] }>;
}>) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const cursor = typeof query.cursor === "string" ? query.cursor : null;
  const data = await getFinanceReconciliationPage(
    getDatabase(),
    { userId: admin.id, role: admin.role, status: admin.status },
    cursor,
  );
  if (data === null) return null;
  const environment = getServerEnvironment();
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
