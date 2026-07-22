import type { Metadata } from "next";

import { LeadList } from "@/components/admin/LeadList";
import { listAdminLeads } from "@/lib/admin/leads";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";

export const metadata: Metadata = { title: "Sales Leads" };

export default async function AdminLeadsPage({ searchParams }: Readonly<{ searchParams: Promise<{ status?: string; owner?: string; overdue?: string }> }>) {
  const [admin, query] = await Promise.all([requireAdminPage(), searchParams]);
  const now = new Date();
  const dependencies = { actor: { userId: admin.id, email: admin.email, role: admin.role, status: admin.status }, correlationId: "admin-leads-read", database: getDatabase(), now } as const;
  const rows = await listAdminLeads(dependencies) ?? [];
  const owners = [...new Map(rows.flatMap((lead) => lead.owner === null ? [] : [[lead.owner.id, lead.owner] as const])).values()];
  const leads = rows.filter((lead) => {
    const targetAt = lead.dueAt ?? lead.nextAt;
    return (!query.status || lead.status === query.status) &&
      (!query.owner || (query.owner === "UNASSIGNED" ? lead.owner === null : lead.owner?.id === query.owner)) &&
      (query.overdue !== "true" || (targetAt !== null && targetAt <= now));
  });
  return <div className="grid gap-6"><header><p className="eyebrow">Sales Operations</p><h1 className="mt-2 text-3xl font-semibold">Leads</h1><p className="mt-2 text-muted-foreground">Neue und zugewiesene Leads werden nach dem 24-Stunden-Ziel geordnet; Überfälligkeit ist sichtbar.</p></header><form method="get" className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-4"><select name="status" defaultValue={query.status ?? ""} className="h-9 rounded-lg border px-3 text-sm"><option value="">Alle Status</option><option>NEW</option><option>CONTACTED</option><option>QUALIFIED</option><option>WON</option><option>LOST</option></select><select name="owner" defaultValue={query.owner ?? ""} className="h-9 rounded-lg border px-3 text-sm"><option value="">Alle Owner</option><option value="UNASSIGNED">Nicht zugewiesen</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name ?? owner.email}</option>)}</select><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="overdue" value="true" defaultChecked={query.overdue === "true"} /> nur überfällig</label><button className="rounded-lg bg-primary px-3 text-sm text-primary-foreground">Filtern</button></form><LeadList leads={leads} now={now} /></div>;
}
