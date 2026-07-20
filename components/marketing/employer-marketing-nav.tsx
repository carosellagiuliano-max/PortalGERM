import Link from "next/link";

const employerLinks = [
  { href: "/employers", label: "Überblick" },
  { href: "/employers/post-job", label: "Inserat" },
  { href: "/employers/talent-radar", label: "Talent Radar" },
  { href: "/employers/employer-branding", label: "Firmenprofil" },
  { href: "/employers/xml-import", label: "Import" },
  { href: "/employers/demo", label: "Demo" },
] as const;

export function EmployerMarketingNav() {
  return (
    <nav
      aria-label="Arbeitgeber-Angebot"
      className="border-b bg-muted/25"
    >
      <ul className="page-shell grid grid-cols-2 gap-1 py-2 min-[540px]:flex min-[540px]:flex-wrap">
        {employerLinks.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="inline-flex min-h-11 w-full items-center rounded-md px-3 text-sm font-medium text-muted-foreground underline-offset-4 hover:bg-background hover:text-foreground hover:underline focus-visible:bg-background min-[540px]:w-auto"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
