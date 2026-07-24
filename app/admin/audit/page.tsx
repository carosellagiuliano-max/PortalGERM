import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { listAdminAuditEntries } from "@/lib/admin/audit-read";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { AUDIT_ACTIONS_V1 } from "@/lib/domains/audit/audit-actions";
import {
  AUDIT_RESULTS_V1,
  AUDIT_TARGET_TYPES_V1,
} from "@/lib/audit/log";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Audit-Evidenz" };

export default async function AdminAuditPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    action?: string;
    correlationId?: string;
    result?: string;
    targetType?: string;
  }>;
}>) {
  const [admin, query] = await Promise.all([
    requireAdminPage(),
    searchParams,
  ]);
  const result = await listAdminAuditEntries(query, {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: "admin-audit-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (result === null) return null;

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Security &amp; Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Audit-Evidenz</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Die letzten 100 Einträge, serverseitig begrenzt und ohne freie
          Metadaten-, IP-Hash- oder Secret-Ausgabe. Für eine gezielte
          Untersuchung stehen geschlossene Filter bereit.
        </p>
      </header>

      <form
        className="grid gap-3 rounded-lg border bg-card p-4 lg:grid-cols-4"
        method="get"
      >
        <FilterSelect label="Aktion" name="action" values={AUDIT_ACTIONS_V1} />
        <FilterSelect
          label="Zieltyp"
          name="targetType"
          values={AUDIT_TARGET_TYPES_V1}
        />
        <FilterSelect
          label="Ergebnis"
          name="result"
          values={AUDIT_RESULTS_V1}
        />
        <label className="grid gap-1 text-sm">
          Correlation-ID
          <input
            className="h-10 rounded-lg border bg-background px-3"
            maxLength={128}
            name="correlationId"
            pattern="[A-Za-z0-9._:-]+"
          />
        </label>
        <button
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground lg:col-span-4 lg:justify-self-start"
          type="submit"
        >
          Audit filtern
        </button>
      </form>

      {result.invalidFilter ? (
        <p className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
          Der Filter ist ungültig. Es wurden keine Auditzeilen geladen.
        </p>
      ) : result.entries.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Keine Audit-Evidenz für diesen Filter.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border"
          data-e2e-horizontal-scroll="true"
        >
          <table className="min-w-[70rem] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3">Zeit / Ergebnis</th>
                <th className="p-3">Aktion / Capability</th>
                <th className="p-3">Akteur</th>
                <th className="p-3">Ziel</th>
                <th className="p-3">Correlation / Retention</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="p-3 align-top">
                    <Badge
                      variant={
                        entry.result === "SUCCEEDED"
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {entry.result}
                    </Badge>
                    <p className="mt-2">{formatDateTime(entry.createdAt)}</p>
                  </td>
                  <td className="p-3 align-top">
                    <strong>{entry.action}</strong>
                    <p className="text-xs text-muted-foreground">
                      {entry.capability} · {entry.reasonCode ?? "ohne Reason-Code"}
                    </p>
                  </td>
                  <td className="p-3 align-top">
                    {entry.actor?.name ?? entry.actor?.email ?? entry.actorKind}
                  </td>
                  <td className="p-3 align-top">
                    {entry.targetType} · {entry.targetId}
                    <p className="text-xs text-muted-foreground">
                      {entry.company?.name ??
                        (entry.companyId === null
                          ? "ohne Firmenkontext"
                          : entry.companyId)}
                    </p>
                  </td>
                  <td className="p-3 align-top font-mono text-xs">
                    {entry.correlationId}
                    <p className="mt-2 font-sans text-muted-foreground">
                      Aufbewahrung bis {formatDateTime(entry.retainUntil)}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  name,
  values,
}: Readonly<{
  label: string;
  name: string;
  values: readonly string[];
}>) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <select className="h-10 rounded-lg border bg-background px-3" name={name}>
        <option value="">Alle</option>
        {values.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
}
