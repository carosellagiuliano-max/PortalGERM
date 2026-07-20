import type { Metadata } from "next";
import Link from "next/link";
import { SearchIcon } from "lucide-react";

import { CompanyCard } from "@/components/public/company-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listPublicCompanyDirectory } from "@/lib/companies/public-read-model";
import { getPublicCatalog, loadPublicOpenJobCounts } from "@/lib/jobs/public-read-model";

const COMPANIES_METADATA = Object.freeze({
  title: "Unternehmen",
  description: "Aktive öffentliche Unternehmensprofile und ihre aktuellen Stellen entdecken.",
});

export async function generateMetadata({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<Metadata> {
  const raw = await searchParams;
  const filtered = Boolean(
    bounded(first(raw.query), 120) ||
      safeSlug(first(raw.canton)) ||
      bounded(first(raw.industry), 160) ||
      first(raw.verified) === "true" ||
      first(raw.cursor),
  );
  return {
    ...COMPANIES_METADATA,
    alternates: { canonical: "/companies" },
    ...(filtered
      ? { robots: { index: false, follow: true, noarchive: true } }
      : {}),
  };
}

export default async function CompaniesPage({ searchParams }: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const raw = await searchParams;
  const query = bounded(first(raw.query), 120);
  const cantonSlug = safeSlug(first(raw.canton));
  const industry = bounded(first(raw.industry), 160);
  const verifiedOnly = first(raw.verified) === "true";
  const cursor = first(raw.cursor);
  const [directory, catalog] = await Promise.all([
    listPublicCompanyDirectory(
      { query, cantonSlug, industry, verifiedOnly, cursor, limit: 24 },
      loadPublicOpenJobCounts,
    ),
    getPublicCatalog(),
  ]);
  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Unternehmen</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Lerne Arbeitgeber kennen, bevor du dich bewirbst.</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Die Sichtbarkeit eines Profils folgt dem aktiven Firmenstatus. Eine Verifikation wird separat und transparent als Badge ausgewiesen.</p>
      <form action="/companies" method="get" className="mt-8 grid gap-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <label className="grid gap-1.5 text-sm font-medium">Firmenname <Input name="query" maxLength={120} defaultValue={query} placeholder="Unternehmen suchen" className="h-10" /></label>
        <label className="grid gap-1.5 text-sm font-medium">Kanton <select name="canton" defaultValue={cantonSlug ?? ""} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="">Alle Kantone</option>{catalog.cantons.map((canton) => <option key={canton.id} value={canton.slug}>{canton.name}</option>)}</select></label>
        <label className="grid gap-1.5 text-sm font-medium">Branche <Input name="industry" maxLength={160} defaultValue={industry} placeholder="z. B. Technologie" className="h-10" /></label>
        <div className="grid gap-3"><label className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><input type="checkbox" name="verified" value="true" defaultChecked={verifiedOnly} /> Nur verifiziert</label><Button type="submit"><SearchIcon aria-hidden="true" /> Suchen</Button></div>
      </form>
      <div className="mt-10"><p className="text-sm text-muted-foreground">Öffentliche Profile</p><h2 className="mt-1 text-2xl font-semibold">{directory.totalEligible} Unternehmen</h2></div>
      {directory.invalidCursor ? <p role="status" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">Der Seitenzeiger war ungültig. Wir zeigen dir die erste Seite.</p> : null}
      {directory.companies.length === 0 ? <div className="mt-6 rounded-xl border border-dashed bg-muted/25 p-10 text-center text-muted-foreground">Keine passenden öffentlichen Unternehmen gefunden. Passe die Filter an.</div> : <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{directory.companies.map((company) => <CompanyCard key={company.id} company={company} />)}</div>}
      {directory.nextCursor === null ? null : <div className="mt-8 flex justify-center"><Link href={companyDirectoryHref({ query, cantonSlug, industry, verifiedOnly, cursor: directory.nextCursor })} className={buttonVariants({ variant: "outline", size: "lg" })}>Weitere Unternehmen</Link></div>}
    </div>
  );
}

function first(value: string | string[] | undefined) { return typeof value === "string" ? value : value?.[0]; }
function bounded(value: string | undefined, maximum: number) { const normalized = value?.trim().normalize("NFKC"); return normalized && normalized.length <= maximum ? normalized : undefined; }
function safeSlug(value: string | undefined) { return value && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) ? value : undefined; }
function companyDirectoryHref(input: Readonly<{ query?: string; cantonSlug?: string; industry?: string; verifiedOnly: boolean; cursor: string }>) { const params = new URLSearchParams(); if (input.query) params.set("query", input.query); if (input.cantonSlug) params.set("canton", input.cantonSlug); if (input.industry) params.set("industry", input.industry); if (input.verifiedOnly) params.set("verified", "true"); params.set("cursor", input.cursor); return `/companies?${params.toString()}`; }
