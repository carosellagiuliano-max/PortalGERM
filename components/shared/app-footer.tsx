import Link from "next/link";

const discoveryLinks = [
  { href: "/jobs", label: "Jobs entdecken" },
  { href: "/companies", label: "Unternehmen" },
  { href: "/salary-radar", label: "Lohn-Radar" },
  { href: "/guide", label: "Ratgeber" },
] as const;

const accountLinks = [
  { href: "/register/candidate", label: "Kandidatenkonto" },
  { href: "/register/employer", label: "Arbeitgeberkonto" },
  { href: "/login", label: "Login" },
] as const;

const employerLinks = [
  { href: "/employers", label: "Für Arbeitgeber" },
  { href: "/pricing", label: "Preise" },
  { href: "/employers/post-job", label: "Inserat erklären" },
  { href: "/employers/talent-radar", label: "Talent Radar" },
  { href: "/employers/employer-branding", label: "Arbeitgeberprofil" },
  { href: "/employers/xml-import", label: "Import" },
  { href: "/employers/demo", label: "Demo anfragen" },
] as const;

export function AppFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/35">
      <div className="page-shell py-10 sm:py-12">
        <div className="grid gap-9 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr_1.15fr]">
          <div>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center font-semibold tracking-tight"
            >
              SwissTalentHub
            </Link>
            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              Faire Jobtransparenz, verständliche Lohnorientierung und sichere
              Zugänge für Kandidat:innen und Arbeitgeber.
            </p>
          </div>

          <FooterNavigation
            id="footer-discovery"
            title="Entdecken"
            links={discoveryLinks}
          />
          <FooterNavigation
            id="footer-account"
            title="Konto"
            links={accountLinks}
          />
          <FooterNavigation
            id="footer-employers"
            title="Arbeitgeber"
            links={employerLinks}
          />

          <div>
            <h2 className="text-sm font-semibold text-foreground">Vertrauen</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
              <li>Erklärbarer Fair-Job-Score</li>
              <li>Demo-Daten klar gekennzeichnet</li>
              <li>Keine Tracking-Pixel</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t pt-6 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p>DE-CH · Schweizer Franken (CHF)</p>
          <p className="max-w-2xl sm:text-right">
            Datenschutzfreundlich vorbereitet. Lohn- und Fairnessangaben dienen der
            Orientierung und sind keine Rechts-, Finanz- oder Lohnberatung.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterNavigation({
  id,
  title,
  links,
}: Readonly<{
  id: string;
  title: string;
  links: readonly Readonly<{ href: string; label: string }>[];
}>) {
  return (
    <nav aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold text-foreground">
        {title}
      </h2>
      <ul className="mt-2 grid text-sm text-muted-foreground">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
