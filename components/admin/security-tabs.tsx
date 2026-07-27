import Link from "next/link";

const items = [
  { href: "/admin/security/roles", label: "Rollen" },
  { href: "/admin/security/grants", label: "Direktgrants & Reset" },
  { href: "/admin/security/authenticators", label: "Eigene MFA" },
  { href: "/admin/security/break-glass", label: "Break-glass" },
] as const;

export function SecurityTabs() {
  return (
    <nav aria-label="Security-Verwaltung" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          className="rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
