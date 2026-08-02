"use client";

import { useActionState } from "react";

import { INITIAL_AUTH_ACTION_STATE } from "@/components/auth/auth-action-state";
import {
  FormFeedback,
  SubmitButton,
  formControlClassName,
} from "@/components/auth/form-parts";
import { Label } from "@/components/ui/label";
import { switchCompanyContextAction } from "@/lib/auth/server-actions";

export type CompanyContextOption = Readonly<{
  companyId: string;
  companyName: string;
  membershipRole: "OWNER" | "ADMIN" | "RECRUITER" | "VIEWER";
}>;

export function CompanyContextSwitcher({
  companies,
  currentCompanyId,
}: Readonly<{
  companies: readonly CompanyContextOption[];
  currentCompanyId?: string;
}>) {
  const [state, formAction, pending] = useActionState(
    switchCompanyContextAction,
    INITIAL_AUTH_ACTION_STATE,
  );

  return (
    <form action={formAction} className="grid min-w-0 gap-4">
      <input type="hidden" name="next" value="/employer/dashboard" />
      <FormFeedback state={state} />
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="company-context">Aktives Unternehmen</Label>
        <div className="min-w-0 w-full max-w-full overflow-hidden rounded-lg focus-within:ring-3 focus-within:ring-ring/50">
          <select
            id="company-context"
            name="companyId"
            required
            defaultValue={currentCompanyId ?? ""}
            className={`${formControlClassName(false)} min-w-0 max-w-full overflow-hidden text-ellipsis focus-visible:ring-0`}
          >
            <option value="" disabled>
              Unternehmen wählen
            </option>
            {companies.map((company) => (
              <option key={company.companyId} value={company.companyId}>
                {company.companyName} · {membershipRoleLabel(company.membershipRole)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <SubmitButton
        pending={pending}
        idleLabel="Firmenkontext wechseln"
        pendingLabel="Kontext wird geprüft …"
      />
    </form>
  );
}

function membershipRoleLabel(role: CompanyContextOption["membershipRole"]) {
  return {
    OWNER: "Inhaber:in",
    ADMIN: "Admin",
    RECRUITER: "Recruiter:in",
    VIEWER: "Leser:in",
  }[role];
}
