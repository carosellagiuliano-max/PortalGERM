import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listOpenSystemTasks } from "@/lib/admin/system-governance";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Systemstatus" };

const providers = [
  ["Zahlung", "Lokaler persistierender Mock"],
  ["E-Mail", "EmailLog + geschützte lokale Mailbox"],
  ["KI", "Deterministischer Regel-Mock"],
  ["Job-Room", "Versionierter lokaler Lookup"],
  ["Storage", "Metadaten-Mock, keine Bytes"],
  ["Pendeldistanz", "Deterministische lokale Klasse"],
] as const;

export default async function AdminSystemPage() {
  const admin = await requireAdminPage();
  const now = new Date();
  const tasks = await listOpenSystemTasks({
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: "admin-system-read",
    database: getDatabase(),
    now,
  });
  if (tasks === null) return null;

  const overdue = tasks.filter((task) => task.dueAt <= now).length;
  return (
    <div className="grid gap-8">
      <header>
        <p className="eyebrow">Operations</p>
        <h1 className="mt-2 text-3xl font-semibold">Systemstatus</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Kontrollierte Betriebsübersicht für den Mock-MVP. Sie ersetzt kein
          externes Monitoring, keinen Incident Owner und keine
          Produktionsfreigabe.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <StatusCard
          label="Liveness"
          value="HTTP-Prüfung"
          href="/health/live"
        />
        <StatusCard
          label="Readiness"
          value="DB + Migration"
          href="/health/ready"
        />
        <article className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Systemaufgaben</p>
          <p className="mt-2 text-2xl font-semibold">{tasks.length} offen</p>
          <p className="mt-1 text-sm">{overdue} überfällig</p>
        </article>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Provider-Grenzen</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Alle Adapter sind netzwerkfreie Mocks. Ein gesetzter API-Key
          aktiviert keinen realen Provider.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map(([name, status]) => (
            <article className="rounded-lg border bg-card p-4" key={name}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{name}</h3>
                <Badge variant="outline">MOCK</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{status}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Offene Systemaufgaben</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Outcomes werden im Business Cockpit auditierbar abgeschlossen.
            </p>
          </div>
          <Link
            className="text-sm font-medium text-primary"
            href="/admin/business-cockpit"
          >
            Cockpit öffnen →
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Keine offenen Systemaufgaben.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {tasks.map((task) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
                key={task.id}
              >
                <span>
                  <strong>{task.kind}</strong> · {task.reasonCode}
                  <span className="block text-sm text-muted-foreground">
                    {task.company?.name ?? "Plattform"} ·{" "}
                    {task.owner?.name ?? "nicht zugewiesen"}
                  </span>
                </span>
                <span className="text-sm">
                  <Badge variant={task.dueAt <= now ? "destructive" : "outline"}>
                    {task.status}
                  </Badge>{" "}
                  fällig {formatDateTime(task.dueAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Worker, Retention-Lifecycle, Staging-Monitoring, Pager/Incident Owner
        und bestätigte RPO/RTO bleiben vor einem realen Betrieb separate
        Go-live-Gates.
      </section>
    </div>
  );
}

function StatusCard({
  href,
  label,
  value,
}: Readonly<{ href: string; label: string; value: string }>) {
  return (
    <article className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
      <Link
        className="mt-3 inline-block text-sm font-medium text-primary"
        href={href}
      >
        Endpoint prüfen →
      </Link>
    </article>
  );
}
