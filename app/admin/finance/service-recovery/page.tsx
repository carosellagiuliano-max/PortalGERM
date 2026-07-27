import type { Metadata } from "next";
import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getFinanceServiceRecoveryPage } from "@/lib/billing/finance-read-model";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Service Recovery",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function FinanceServiceRecoveryPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ cursor?: string | string[] }>;
}>) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const data = await getFinanceServiceRecoveryPage(
    getDatabase(),
    {
      userId: admin.id,
      role: admin.role,
      status: admin.status,
      capabilities: admin.capabilities,
    },
    typeof query.cursor === "string" ? query.cursor : null,
  );
  if (data === null) return null;
  const environment = getServerEnvironment();
  return (
    <div className="grid gap-7">
      <header>
        <div className="flex flex-wrap gap-2">
          <Badge>Service Delivery</Badge>
          <Badge variant="outline">
            Auto-Recovery:{" "}
            {environment.PAID_SERVICE_RECOVERY ? "aktiv" : "gesperrt"}
          </Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold">
          Nichterfüllung und Ersatzleistung
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Nur ein belegter Plattformfehler kann einen Credit-Restore oder eine
          Serviceverlängerung auslösen. Normale Kandidatenablehnung,
          gewöhnlicher Ablauf und freiwillige Kündigung bleiben ausgeschlossen.
        </p>
      </header>

      {!environment.PAID_SERVICE_RECOVERY ? (
        <Alert>
          <AlertTitle>Automatische Remedies deaktiviert</AlertTitle>
          <AlertDescription>
            Assessments und Eskalationen sind sichtbar. Die Ausführung bleibt
            bis zur versionierten Servicepolicy und Operationsfreigabe
            serverseitig geschlossen.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Assessments offen" value={data.statusCounts.OPEN ?? 0} />
        <Metric label="Eskalationen" value={data.statusCounts.ESCALATED ?? 0} />
        <Metric
          label="Dunning suspendiert"
          value={data.dunningCounts.SUSPENDED ?? 0}
        />
        <Metric
          label="Refunds pending"
          value={data.refundCounts.PENDING ?? 0}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Service-Delivery-Fälle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {data.assessments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Assessments.
            </p>
          ) : (
            data.assessments.map((assessment) => (
              <div
                key={assessment.id}
                className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[12rem_12rem_minmax(0,1fr)_auto]"
              >
                <span className="flex flex-wrap gap-2">
                  <Badge variant="outline">{assessment.serviceKind}</Badge>
                  <Badge>{assessment.status}</Badge>
                </span>
                <span className="text-sm">{assessment.classification}</span>
                <span className="text-sm text-muted-foreground">
                  {assessment.remedyKind} · {assessment.reasonCode}
                </span>
                <time className="text-xs text-muted-foreground">
                  {formatDateTime(assessment.assessedAt)}
                </time>
              </div>
            ))
          )}
          {data.nextCursor === null ? null : (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/admin/finance/service-recovery?cursor=${encodeURIComponent(data.nextCursor)}`}
            >
              Weitere Fälle
            </Link>
          )}
        </CardContent>
      </Card>

      <Link
        href="/admin/finance/reconciliation"
        className={buttonVariants({ variant: "outline" })}
      >
        Zum Payment-Abgleich
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
