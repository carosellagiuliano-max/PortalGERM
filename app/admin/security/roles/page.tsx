import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { SecurityActionForm } from "@/components/admin/security-action-form";
import { SecurityTabs } from "@/components/admin/security-tabs";
import { Badge } from "@/components/ui/badge";
import { hasAdminCapability } from "@/lib/admin/capabilities";
import { listAdminSecurityGovernance } from "@/lib/admin/security-governance";
import { requireAdminPage } from "@/lib/auth/route-guards";
import { getDatabase } from "@/lib/db/client";
import { formatDateTime } from "@/lib/utils/format";

export const metadata: Metadata = { title: "Adminrollen" };

export default async function AdminSecurityRolesPage() {
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
    correlationId: "admin-security-roles-read",
    database: getDatabase(),
    now: new Date(),
  });
  if (model === null) forbidden();
  const pending = model.approvals.filter(
    (approval) => approval.kind === "ROLE_ASSIGNMENT",
  );

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Phase 25A · Least Privilege</p>
        <h1 className="mt-2 text-3xl font-semibold">Adminrollen</h1>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Die historische globale ADMIN-Rolle öffnet nur das interne Portal.
          Fachrechte stammen ausschließlich aus aktiven, persistierten und
          zeitlich begrenzten Rollen.
        </p>
      </header>
      <SecurityTabs />

      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-xl font-semibold">Rollenzuweisung beantragen</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Selbstgrant ist ausgeschlossen. Eine andere Person mit
          Security-Approval und frischer AAL2-Assurance muss entscheiden.
        </p>
        <SecurityActionForm className="mt-4 grid gap-3 lg:grid-cols-4">
          <input name="operation" type="hidden" value="role-request" />
          <SelectAdmin admins={model.adminUsers} name="userId" />
          <label className="grid gap-1 text-sm">
            Rolle
            <select
              className="h-10 rounded-lg border bg-background px-3"
              name="roleCode"
              required
            >
              {model.roles.map((role) => (
                <option key={role.id} value={role.code}>
                  {role.name} · {role.duty}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Gültigkeit
            <select
              className="h-10 rounded-lg border bg-background px-3"
              defaultValue="30"
              name="durationDays"
            >
              <option value="7">7 Tage</option>
              <option value="30">30 Tage</option>
              <option value="90">90 Tage</option>
              <option value="366">366 Tage</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Reason-Code
            <input
              className="h-10 rounded-lg border bg-background px-3 font-mono"
              defaultValue="ADMIN_ROLE_REQUIRED"
              name="reasonCode"
              pattern="[A-Z][A-Z0-9_]{1,63}"
              required
            />
          </label>
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground lg:col-span-4 lg:justify-self-start"
            type="submit"
          >
            Zuweisung anfragen
          </button>
        </SecurityActionForm>
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Geschlossener Rollenkatalog</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {model.roles.map((role) => (
            <article className="rounded-xl border bg-card p-5" key={role.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold">{role.name}</h3>
                <Badge variant="outline">{role.duty}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {role.description}
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {role.capabilities.map(({ capability }) => (
                  <li
                    className="rounded bg-muted px-2 py-1 font-mono text-xs"
                    key={capability}
                  >
                    {capability}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Offene Vier-Augen-Freigaben</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Keine offene Rollenzuweisung.
          </p>
        ) : (
          <ul className="grid gap-3">
            {pending.map((approval) => (
              <li className="rounded-xl border bg-card p-5" key={approval.id}>
                <p className="font-medium">
                  {approvalSummary(approval.requestPayload)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anfrage {approval.id} · läuft ab{" "}
                  {formatDateTime(approval.expiresAt)}
                </p>
                <SecurityActionForm className="mt-3 flex flex-wrap items-end gap-3">
                  <input
                    name="operation"
                    type="hidden"
                    value="role-approve"
                  />
                  <input
                    name="approvalId"
                    type="hidden"
                    value={approval.id}
                  />
                  <label className="grid gap-1 text-sm">
                    Approval-Reason
                    <input
                      className="h-10 rounded-lg border bg-background px-3 font-mono"
                      defaultValue="INDEPENDENT_SECURITY_APPROVAL"
                      name="reasonCode"
                      pattern="[A-Z][A-Z0-9_]{1,63}"
                      required
                    />
                  </label>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    type="submit"
                  >
                    Unabhängig freigeben
                  </button>
                </SecurityActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold">Aktive Rollenzuweisungen</h2>
        {model.assignments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Keine aktive Zuweisung.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border" role="region" aria-label="Aktive Adminrollen" tabIndex={0}>
            <table className="min-w-[58rem] text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-3">Person</th>
                  <th className="p-3">Rolle / Duty</th>
                  <th className="p-3">Gültigkeit</th>
                  <th className="p-3">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {model.assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td className="p-3">
                      {assignment.user.name ?? assignment.user.email}
                      <p className="text-xs text-muted-foreground">
                        {assignment.user.email} · {assignment.user.status}
                      </p>
                    </td>
                    <td className="p-3">
                      {assignment.adminRole.name}
                      <p className="font-mono text-xs text-muted-foreground">
                        {assignment.adminRole.code} ·{" "}
                        {assignment.adminRole.duty}
                      </p>
                    </td>
                    <td className="p-3">
                      {formatDateTime(assignment.validFrom)} –{" "}
                      {formatDateTime(assignment.validTo)}
                    </td>
                    <td className="p-3">
                      <SecurityActionForm>
                        <input
                          name="operation"
                          type="hidden"
                          value="role-revoke"
                        />
                        <input
                          name="id"
                          type="hidden"
                          value={assignment.id}
                        />
                        <input
                          name="reasonCode"
                          type="hidden"
                          value="ADMIN_ROLE_REVOKED"
                        />
                        <button
                          className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
                          type="submit"
                        >
                          Sofort widerrufen
                        </button>
                      </SecurityActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SelectAdmin({
  admins,
  name,
}: Readonly<{
  admins: readonly {
    id: string;
    name: string | null;
    email: string;
    status: string;
  }[];
  name: string;
}>) {
  return (
    <label className="grid gap-1 text-sm">
      Adminperson
      <select
        className="h-10 rounded-lg border bg-background px-3"
        name={name}
        required
      >
        {admins.map((admin) => (
          <option key={admin.id} value={admin.id}>
            {admin.name ?? admin.email} · {admin.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function approvalSummary(payload: { kind: string; [key: string]: unknown }) {
  return payload.kind === "ROLE_ASSIGNMENT"
    ? `${String(payload.roleCode)} für ${String(payload.userId)} bis ${String(payload.validTo)}`
    : "Ungültige oder nicht lesbare Anfrage";
}
