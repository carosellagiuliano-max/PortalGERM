import type { PrivateNavigationItem } from "@/components/auth/private-shell";

export const ADMIN_NAVIGATION: readonly PrivateNavigationItem[] = Object.freeze([
  { href: "/admin", label: "Übersicht" }, { href: "/admin/jobs", label: "Jobs" }, { href: "/admin/companies", label: "Unternehmen" }, { href: "/admin/users", label: "Benutzer" }, { href: "/admin/taxonomy", label: "Taxonomie" }, { href: "/admin/reports", label: "Reports" }, { href: "/admin/imports", label: "Importe" }, { href: "/admin/support", label: "Support" }, { href: "/admin/content", label: "Content" }, { href: "/admin/leads", label: "Leads" }, { href: "/admin/business-cockpit", label: "Business Cockpit" },
]);

export function AdminGlobalSearch() {
  return <form action="/admin" method="get" role="search" className="flex min-w-0 gap-2"><label className="sr-only" htmlFor="admin-global-search">Jobs, Firmen oder Benutzer suchen</label><input id="admin-global-search" name="q" type="search" placeholder="ID, Slug oder E-Mail" className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:w-64" /><button className="h-10 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted" type="submit">Suchen</button></form>;
}
