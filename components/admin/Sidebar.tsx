import type { PrivateNavigationItem } from "@/components/auth/private-shell";
import type { AdminCapability } from "@/lib/admin/capabilities";

type CapabilityNavigationItem = PrivateNavigationItem &
  Readonly<{ capabilities?: readonly AdminCapability[] }>;

export const ADMIN_NAVIGATION: readonly CapabilityNavigationItem[] = Object.freeze(
  [
    { href: "/admin", label: "Übersicht", capabilities: ["ADMIN_OVERVIEW_READ"] },
    { href: "/admin/jobs", label: "Jobs", capabilities: ["ADMIN_JOB_REVIEW"] },
    { href: "/admin/companies", label: "Unternehmen", capabilities: ["ADMIN_COMPANY_REVIEW", "ADMIN_COMPANY_MODERATE"] },
    { href: "/admin/company-verification", label: "Firmenprüfungen", capabilities: ["COMPANY_VERIFICATION_REVIEW", "COMPANY_VERIFICATION_APPROVE"] },
    { href: "/admin/users", label: "Benutzer", capabilities: ["ADMIN_USER_MODERATE"] },
    { href: "/admin/taxonomy", label: "Taxonomie", capabilities: ["ADMIN_TAXONOMY_MANAGE"] },
    { href: "/admin/reports", label: "Reports", capabilities: ["ADMIN_REPORT_REVIEW", "TRUST_SAFETY_REVIEW"] },
    { href: "/admin/privacy-requests", label: "Datenschutzfälle", capabilities: ["PRIVACY_CASE_READ"] },
    { href: "/admin/legal", label: "Legal & Gates", capabilities: ["ADMIN_LEGAL_READ"] },
    { href: "/admin/imports", label: "Importe", capabilities: ["ADMIN_LICENSED_IMPORT"] },
    { href: "/admin/support", label: "Support", capabilities: ["ADMIN_SUPPORT_MANAGE"] },
    { href: "/admin/content", label: "Content", capabilities: ["ADMIN_CONTENT_MANAGE"] },
    { href: "/admin/leads", label: "Leads", capabilities: ["ADMIN_LEAD_MANAGE"] },
    { href: "/admin/billing", label: "Billing", capabilities: ["ADMIN_BILLING_READ"] },
    { href: "/admin/finance/reconciliation", label: "Finance Ops", capabilities: ["ADMIN_BILLING_READ"] },
    { href: "/admin/plans", label: "Pläne", capabilities: ["ADMIN_CATALOG_READ"] },
    { href: "/admin/products", label: "Produkte", capabilities: ["ADMIN_CATALOG_READ"] },
    { href: "/admin/analytics", label: "Analytics", capabilities: ["ADMIN_ANALYTICS_READ"] },
    { href: "/admin/business-cockpit", label: "Business Cockpit", capabilities: ["ADMIN_COCKPIT_READ"] },
    { href: "/admin/audit", label: "Audit", capabilities: ["ADMIN_AUDIT_READ"] },
    {
      href: "/admin/security/authenticators",
      label: "Security & Zugriffe",
      capabilities: ["ADMIN_SECURITY_READ"],
    },
    { href: "/admin/trust-safety", label: "Trust & Safety", capabilities: ["TRUST_SAFETY_READ"] },
    { href: "/admin/system", label: "System", capabilities: ["ADMIN_OPS_READ"] },
  ],
);

export function getAdminNavigation(
  capabilities: readonly AdminCapability[],
): readonly PrivateNavigationItem[] {
  return ADMIN_NAVIGATION.filter(
    (item) =>
      item.capabilities === undefined ||
      item.capabilities.some((capability) => capabilities.includes(capability)),
  ).map(({ href, label }) => ({ href, label }));
}

export function AdminGlobalSearch({
  enabled = true,
}: Readonly<{ enabled?: boolean }>) {
  if (!enabled) return null;
  return (
    <form
      action="/admin"
      method="get"
      role="search"
      className="flex min-w-0 gap-2"
    >
      <label className="sr-only" htmlFor="admin-global-search">
        Jobs, Firmen oder Benutzer suchen
      </label>
      <input
        id="admin-global-search"
        name="q"
        type="search"
        placeholder="ID, Slug oder E-Mail"
        className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:w-64"
      />
      <button
        className="h-10 rounded-lg border bg-background px-3 text-sm font-medium hover:bg-muted"
        type="submit"
      >
        Suchen
      </button>
    </form>
  );
}
