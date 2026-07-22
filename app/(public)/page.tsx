import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  BarChart3Icon,
  BookOpenTextIcon,
  Building2Icon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";

import { CompanyCard } from "@/components/public/company-card";
import { JobCard } from "@/components/public/job-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listPublicGuides } from "@/lib/content/public-guides";
import { listPublicCompanies } from "@/lib/companies/public-read-model";
import { getPublicCatalog, listHomepageJobs, listPublicClusterLinks, loadPublicOpenJobCounts } from "@/lib/jobs/public-read-model";
import { listIndexableClusterLandings } from "@/lib/seo/cluster-indexability";

export const metadata: Metadata = {
  title: "Faire Jobs in der Schweiz",
  description: "Transparente Stellen, verifizierte Unternehmen und nachvollziehbare Lohninformationen für die Schweiz.",
  alternates: { canonical: "/" },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const now = new Date();
  const [jobs, discoveredClusters, indexableLandings, guides, companies, catalog] = await Promise.all([
    listHomepageJobs({ limit: 6, now }),
    listPublicClusterLinks({ limit: 8, now }),
    listIndexableClusterLandings(now),
    listPublicGuides({ limit: 3 }),
    listPublicCompanies({ limit: 8, verifiedOnly: true }, loadPublicOpenJobCounts),
    getPublicCatalog(),
  ]);
  const acquisitionPaths = new Set(indexableLandings.map(({ path }) => path));
  const clusters = discoveredClusters.filter((cluster) =>
    acquisitionPaths.has(
      `/jobs/${cluster.kind === "canton" ? "kanton" : "kategorie"}/${cluster.slug}`,
    )
  );

  return (
    <>
      <section className="page-shell grid gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)] lg:items-center">
        <div className="max-w-3xl">
          <Badge variant="secondary" className="mb-5">Faire Jobs · klare Fakten</Badge>
          <p className="eyebrow mb-4">SwissTalentHub</p>
          <h1 className="text-balance text-4xl leading-[1.06] font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
            Finde nicht irgendeinen Job. Finde den Job, der wirklich passt.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Vergleiche Lohn, Pensum, Arbeitsmodell und Bewerbungsaufwand in den aktuell bedienten de-CH-Clustern. Öffentliche Stellen stammen ausschliesslich aus geprüften Publikationsständen.
          </p>
          <form action="/jobs" method="get" className="mt-8 grid max-w-3xl gap-3 rounded-xl border bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            <label className="sm:col-span-2 lg:col-span-3"><span className="sr-only">Stichwort suchen</span><input id="home-job-search" name="keyword" maxLength={120} placeholder="Beruf, Fähigkeit oder Firma" className="h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50" /></label>
            <label><span className="sr-only">Kanton</span><select name="canton" defaultValue="" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Kanton wählen</option>{catalog.cantons.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
            <label><span className="sr-only">Kategorie</span><select name="category" defaultValue="" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Kategorie wählen</option>{catalog.categories.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
            <label><span className="sr-only">Pensum</span><select name="workload" defaultValue="" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Pensum wählen</option><option value="40-60">40–60%</option><option value="60-80">60–80%</option><option value="80-100">80–100%</option><option value="100">100%</option></select></label>
            <label><span className="sr-only">Arbeitsmodell</span><select name="remote" defaultValue="" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"><option value="">Arbeitsmodell</option><option value="ONSITE">Vor Ort</option><option value="HYBRID">Hybrid</option><option value="REMOTE">Remote</option></select></label>
            <button type="submit" className={buttonVariants({ size: "lg", className: "h-11 px-5 sm:col-span-2" })}>
              <SearchIcon aria-hidden="true" /> Jobs suchen
            </button>
          </form>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><BadgeCheckIcon className="size-4 text-primary" aria-hidden="true" /> Verifizierte Firmen</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" /> Transparenz-Score</span>
          </div>
        </div>

        <Card className="border-primary/15 bg-secondary/45 shadow-sm">
          <CardHeader>
            <p className="eyebrow">Vor dem Bewerben wissen</p>
            <CardTitle as="h2" className="mt-2 text-2xl">Weniger Rätsel, bessere Entscheidungen.</CardTitle>
            <CardDescription className="leading-6">Der Fair-Job-Score macht vollständige und konkrete Inserate sichtbar.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 text-sm leading-6">
              <li>✓ Lohnspanne und Pensum auf einen Blick</li>
              <li>✓ Arbeitsort, Remote-Modell und Start klar benannt</li>
              <li>✓ Bewerbungsprozess und Antwortsignal verständlich erklärt</li>
            </ul>
            <Link href="/jobs" className={buttonVariants({ variant: "outline", className: "mt-6 w-full bg-background" })}>
              Alle Stellen ansehen <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </section>

      <section className="border-y bg-secondary/25 py-10" aria-label="Transparenzmerkmale">
        <div className="page-shell grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Highlight title="Fair-Job-Score" text="Erklärbare Transparenzfaktoren" />
          <Highlight title="Lohn-Radar" text="Geprüfte Bänder statt Scheingenauigkeit" />
          <Highlight title="Antwortsignal" text="Nur ab belastbarer Stichprobe" />
          <Highlight title="Direkter Kontakt" text="Sicher geprüfter externer Bewerbungsweg" />
          <Highlight title="Privater SwissJobPass" text="Keine automatische Talentpool-Freigabe" />
        </div>
      </section>

      {companies.length > 0 ? (
        <section className="page-shell py-16 sm:py-20" aria-labelledby="featured-companies-title">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Arbeitgeber entdecken</p><h2 id="featured-companies-title" className="mt-3 text-3xl font-semibold tracking-tight">Aktive Unternehmen</h2></div><Link href="/companies" className={buttonVariants({ variant: "outline" })}>Alle Unternehmen <ArrowRightIcon data-icon="inline-end" /></Link></div>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-4">{companies.map((company) => <CompanyCard key={company.id} company={company} headingLevel="h3" />)}</div>
        </section>
      ) : null}

      <section className="border-y bg-muted/30 py-16 sm:py-20" aria-labelledby="featured-jobs-title">
        <div className="page-shell">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">Aktuelle Auswahl</p>
              <h2 id="featured-jobs-title" className="mt-3 text-3xl font-semibold tracking-tight">Neue faire Stellen</h2>
            </div>
            <Link href="/jobs" className={buttonVariants({ variant: "outline" })}>Alle Stellen <ArrowRightIcon data-icon="inline-end" /></Link>
          </div>
          {jobs.length === 0 ? (
            <p className="mt-8 rounded-xl border border-dashed bg-background p-8 text-center text-muted-foreground">Aktuell sind keine publizierten Stellen verfügbar.</p>
          ) : (
            <div className="mt-8 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {jobs.map((job) => <JobCard key={job.id} job={job} />)}
            </div>
          )}
        </div>
      </section>

      <section className="page-shell py-16 sm:py-20" aria-labelledby="explore-title">
        <p className="eyebrow">Orientierung</p>
        <h2 id="explore-title" className="mt-3 text-3xl font-semibold tracking-tight">Entdecke den Arbeitsmarkt nach deinen Kriterien.</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <FeatureCard icon={Building2Icon} title="Unternehmen" description="Entdecke aktive Firmenprofile und ihre öffentlich verfügbaren Stellen." href="/companies" action="Firmen ansehen" />
          <FeatureCard icon={BarChart3Icon} title="Lohnradar" description="Ordne marktübliche Lohnbänder mit nachvollziehbarer Datengrundlage ein." href="/salary-radar" action="Lohn einschätzen" />
          <FeatureCard icon={BookOpenTextIcon} title="Ratgeber" description="Kompakte, redaktionell geprüfte Orientierung rund um Bewerbung und Arbeit." href="/guide" action="Ratgeber lesen" />
        </div>
        {clusters.length > 0 ? (
          <div className="mt-12 rounded-xl border p-5">
            <h3 className="font-semibold">Häufige Einstiege</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              {clusters.map((cluster) => (
                <Link key={`${cluster.kind}-${cluster.slug}`} href={`/jobs/${cluster.kind === "canton" ? "kanton" : "kategorie"}/${cluster.slug}`} className="rounded-full border bg-background px-3 py-1.5 text-sm hover:border-primary hover:text-primary">
                  {cluster.label} · {cluster.count}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {guides.length > 0 ? (
        <section className="border-y bg-secondary/35 py-16" aria-labelledby="guides-title">
          <div className="page-shell">
            <p className="eyebrow">Ratgeber</p>
            <h2 id="guides-title" className="mt-3 text-3xl font-semibold">Gut vorbereitet entscheiden.</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {guides.map((guide) => (
                <Card key={guide.id}>
                  <CardHeader><CardTitle as="h3">{guide.title}</CardTitle><CardDescription className="leading-6">{guide.excerpt}</CardDescription></CardHeader>
                  <CardContent className="mt-auto"><Link href={`/guide/${guide.slug}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Artikel lesen: {guide.title}</Link></CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="page-shell py-16 sm:py-20" aria-labelledby="how-title">
        <p className="eyebrow">So funktioniert es</p>
        <h2 id="how-title" className="mt-3 text-3xl font-semibold">Ein klarer Weg für beide Seiten.</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle as="h3" className="text-xl">Für Bewerber:innen</CardTitle><CardDescription className="leading-6">Stellen ohne Konto durchsuchen, Transparenzmerkmale vergleichen und bei Interesse sicher zum externen Bewerbungsweg wechseln.</CardDescription></CardHeader><CardContent><ol className="grid gap-3 text-sm leading-6"><li>1. Nach Beruf, Region und Pensum filtern</li><li>2. Lohn, Fair-Job-Score und Antwortsignal einordnen</li><li>3. Optional einen privaten SwissJobPass anlegen</li></ol><Link href="/register/candidate" className={buttonVariants({ className: "mt-5" })}>SwissJobPass erstellen</Link></CardContent></Card>
          <Card><CardHeader><CardTitle as="h3" className="text-xl">Für Arbeitgeber</CardTitle><CardDescription className="leading-6">Persönlichen Zugang anlegen und Firmenzugehörigkeit kontrolliert prüfen lassen – ohne automatische Rechtevergabe.</CardDescription></CardHeader><CardContent><ol className="grid gap-3 text-sm leading-6"><li>1. Sicheren Arbeitgeberzugang erstellen</li><li>2. Unternehmen neu erfassen oder Anspruch prüfen lassen</li><li>3. Inserate im Arbeitgeberportal vorbereiten</li></ol><Link href="/register/employer" className={buttonVariants({ variant: "outline", className: "mt-5" })}>Inserat erfassen</Link></CardContent></Card>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3"><TrustItem title="Datensparsam" text="Öffentliche Suche lädt keine Kandidatenprofile." /><TrustItem title="Anonym vorbereitet" text="Talentprofile bleiben bis zu einer bewussten Freigabe privat." /><TrustItem title="Ohne Tracking-Pixel" text="Keine unsichtbaren Marketing-Pixel in den öffentlichen Seiten." /></div>
      </section>

      <section className="page-shell py-16 sm:py-20">
        <div className="rounded-2xl bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-12">
          <p className="text-sm font-semibold tracking-widest uppercase opacity-80">Für Arbeitgeber</p>
          <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div><h2 className="text-3xl font-semibold">Transparente Stellen erreichen passende Menschen.</h2><p className="mt-3 max-w-2xl leading-7 opacity-85">Erstelle einen sicheren Arbeitgeberzugang. Ein Firmenzugriff entsteht erst nach kontrollierter Prüfung.</p></div>
            <Link href="/register/employer" className={buttonVariants({ variant: "secondary", size: "lg", className: "shrink-0" })}>Arbeitgeberkonto erstellen <ArrowRightIcon data-icon="inline-end" /></Link>
          </div>
        </div>
      </section>
    </>
  );
}

function TrustItem({ title, text }: Readonly<{ title: string; text: string }>) {
  return <div className="rounded-xl border bg-muted/25 p-4"><ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" /><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div>;
}

function Highlight({ title, text }: Readonly<{ title: string; text: string }>) {
  return <div className="rounded-lg border bg-background p-4"><p className="font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>;
}

function FeatureCard({ icon: Icon, title, description, href, action }: Readonly<{
  icon: typeof Building2Icon;
  title: string;
  description: string;
  href: string;
  action: string;
}>) {
  return (
    <Card className="h-full">
      <CardHeader><span className="mb-3 grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-5" aria-hidden="true" /></span><CardTitle as="h3">{title}</CardTitle><CardDescription className="leading-6">{description}</CardDescription></CardHeader>
      <CardContent className="mt-auto"><Link href={href} className={buttonVariants({ variant: "outline", className: "w-full" })}>{action}</Link></CardContent>
    </Card>
  );
}
