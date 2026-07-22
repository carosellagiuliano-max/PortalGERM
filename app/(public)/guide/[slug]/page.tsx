import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon, BookOpenTextIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicGuideBySlug, listRelatedPublicGuides } from "@/lib/content/public-guides";
import { getPublicDataContext } from "@/lib/public/environment";
import { formatDate } from "@/lib/utils/format";

const getGuide = cache((slug: string) => getPublicGuideBySlug(slug));

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await getGuide(slug);
  if (guide === null) {
    return {
      title: "Ratgeber nicht gefunden",
      robots: { index: false, follow: false, noarchive: true, nosnippet: true },
    };
  }
  const indexable = getPublicDataContext().publicIndexingAllowed &&
    guide.dataProvenance === "LIVE";
  return {
    title: guide.title,
    description: guide.excerpt,
    alternates: { canonical: guide.canonicalPath },
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, noarchive: true, nosnippet: true },
  };
}

export default async function GuideDetailPage({ params }: GuidePageProps) {
  const { slug } = await params;
  const guide = await getGuide(slug);
  if (guide === null) notFound();
  const related = await listRelatedPublicGuides(guide, { limit: 3 });
  const paragraphs = guide.body.split(/\n{2,}/u).map((value) => value.trim()).filter(Boolean);
  return (
    <div>
      <article className="page-shell py-10 sm:py-16">
        <Link href="/guide" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"><ArrowLeftIcon className="size-4" aria-hidden="true" /> Zum Ratgeber</Link>
        <header className="mx-auto mt-10 max-w-3xl text-center"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-secondary text-secondary-foreground"><BookOpenTextIcon className="size-6" aria-hidden="true" /></span><p className="eyebrow mt-5">Geprüfter Ratgeber</p><h1 className="mt-3 text-balance text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">{guide.title}</h1><p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">{guide.excerpt}</p><p className="mt-4 text-sm text-muted-foreground">Publiziert am {formatDate(guide.publishedAt)}</p></header>
        <div className="prose-safe mx-auto mt-12 max-w-3xl">{paragraphs.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>)}</div>
      </article>
      {related.length > 0 ? <section className="border-t bg-muted/25 py-14" aria-labelledby="related-guides-title"><div className="page-shell"><h2 id="related-guides-title" className="text-2xl font-semibold">Verwandte Artikel</h2><div className="mt-6 grid gap-5 md:grid-cols-3">{related.map((item) => <Card key={item.id}><CardHeader><CardTitle as="h3">{item.title}</CardTitle><CardDescription className="leading-6">{item.excerpt}</CardDescription></CardHeader><CardContent className="mt-auto"><Link href={`/guide/${item.slug}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>Artikel lesen: {item.title} <ArrowRightIcon data-icon="inline-end" /></Link></CardContent></Card>)}</div></div></section> : null}
    </div>
  );
}

type GuidePageProps = Readonly<{ params: Promise<{ slug: string }> }>;
