import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { SecurityActionForm } from "@/components/admin/security-action-form";
import { SecurityTabs } from "@/components/admin/security-tabs";
import { ADMIN_CAPABILITIES_V1, hasAdminCapability } from "@/lib/admin/capabilities";
import { listAdminSecurityGovernance } from "@/lib/admin/security-governance";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Break-glass" };

export default async function AdminBreakGlassPage() {
  const user = await requireAdminPage();
  if (
    !hasAdminCapability(
      { ...user, userId: user.id },
      "ADMIN_SECURITY_READ",
    )
  ) {
    forbidden();
  }
  const environment = getServerEnvironment();
  const model = await listAdminSecurityGovernance({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
    },
    correlationId: "admin-break-glass-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (model === null) forbidden();
  const pending = model.approvals.filter(
    (approval) => approval.kind === "BREAK_GLASS",
  );
  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Phase 25A · Incident Access</p>
        <h1 className="mt-2 text-3xl font-semibold">Break-glass</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Eng begrenzter Incidentzugriff: maximal acht Capabilities, maximal
          60 Minuten, unterschiedliche anfragende und freigebende Person,
          sofortiger Security-Task und vollständiges Audit.
        </p>
      </header>
      <SecurityTabs />
      <div
        className={
          environment.BREAK_GLASS_ENABLED
            ? "rounded-lg border border-emerald-500/40 p-4"
            : "rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
        }
        role="status"
      >
        <strong>
          {environment.BREAK_GLASS_ENABLED
            ? "Break-glass ist für diese Umgebung technisch freigegeben."
            : "Break-glass ist deaktiviert."}
        </strong>
        {!environment.BREAK_GLASS_ENABLED ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Ohne benannte getrennte Recovery-Owner, On-call und Alarm-Runbook
            bleibt jede Mutation serverseitig gesperrt.
          </p>
        ) : null}
      </div>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">Incidentzugriff anfragen</h2>
        <SecurityActionForm className="mt-4 grid gap-3">
          <input name="operation" type="hidden" value="break-glass-request" />
          <div className="grid gap-3 lg:grid-cols-4">
            <label className="grid gap-1 text-sm">
              Zielperson
              <select className="h-10 rounded-lg border bg-background px-3" name="userId">
                {model.adminUsers.map((admin) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name ?? admin.email} · {admin.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Incident-Referenz
              <input className="h-10 rounded-lg border bg-background px-3" name="incidentReference" placeholder="INC-2026-0042" required />
            </label>
            <label className="grid gap-1 text-sm">
              Laufzeit
              <select className="h-10 rounded-lg border bg-background px-3" defaultValue="30" name="durationMinutes">
                <option value="15">15 Minuten</option>
                <option value="30">30 Minuten</option>
                <option value="60">60 Minuten</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Reason-Code
              <input className="h-10 rounded-lg border bg-background px-3 font-mono" defaultValue="ACTIVE_SECURITY_INCIDENT" name="reasonCode" pattern="[A-Z][A-Z0-9_]{1,63}" required />
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">
              Maximal acht benötigte Capabilities
            </legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ADMIN_CAPABILITIES_V1.map((capability) => (
                <label className="flex min-w-0 items-start gap-2 rounded border p-2 text-xs" key={capability}>
                  <input className="mt-0.5" name="capabilities" type="checkbox" value={capability} />
                  <span className="min-w-0 break-all font-mono">{capability}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground justify-self-start" disabled={!environment.BREAK_GLASS_ENABLED} type="submit">
            Break-glass anfragen
          </button>
        </SecurityActionForm>
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Offene Freigaben</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Keine offene Break-glass-Anfrage.
          </p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((approval) => (
              <li className="rounded-xl border bg-card p-5" key={approval.id}>
                <p className="font-mono text-sm">
                  {breakGlassLabel(approval.requestPayload)}
                </p>
                <SecurityActionForm className="mt-3 flex flex-wrap items-end gap-3">
                  <input name="operation" type="hidden" value="break-glass-approve" />
                  <input name="approvalId" type="hidden" value={approval.id} />
                  <label className="grid gap-1 text-sm">
                    Approval-Reason
                    <input className="h-10 rounded-lg border bg-background px-3 font-mono" defaultValue="INCIDENT_ACCESS_APPROVED" name="reasonCode" pattern="[A-Z][A-Z0-9_]{1,63}" required />
                  </label>
                  <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" disabled={!environment.BREAK_GLASS_ENABLED} type="submit">
                    Unabhängig aktivieren
                  </button>
                </SecurityActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Aktive Incidentgrants</h2>
          <SecurityActionForm>
            <input name="operation" type="hidden" value="security-expiry-project" />
            <button className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" type="submit">
              Ablauf jetzt projizieren
            </button>
          </SecurityActionForm>
        </div>
        {model.breakGlass.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Kein aktiver Incidentzugriff.
          </p>
        ) : (
          <ul className="grid gap-3">
            {model.breakGlass.map((grant) => (
              <li className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5" key={grant.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{grant.incidentReference}</strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Ziel {grant.userId} · {grant.status} · bis{" "}
                      {formatDateTime(grant.validTo)}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs">
                      {grant.capabilities.join(" · ")}
                    </p>
                  </div>
                  <SecurityActionForm>
                    <input name="operation" type="hidden" value="break-glass-revoke" />
                    <input name="id" type="hidden" value={grant.id} />
                    <input name="reasonCode" type="hidden" value="INCIDENT_ACCESS_REVOKED" />
                    <button className="rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive" type="submit">
                      Sofort widerrufen
                    </button>
                  </SecurityActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function breakGlassLabel(payload: { kind: string; [key: string]: unknown }) {
  return payload.kind === "BREAK_GLASS"
    ? `${String(payload.incidentReference)} · Ziel ${String(payload.userId)} · bis ${String(payload.validTo)}`
    : "Ungültige oder nicht lesbare Anfrage";
}
