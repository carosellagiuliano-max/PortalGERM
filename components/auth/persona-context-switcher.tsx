"use client";

import { useActionState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import {
  FormFeedback,
  SubmitButton,
  formControlClassName,
} from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { switchPersonaContextAction } from "@/lib/auth/server-actions";
import type {
  PersonaCompanyOption,
  PersonaContextOption,
} from "@/lib/auth/persona-context";

export function PersonaContextSwitcher({
  activePortal,
  portals,
  companies,
  compact = false,
}: Readonly<{
  activePortal: "CANDIDATE" | "EMPLOYER" | "ADMIN";
  portals: readonly PersonaContextOption[];
  companies: readonly PersonaCompanyOption[];
  compact?: boolean;
}>) {
  const [state, action, pending] = useActionState(
    switchPersonaContextAction,
    INITIAL_AUTH_ACTION_STATE,
  );
  const alternatives = portals.filter(
    ({ portal, available }) => available && portal !== activePortal,
  );
  const locked = portals.filter(
    ({ state: portalState }) =>
      portalState === "SUSPENDED" || portalState === "REVOKED",
  );

  return (
    <section
      aria-labelledby="persona-context-title"
      className="grid min-w-0 gap-3 rounded-xl border bg-card p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            id="persona-context-title"
            className="text-xs text-muted-foreground"
          >
            Aktiver Arbeitsbereich
          </p>
          <p className="truncate text-sm font-medium">
            {portalLabel(activePortal)}
          </p>
        </div>
        <Badge variant="secondary">Aktiv</Badge>
      </div>

      <FormFeedback state={state} />

      {alternatives.map((option) => (
        <form
          action={action}
          className="grid min-w-0 gap-2"
          key={option.portal}
        >
          <input type="hidden" name="portal" value={option.portal} />
          <input
            type="hidden"
            name="next"
            value={defaultDestination(option.portal)}
          />
          {option.portal === "EMPLOYER" && companies.length > 1 ? (
            <div className="grid gap-2">
              <Label htmlFor={`persona-company-${activePortal}`}>
                Unternehmen für den Wechsel
              </Label>
              <select
                className={formControlClassName(false)}
                id={`persona-company-${activePortal}`}
                name="companyId"
                required
                defaultValue=""
              >
                <option disabled value="">
                  Unternehmen wählen
                </option>
                {companies.map((company) => (
                  <option key={company.companyId} value={company.companyId}>
                    {company.companyName} ·{" "}
                    {membershipRoleLabel(company.membershipRole)}
                  </option>
                ))}
              </select>
            </div>
          ) : option.portal === "EMPLOYER" && companies[0] !== undefined ? (
            <input
              type="hidden"
              name="companyId"
              value={companies[0].companyId}
            />
          ) : null}
          <SubmitButton
            pending={pending}
            idleLabel={`Zu ${option.label} wechseln`}
            pendingLabel="Kontext wird sicher geprüft …"
          />
        </form>
      ))}

      {!compact && alternatives.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Für diese Identität ist aktuell kein weiterer Arbeitsbereich
          freigegeben.
        </p>
      ) : null}

      {!compact && locked.length > 0 ? (
        <div className="grid gap-1 text-xs text-muted-foreground">
          {locked.map((option) => (
            <p key={option.portal}>
              {option.label}:{" "}
              {option.state === "SUSPENDED" ? "gesperrt" : "widerrufen"}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function portalLabel(portal: "CANDIDATE" | "EMPLOYER" | "ADMIN") {
  if (portal === "CANDIDATE") return "Kandidatenportal";
  if (portal === "EMPLOYER") return "Arbeitgeberportal";
  return "Administration";
}

function defaultDestination(
  portal: "CANDIDATE" | "EMPLOYER" | "ADMIN",
) {
  if (portal === "CANDIDATE") return "/candidate/dashboard";
  if (portal === "EMPLOYER") return "/employer/dashboard";
  return "/admin";
}

function membershipRoleLabel(
  role: PersonaCompanyOption["membershipRole"],
) {
  return {
    OWNER: "Inhaber:in",
    ADMIN: "Admin",
    RECRUITER: "Recruiter:in",
    VIEWER: "Leser:in",
  }[role];
}
