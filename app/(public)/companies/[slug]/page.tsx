import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, BadgeCheckIcon, Building2Icon, ExternalLinkIcon, MapPinIcon, ShieldQuestionIcon } from "lucide-react";

import { JobGrid } from "@/components/public/job-grid";
import { ReportForm } from "@/components/public/report-form";
import { ResponseSignal } from "@/components/public/response-signal";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { signCompanyClaimIntent } from "@/lib/auth/company-claim-intent";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPublicCompanyDetailBySlug } from "@/lib/companies/public-read-model";
import { getServerEnvironment } from "@/lib/config/env";
import { listPublicJobsForCompany } from "@/lib/jobs/public-read-model";
import { getPublicDataContext } from "@/lib/public/environment";

const getCompany = cache((slug: string) => getPublicCompanyDetailBySlug(slug, listPublicJobsForCompany));

export async function generateMetadata({ params }: CompanyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (company === null) return { title: "Unternehmen nicht gefunden" };
  const description = company.about?.slice(0, 155) ?? `${company.name}: öffentliches Unternehmensprofil und aktuelle Stellen.`;
  const indexable = getPublicDataContext().publicIndexingAllowed && company.dataProvenance === "LIVE";
  return {
    title: company.name,
    description,
    alternates: { canonical: `/companies/${company.slug}` },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true, nosnippet: true },
  };
}

export default async function CompanyDetailPage({ params }: CompanyPageProps) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (company === null) notFound();
  const currentUser = await getCurrentUser();
  const claimHref = currentUser === null ? buildCompanyClaimHref(company.slug) : null;

  return (
    <div className="page-shell py-10 sm:py-14">
      <Link href="/companies" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"><ArrowLeftIcon className="size-4" aria-hidden="true" /> Zu den Unternehmen</Link>
      <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div>
          <span className="grid size-12 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Building2Icon className="size-6" aria-hidden="true" /></span>
          <div className="mt-5 flex flex-wrap items-center gap-3"><h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">{company.name}</h1>{company.verified ? <Badge variant="secondary"><BadgeCheckIcon aria-hidden="true" /> Verifiziert</Badge> : null}</div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
            {company.industry === null ? null : <span>{company.industry}</span>}
            {company.city === null && company.canton === null ? null : <span className="inline-flex items-center gap-1.5"><MapPinIcon className="size-4" aria-hidden="true" />{[company.city, company.canton].filter(Boolean).join(", ")}</span>}
            {company.size === null ? null : <span>{company.size} Mitarbeitende</span>}
          </div>
        </div>
        <aside className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-semibold">Gehört diese Firma zu dir?</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Starte einen kontrollierten Firmenanspruch. Der Einstieg verleiht weder Eigentum noch Zugriff.</p>
          {claimHref !== null ? (
            <Link href={claimHref} className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}><ShieldQuestionIcon aria-hidden="true" /> Firma beanspruchen</Link>
          ) : currentUser?.role === "EMPLOYER" || currentUser?.role === "RECRUITER" ? (
            <Link href="/employer/dashboard" className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}>Zum Arbeitgeberportal</Link>
          ) : currentUser?.role === "ADMIN" ? (
            <Link href="/admin" className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}>Zur Administration</Link>
          ) : (
            <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">Ein Firmenanspruch benötigt einen separaten Arbeitgeberzugang.</p>
          )}
          {company.website === null ? null : <a href={company.website} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", className: "mt-2 w-full" })}>Website besuchen <ExternalLinkIcon data-icon="inline-end" /></a>}
        </aside>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <article className="grid gap-8">
          <section><h2 className="text-2xl font-semibold">Über {company.name}</h2><p className="mt-4 whitespace-pre-line leading-7 text-muted-foreground">{company.about ?? "Dieses Unternehmen hat noch keine öffentliche Beschreibung hinterlegt."}</p></section>
          {company.enhancedProfile && company.values.length > 0 ? <TextList title="Werte" values={company.values} /> : null}
          {company.enhancedProfile && company.benefits.length > 0 ? <TextList title="Benefits" values={company.benefits} /> : null}
        </article>
        <aside className="grid gap-5">
          <Card><CardHeader><CardTitle as="h2">Antwortsignal</CardTitle></CardHeader><CardContent className="text-sm leading-6"><ResponseSignal response={company.response} /></CardContent></Card>
          <ReportForm targetType="COMPANY" slug={company.slug} />
        </aside>
      </div>

      <section className="mt-14 border-t pt-12" aria-labelledby="company-jobs-title">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Aktuelle Stellen</p><h2 id="company-jobs-title" className="mt-2 text-3xl font-semibold">Jobs bei {company.name}</h2></div><Badge variant="outline">{company.openJobCount} offen</Badge></div>
        <div className="mt-7"><JobGrid jobs={company.jobs} emptyText="Dieses Unternehmen hat aktuell keine öffentlich verfügbaren Stellen." /></div>
      </section>
    </div>
  );
}

type CompanyPageProps = Readonly<{ params: Promise<{ slug: string }> }>;

function buildCompanyClaimHref(companySlug: string): string {
  const environment = getServerEnvironment();
  const claimIntent = signCompanyClaimIntent(
    { companySlug, now: new Date() },
    environment.secrets.session,
  );
  return `/register/employer?claim=${encodeURIComponent(companySlug)}&intent=${encodeURIComponent(claimIntent)}`;
}

function TextList({ title, values }: Readonly<{ title: string; values: readonly string[] }>) {
  return <section><h2 className="text-2xl font-semibold">{title}</h2><ul className="mt-4 grid gap-3 sm:grid-cols-2">{values.map((value, index) => <li key={`${index}-${value}`} className="rounded-lg border bg-card p-4 leading-6 text-muted-foreground">{value}</li>)}</ul></section>;
}
