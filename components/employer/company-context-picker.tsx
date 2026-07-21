import { Badge } from "@/components/ui/badge";
import { CompanyContextSwitcher } from "@/components/auth/company-context-switcher";
import type { EmployerMembershipContext } from "@/lib/auth/employer-context";

export function CompanyContextPicker({
  memberships,
  current,
  planLabel,
}: Readonly<{
  memberships: readonly EmployerMembershipContext[];
  current: EmployerMembershipContext | null;
  planLabel: string;
}>) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 sm:min-w-72">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Aktiver Firmenkontext</p>
          <p className="truncate text-sm font-medium">
            {current?.companyName ?? "Unternehmen wählen"}
          </p>
        </div>
        <Badge variant="secondary">{planLabel}</Badge>
      </div>
      {memberships.length > 1 ? (
        <CompanyContextSwitcher
          companies={memberships}
          currentCompanyId={current?.companyId}
        />
      ) : null}
    </div>
  );
}
