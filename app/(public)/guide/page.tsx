import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, BookOpenTextIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listPublicGuides } from "@/lib/content/public-guides";
import { formatDate } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Ratgeber",
  description: "Geprüfte Orientierung für Bewerbung, Beruf und Arbeitsmarkt in der Schweiz.",
  alternates: { canonical: "/guide" },
  robots: { index: false, follow: true },
};
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GuideIndexPage() {
  const guides = await listPublicGuides({ limit: 50 });
  return (
    <div className="page-shell py-12 sm:py-16">
      <p className="eyebrow">Ratgeber</p>
      <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">Orientierung, die dich weiterbringt.</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">Hier erscheinen ausschliesslich aktuell publizierte und redaktionell geprüfte Beiträge. Die Suchmaschinenfreigabe erfolgt erst mit dem späteren Inhalts- und Qualitätsgate.</p>
      {guides.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed bg-muted/25 p-10 text-center text-muted-foreground">Aktuell sind keine geprüften Ratgeber veröffentlicht.</div>
      ) : (
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {guides.map((guide) => (
            <Card key={guide.id} className="h-full">
              <CardHeader><span className="mb-3 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><BookOpenTextIcon className="size-5" aria-hidden="true" /></span><CardTitle as="h2" className="text-lg"><Link href={`/guide/${guide.slug}`} className="underline-offset-4 hover:text-primary hover:underline">{guide.title}</Link></CardTitle><CardDescription className="leading-6">{guide.excerpt}</CardDescription></CardHeader>
              <CardContent className="mt-auto"><p className="mb-4 text-xs text-muted-foreground">Geprüft · {formatDate(guide.publishedAt)}</p><Link href={`/guide/${guide.slug}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Artikel lesen <ArrowRightIcon data-icon="inline-end" /></Link></CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
