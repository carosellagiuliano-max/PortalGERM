import Link from "next/link";
import { BadgeCheckIcon, BriefcaseBusinessIcon, Building2Icon, MapPinIcon } from "lucide-react";

import { ResponseSignal } from "@/components/public/response-signal";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PublicCompanyCardModel } from "@/lib/public/types";

export function CompanyCard({
  company,
  headingLevel = "h2",
}: Readonly<{
  company: PublicCompanyCardModel;
  headingLevel?: "h2" | "h3";
}>) {
  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <span className="mb-3 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Building2Icon className="size-5" aria-hidden="true" /></span>
        <CardTitle as={headingLevel} className="text-lg">
          <Link href={`/companies/${company.slug}`} className="underline-offset-4 hover:text-primary hover:underline">{company.name}</Link>
        </CardTitle>
        {company.verified ? <Badge variant="secondary"><BadgeCheckIcon aria-hidden="true" /> Verifiziert</Badge> : <Badge variant="outline">Öffentliches Profil</Badge>}
      </CardHeader>
      <CardContent className="mt-auto grid gap-3 text-sm">
        {company.industry === null ? null : <p className="text-muted-foreground">{company.industry}</p>}
        <dl className="grid gap-2">
          {company.city === null && company.canton === null ? null : <div className="flex items-center gap-2"><MapPinIcon className="size-4 text-primary" aria-hidden="true" /><dt className="sr-only">Standort</dt><dd>{[company.city, company.canton].filter(Boolean).join(", ")}</dd></div>}
          <div className="flex items-center gap-2"><BriefcaseBusinessIcon className="size-4 text-primary" aria-hidden="true" /><dt className="sr-only">Offene Stellen</dt><dd>{company.openJobCount} offene {company.openJobCount === 1 ? "Stelle" : "Stellen"}</dd></div>
        </dl>
        {company.benefitsPreview.length === 0 ? null : (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Benefits</p>
            <ul className="flex flex-wrap gap-1.5">
              {company.benefitsPreview.map((benefit, index) => (
                <li key={`${index}-${benefit}`}><Badge variant="outline">{benefit}</Badge></li>
              ))}
            </ul>
          </div>
        )}
        {company.response.known ? (
          <div className="border-t pt-3 text-xs"><ResponseSignal response={company.response} compact /></div>
        ) : null}
      </CardContent>
    </Card>
  );
}
