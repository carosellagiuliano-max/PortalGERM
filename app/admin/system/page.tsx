import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { listOpenSystemTasks } from "@/lib/admin/system-governance";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { getNotificationDeliverySummary } from "@/lib/notifications/admin-read";
import { getRedactedDocumentVaultSummary } from "@/lib/documents/admin-read";
import { resolveDocumentRuntime } from "@/lib/documents/runtime-policy";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Systemstatus" };

const providers = [
  ["Zahlung", "Lokaler persistierender Mock"],
  ["KI", "Deterministischer Regel-Mock"],
  ["Job-Room", "Versionierter lokaler Lookup"],
  ["Pendeldistanz", "Deterministische lokale Klasse"],
] as const;

export default async function AdminSystemPage() {
  const admin = await requireAdminPage();
  const now = new Date();
  const database = getDatabase();
  const dependencies = {
    actor: {
      userId: admin.id,
      email: admin.email,
      role: admin.role,
      status: admin.status,
    },
    correlationId: "admin-system-read",
    database,
    now,
  } as const;
  const [tasks, delivery, documents] = await Promise.all([
    listOpenSystemTasks(dependencies),
    getNotificationDeliverySummary(dependencies),
    getRedactedDocumentVaultSummary(database),
  ]);
  if (tasks === null || delivery === null) return null;
  const environment = getServerEnvironment();
  const documentRuntime = resolveDocumentRuntime(environment);

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
          Kein Provider wird implizit aktiviert und es gibt keinen
          Real→Mock-Fallback. Der E-Mail-Adapter bleibt ohne externe
          Freigaben höchstens Sandbox.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <article className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">E-Mail</h3>
              <Badge variant="outline">
                {environment.EMAIL_PROVIDER_MODE === "disabled"
                  ? "DISABLED"
                  : "SANDBOX"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Provider {environment.EMAIL_PROVIDER_MODE}; Dispatch{" "}
              {environment.NOTIFICATION_DISPATCH}. Keine LIVE-Zustellung und
              kein autonomer Worker werden behauptet.
            </p>
          </article>
          <article className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Dokumenten-Vault</h3>
              <Badge variant="outline">
                {documentRuntime.available ? "SANDBOX" : "DISABLED"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Storage {environment.DOCUMENT_STORAGE_MODE}; Scanner{" "}
              {environment.DOCUMENT_SCANNER_MODE}; Clean Reads{" "}
              {environment.DOCUMENT_CLEAN_READS ? "TEST" : "OFF"}. Kein
              LIVE-Provider und kein Real→Mock-Fallback.
            </p>
          </article>
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

      <section aria-labelledby="document-vault-heading">
        <h2 id="document-vault-heading" className="text-xl font-semibold">
          Dokumenten-Vault (redigiert)
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ausschliesslich Zustandszähler. Dateinamen, Object Keys, Hashes,
          Scannerpayloads und Inhalte werden hier nicht ausgegeben.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Aktive Upload-Intents</p>
            <p className="mt-2 text-2xl font-semibold">
              {documents.pendingIntents}
            </p>
          </article>
          {Object.entries(documents.statuses).map(([status, count]) => (
            <article className="rounded-lg border bg-card p-4" key={status}>
              <p className="text-sm text-muted-foreground">{status}</p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </article>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Scanner-Outcomes</h3>
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {Object.entries(documents.scanOutcomes).length === 0 ? (
                <li>Keine Scan-Evidenz.</li>
              ) : (
                Object.entries(documents.scanOutcomes).map(([outcome, count]) => (
                  <li key={outcome}>
                    {outcome}: {count}
                  </li>
                ))
              )}
            </ul>
          </article>
          <article className="rounded-lg border bg-card p-4">
            <h3 className="font-medium">Reconciliation-Outcomes</h3>
            <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
              {documents.lifecycle.length === 0 ? (
                <li>Noch kein Command-Lauf.</li>
              ) : (
                documents.lifecycle.map((item) => (
                  <li key={`${item.kind}:${item.status}`}>
                    {item.kind} / {item.status}: {item.count}
                  </li>
                ))
              )}
            </ul>
          </article>
        </div>
      </section>

      <section aria-labelledby="notification-delivery-heading">
        <h2 id="notification-delivery-heading" className="text-xl font-semibold">
          Benachrichtigungszustellung
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Redigierte Zähler ohne Empfänger, Payload, Token oder
          Template-Inhalt. Production-Replay bleibt bis zum Phase-25-Step-up
          gesperrt.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(delivery.statuses).map(([status, count]) => (
            <article className="rounded-lg border bg-card p-4" key={status}>
              <p className="text-sm text-muted-foreground">
                {deliveryStatusLabel(status)}
              </p>
              <p className="mt-2 text-2xl font-semibold">{count}</p>
            </article>
          ))}
          <article className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Hard Bounces</p>
            <p className="mt-2 text-2xl font-semibold">{delivery.bounced}</p>
          </article>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Älteste offene Nachricht:{" "}
          {delivery.oldestQueuedAt === null
            ? "keine"
            : formatDateTime(delivery.oldestQueuedAt)}
        </p>
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

function deliveryStatusLabel(status: string) {
  return (
    {
      PENDING: "Ausstehend",
      LEASED: "In Verarbeitung",
      RETRY: "Wiederholung geplant",
      DELIVERED: "Angenommen",
      SUPPRESSED: "Unterdrückt / Bounce",
      DEAD_LETTER: "DLQ",
      PAUSED: "Provider degradiert / pausiert",
    }[status] ?? status
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
