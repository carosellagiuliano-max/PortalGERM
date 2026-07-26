import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerEnvironment } from "@/lib/config/env";
import { getDatabase } from "@/lib/db/client";
import { getCurrentLegalPublication } from "@/lib/legal/publication-service";
import { formatDateTime } from "@/lib/utils/format";

export async function PublishedLegalPage({
  slug,
  expectedTitle,
}: Readonly<{ slug: string; expectedTitle: string }>) {
  const environment = getServerEnvironment();
  const enabled =
    slug === "privacy"
      ? environment.LEGAL_PUBLICATION_PRIVACY
      : slug === "terms"
        ? environment.LEGAL_PUBLICATION_TERMS
        : slug === "imprint"
          ? environment.LEGAL_PUBLICATION_IMPRINT
          : false;
  const publication = enabled
    ? await getCurrentLegalPublication(slug, getDatabase())
    : null;

  if (publication === null) {
    return (
      <section className="page-shell py-12 sm:py-16" aria-labelledby="legal-title">
        <div className="mx-auto max-w-3xl">
          <p className="eyebrow">Rechtsinformation</p>
          <h1 id="legal-title" className="mt-3 text-3xl font-semibold tracking-tight">
            {expectedTitle}
          </h1>
          <Card className="mt-8">
            <CardHeader>
              <CardTitle as="h2">Noch nicht veröffentlicht</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 leading-7 text-muted-foreground">
              <p>
                Für diese Seite liegt noch keine fachlich geprüfte und technisch
                veröffentlichte Fassung vor. SwissTalentHub aktiviert den
                betroffenen LIVE-Flow deshalb nicht.
              </p>
              <p>
                Für ein konkretes Datenschutzanliegen kannst du den geschützten
                Self-Service oder den Support nutzen.
              </p>
              <Link className="font-medium text-foreground underline" href="/login">
                Zum geschützten Bereich
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>
    );
  }

  return (
    <article className="page-shell py-12 sm:py-16" aria-labelledby="legal-title">
      <div className="mx-auto max-w-3xl">
        <p className="eyebrow">Veröffentlichte Rechtsinformation</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{publication.versionLabel}</Badge>
          <Badge variant="outline">{publication.locale}</Badge>
        </div>
        <h1 id="legal-title" className="mt-4 text-3xl font-semibold tracking-tight">
          {publication.title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Gültig ab {formatDateTime(publication.effectiveAt)} ·
          Veröffentlichungs-Hash{" "}
          <span className="break-all font-mono">{publication.publicationHash}</span>
        </p>
        <div className="mt-9 grid gap-5 leading-7">
          <LegalMarkdown value={publication.contentMarkdown} />
        </div>
      </div>
    </article>
  );
}

function LegalMarkdown({ value }: Readonly<{ value: string }>) {
  const blocks = value.split(/\n{2,}/u);
  return blocks.map((block, index) => {
    const text = block.trim();
    if (text.startsWith("### ")) {
      return (
        <h3 className="mt-3 text-lg font-semibold" key={`${index}-${text}`}>
          {text.slice(4)}
        </h3>
      );
    }
    if (text.startsWith("## ")) {
      return (
        <h2 className="mt-5 text-2xl font-semibold" key={`${index}-${text}`}>
          {text.slice(3)}
        </h2>
      );
    }
    const listLines = text.split("\n").filter((line) => line.startsWith("- "));
    if (listLines.length > 0 && listLines.length === text.split("\n").length) {
      return (
        <ul className="list-disc space-y-2 pl-6" key={`${index}-${text}`}>
          {listLines.map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p className="whitespace-pre-line" key={`${index}-${text}`}>
        {text}
      </p>
    );
  });
}
