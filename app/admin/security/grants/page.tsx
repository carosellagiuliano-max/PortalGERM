import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { SecurityActionForm } from "@/components/admin/security-action-form";
import { SecurityTabs } from "@/components/admin/security-tabs";
import { ADMIN_CAPABILITIES_V1, hasAdminCapability } from "@/lib/admin/capabilities";
import { listAdminSecurityGovernance } from "@/lib/admin/security-governance";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

const DUTIES = [
  "PLATFORM",
  "SECURITY",
  "SUPPORT",
  "MODERATION",
  "FINANCE",
  "PRIVACY_VERIFY",
  "PRIVACY_PROCESS",
  "CONTENT_SUPPLY",
  "TRUST_SAFETY",
] as const;

export const metadata: Metadata = { title: "Admin-Direktgrants" };

export default async function AdminSecurityGrantsPage() {
  const user = await requireAdminPage();
  if (
    !hasAdminCapability(
      { ...user, userId: user.id },
      "ADMIN_SECURITY_READ",
    )
  ) {
    forbidden();
  }
  const model = await listAdminSecurityGovernance({
    actor: {
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      capabilities: user.capabilities,
    },
    correlationId: "admin-security-grants-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (model === null) forbidden();
  const pendingGrants = model.approvals.filter(
    (approval) => approval.kind === "DIRECT_CAPABILITY_GRANT",
  );
  const pendingResets = model.approvals.filter(
    (approval) => approval.kind === "AUTHENTICATOR_RESET",
  );

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Phase 25A · Bounded Access</p>
        <h1 className="mt-2 text-3xl font-semibold">
          Direktgrants und Geräteverlust
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Direktgrants sind Ausnahmen mit maximal 30 Tagen Laufzeit. Geräte-
          Resets widerrufen Faktoren, Recovery-Codes, Sessions und offene
          Step-up-Nachweise atomar.
        </p>
      </header>
      <SecurityTabs />

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">Capability-Grant beantragen</h2>
        <SecurityActionForm className="mt-4 grid gap-3 lg:grid-cols-5">
          <input name="operation" type="hidden" value="capability-request" />
          <AdminSelect admins={model.adminUsers} />
          <label className="grid gap-1 text-sm">
            Capability
            <select className="h-10 rounded-lg border bg-background px-3" name="capability">
              {ADMIN_CAPABILITIES_V1.map((capability) => (
                <option key={capability}>{capability}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Duty
            <select className="h-10 rounded-lg border bg-background px-3" name="duty">
              {DUTIES.map((duty) => (
                <option key={duty}>{duty}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Gültigkeit
            <select className="h-10 rounded-lg border bg-background px-3" defaultValue="7" name="durationDays">
              <option value="1">1 Tag</option>
              <option value="7">7 Tage</option>
              <option value="30">30 Tage</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Reason-Code
            <input className="h-10 rounded-lg border bg-background px-3 font-mono" defaultValue="BOUNDED_EXCEPTION_REQUIRED" name="reasonCode" pattern="[A-Z][A-Z0-9_]{1,63}" required />
          </label>
          <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground lg:col-span-5 lg:justify-self-start" type="submit">
            Direktgrant anfragen
          </button>
        </SecurityActionForm>
      </section>

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">Admin-MFA-Reset beantragen</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Nur für verifizierten Geräteverlust. Die betroffene Person kann den
          eigenen Reset nicht anfragen oder freigeben.
        </p>
        <SecurityActionForm className="mt-4 flex flex-wrap items-end gap-3">
          <input name="operation" type="hidden" value="authenticator-reset-request" />
          <AdminSelect admins={model.adminUsers} />
          <label className="grid gap-1 text-sm">
            Reason-Code
            <input className="h-10 rounded-lg border bg-background px-3 font-mono" defaultValue="VERIFIED_DEVICE_LOSS" name="reasonCode" pattern="[A-Z][A-Z0-9_]{1,63}" required />
          </label>
          <button className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted" type="submit">
            Reset anfragen
          </button>
        </SecurityActionForm>
      </section>

      <ApprovalList
        approvals={pendingGrants}
        operation="capability-approve"
        title="Offene Direktgrant-Freigaben"
      />
      <ApprovalList
        approvals={pendingResets}
        operation="authenticator-reset-approve"
        title="Offene MFA-Reset-Freigaben"
      />

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Aktive Direktgrants</h2>
        {model.directGrants.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Keine aktive Ausnahme.
          </p>
        ) : (
          <ul className="grid gap-3">
            {model.directGrants.map((grant) => (
              <li className="rounded-xl border bg-card p-5" key={grant.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{grant.capability}</strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {grant.user.name ?? grant.user.email} · {grant.duty} · bis{" "}
                      {formatDateTime(grant.validTo)}
                    </p>
                  </div>
                  <SecurityActionForm>
                    <input name="operation" type="hidden" value="capability-revoke" />
                    <input name="id" type="hidden" value={grant.id} />
                    <input name="reasonCode" type="hidden" value="DIRECT_GRANT_REVOKED" />
                    <button className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted" type="submit">
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

function AdminSelect({
  admins,
}: Readonly<{
  admins: readonly { id: string; name: string | null; email: string; status: string }[];
}>) {
  return (
    <label className="grid gap-1 text-sm">
      Adminperson
      <select className="h-10 rounded-lg border bg-background px-3" name="userId">
        {admins.map((admin) => (
          <option key={admin.id} value={admin.id}>
            {admin.name ?? admin.email} · {admin.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function ApprovalList({
  approvals,
  operation,
  title,
}: Readonly<{
  approvals: readonly {
    id: string;
    kind: string;
    requestPayload: { kind: string; [key: string]: unknown };
    expiresAt: Date;
  }[];
  operation: string;
  title: string;
}>) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {approvals.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Keine offene Anfrage.
        </p>
      ) : (
        <ul className="grid gap-3">
          {approvals.map((approval) => (
            <li className="rounded-xl border bg-card p-5" key={approval.id}>
              <p className="font-mono text-sm">
                {safePayloadLabel(approval.requestPayload)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Läuft ab {formatDateTime(approval.expiresAt)}
              </p>
              <SecurityActionForm className="mt-3 flex flex-wrap items-end gap-3">
                <input name="operation" type="hidden" value={operation} />
                <input name="approvalId" type="hidden" value={approval.id} />
                <label className="grid gap-1 text-sm">
                  Approval-Reason
                  <input className="h-10 rounded-lg border bg-background px-3 font-mono" defaultValue="INDEPENDENT_SECURITY_APPROVAL" name="reasonCode" pattern="[A-Z][A-Z0-9_]{1,63}" required />
                </label>
                <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" type="submit">
                  Unabhängig freigeben
                </button>
              </SecurityActionForm>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function safePayloadLabel(payload: { kind: string; [key: string]: unknown }) {
  if (payload.kind === "DIRECT_CAPABILITY_GRANT") {
    return `${String(payload.capability)} · ${String(payload.duty)} · Ziel ${String(payload.userId)}`;
  }
  if (payload.kind === "AUTHENTICATOR_RESET") {
    return `MFA-Reset · Ziel ${String(payload.userId)}`;
  }
  return "Ungültige oder nicht lesbare Anfrage";
}
