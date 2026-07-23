import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listAdminReports } from "@/lib/admin/moderation";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Abuse Reports" };

type ReportQuery = Readonly<{
  severity?: string;
  status?: string;
  target?: string;
  assignee?: string;
  overdue?: string;
}>;

export default async function AdminReportsPage({ searchParams }: Readonly<{ searchParams: Promise<ReportQuery> }>) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const now = new Date();
  const dependencies = { actor: { userId: admin.id, email: admin.email, role: admin.role, status: admin.status }, correlationId: "admin-reports-read", database: getDatabase(), now } as const;
  const rows = await listAdminReports(dependencies) ?? [];
  const assignees = [...new Map(rows.flatMap((row) => row.assignee === null ? [] : [[row.assignee.id, row.assignee] as const])).values()];
  const reports = rows.filter((row) =>
    (!query.severity || row.severity === query.severity) &&
    (!query.status || row.status === query.status) &&
    (!query.target || row.targetType === query.target) &&
    (!query.assignee || (query.assignee === "UNASSIGNED" ? row.assignee === null : row.assignee?.id === query.assignee)) &&
    (query.overdue !== "true" || row.dueAt <= now),
  );

  return <div className="grid gap-6"><header><p className="eyebrow">Trust &amp; Safety</p><h1 className="mt-2 text-3xl font-semibold">Abuse Reports</h1><p className="mt-2 text-muted-foreground">Risk-first Queue. Kritisch: operatives Ziel 1 Stunde; High 4, Medium 24, Low 72 Stunden.</p></header><form method="get" className="grid gap-2 rounded-lg border bg-card p-3 md:grid-cols-3 xl:grid-cols-6"><label className="grid gap-1 text-xs font-medium text-muted-foreground">Schweregrad<select name="severity" defaultValue={query.severity ?? ""} className="h-9 rounded-lg border px-3 text-sm text-foreground"><option value="">Alle Schweregrade</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label><label className="grid gap-1 text-xs font-medium text-muted-foreground">Status<select name="status" defaultValue={query.status ?? ""} className="h-9 rounded-lg border px-3 text-sm text-foreground"><option value="">Alle Status</option><option>OPEN</option><option>IN_REVIEW</option><option>RESOLVED</option><option>DISMISSED</option></select></label><label className="grid gap-1 text-xs font-medium text-muted-foreground">Ziel<select name="target" defaultValue={query.target ?? ""} className="h-9 rounded-lg border px-3 text-sm text-foreground"><option value="">Alle Ziele</option><option>JOB</option><option>COMPANY</option><option>USER</option><option>MESSAGE</option></select></label><label className="grid gap-1 text-xs font-medium text-muted-foreground">Zuständig<select name="assignee" defaultValue={query.assignee ?? ""} className="h-9 rounded-lg border px-3 text-sm text-foreground"><option value="">Alle Zuständigen</option><option value="UNASSIGNED">Nicht zugewiesen</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name ?? assignee.email}</option>)}</select></label><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="overdue" value="true" defaultChecked={query.overdue === "true"} /> nur überfällig</label><button type="submit" className="self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">Filtern</button></form><div className="grid gap-3">{reports.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Keine Reports in dieser Queue.</p> : reports.map((report) => <div key={report.id} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-medium">{report.reasonCode} · {report.targetType}</p><p className="text-xs text-muted-foreground">Zuständig: {report.assignee?.name ?? report.assignee?.email ?? "nicht zugewiesen"} · operatives Ziel {report.dueAt.toLocaleString("de-CH")} · {report._count.restrictions} Restriktionen</p><div className="mt-2 flex flex-wrap gap-3 text-sm"><Link href={`/admin/reports/${report.id}`} className="font-medium underline underline-offset-4">Report öffnen</Link>{report.targetType === "COMPANY" ? <Link href={`/admin/companies/${report.targetId}`} className="font-medium underline underline-offset-4">Firma öffnen</Link> : null}</div></div><div className="flex gap-2"><Badge variant={report.dueAt <= now && !["RESOLVED", "DISMISSED"].includes(report.status) ? "destructive" : "outline"}>{report.severity}</Badge><Badge variant="secondary">{report.status}</Badge></div></div>)}</div></div>;
}
