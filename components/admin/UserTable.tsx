import Link from "@/components/shared/app-link";

import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTable,
  ResponsiveTableCell,
} from "@/components/ui/responsive-table";

type UserRow = Readonly<{
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  companyMemberships: readonly Readonly<{
    company: Readonly<{
      subscriptions: readonly Readonly<{ id: string }>[];
    }>;
  }>[];
}>;

export function UserTable({ users }: Readonly<{ users: readonly UserRow[] }>) {
  if (users.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Keine Benutzer in dieser Auswahl.
      </p>
    );
  }

  return (
    <ResponsiveTable label="Benutzer und Kontostatus">
      <thead className="bg-muted/60">
        <tr>
          <th className="p-3">Benutzer</th>
          <th className="p-3">Rolle</th>
          <th className="p-3">Status</th>
          <th className="p-3">Abo</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {users.map((user) => (
          <tr key={user.id}>
            <ResponsiveTableCell className="p-3" label="Benutzer" primary>
              <Link
                className="font-medium text-primary underline"
                href={`/admin/users/${user.id}`}
              >
                {user.name ?? user.email}
              </Link>
              <p className="break-all text-xs text-muted-foreground">
                {user.email}
              </p>
            </ResponsiveTableCell>
            <ResponsiveTableCell className="p-3" label="Rolle">
              {user.role}
            </ResponsiveTableCell>
            <ResponsiveTableCell className="p-3" label="Status">
              <Badge
                variant={
                  user.status === "SUSPENDED" ? "destructive" : "outline"
                }
              >
                {user.status}
              </Badge>
            </ResponsiveTableCell>
            <ResponsiveTableCell className="p-3" label="Abo">
              {user.companyMemberships.some(
                (membership) =>
                  membership.company.subscriptions.length > 0,
              )
                ? "Aktiv"
                : "–"}
            </ResponsiveTableCell>
          </tr>
        ))}
      </tbody>
    </ResponsiveTable>
  );
}
