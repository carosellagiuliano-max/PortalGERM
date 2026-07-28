import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { listCompanyVerificationQueue } from "@/lib/companies/verification/admin-service";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Firmenprüfungen",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function AdminCompanyVerificationQueuePage() {
  const user = await requireAdminPage();
  const environment = getServerEnvironment();
  const rows =
    (await listCompanyVerificationQueue(
      {
        actor: {
          userId: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          capabilities: user.capabilities,
          sessionId: user.sessionId,
        },
        correlationId: "admin-company-verification-queue",
        database: getDatabase(),
        now: new Date(),
        stepUpMode: environment.PRIVILEGED_STEP_UP_MODE,
      },
      { limit: 100 },
    )) ?? [];
  const assigned = rows.filter(
    (row) => row.assignedReviewerUserId === user.id,
  ).length;
  const overdue = rows.filter(
    (row) => row.reviewDueAt !== null && row.reviewDueAt <= new Date(),
  ).length;

  return (
    <section className="grid gap-6" aria-labelledby="company-verification-queue-title">
      <header>
        <p className="eyebrow">Trust Operations</p>
        <h1 id="company-verification-queue-title" className="mt-2 text-3xl font-semibold">
          Firmenprüfungen
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Priorisierte, paginierbare Queue mit Zuweisung, Fälligkeit,
          Evidenzstatus und unabhängiger Freigabe.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Offene Fälle im geladenen Fenster" value={rows.length} />
        <Metric label="Mir zugewiesen" value={assigned} />
        <Metric label="SLA überschritten" value={overdue} destructive={overdue > 0} />
      </div>

      <div className="grid gap-3">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            Keine strukturierten Firmenprüfungen in der offenen Queue.
          </p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.id}
              href={`/admin/company-verification/${row.id}`}
              className="grid gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{row.company.name}</strong>
                  <Badge variant={row.riskLevel === "NORMAL" ? "outline" : "destructive"}>
                    {row.riskLevel}
                  </Badge>
                  <Badge>{row.status}</Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  UID {row.company.uid ?? "offen"} · Priorität {row.priority} ·
                  fällig {row.reviewDueAt ? formatDateTime(row.reviewDueAt) : "ohne SLA"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Evidenz: {row.evidence.map((evidence) => `${evidence.type} ${evidence.status}`).join(" · ") || "keine"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {row.assignedReviewerUserId === null
                  ? "nicht zugewiesen"
                  : row.assignedReviewerUserId === user.id
                    ? "mir zugewiesen"
                    : "anderer Review"}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  destructive = false,
}: Readonly<{ label: string; value: number; destructive?: boolean }>) {
  return (
    <Card>
      <CardHeader><CardTitle as="h2" className="text-sm">{label}</CardTitle></CardHeader>
      <CardContent><p className={destructive ? "text-3xl font-semibold text-destructive" : "text-3xl font-semibold"}>{value}</p></CardContent>
    </Card>
  );
}
