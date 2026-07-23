import { BriefcaseBusinessIcon, LanguagesIcon, MapPinIcon, ShieldCheckIcon } from "lucide-react";

import { ContactDialog } from "@/components/employer/TalentRadar/ContactDialog";
import { CandidateReportForm } from "@/components/employer/TalentRadar/CandidateReportForm";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AnonymousCandidateDto } from "@/lib/privacy/anonymize-candidate";

export function CandidateCard({
  candidate,
  signedSearchSession,
  idempotencyKey,
}: Readonly<{
  candidate: AnonymousCandidateDto;
  signedSearchSession: string;
  idempotencyKey: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Anonymes Talent
            </p>
            <CardTitle as="h2" className="mt-1 text-lg">
              {humanize(candidate.categoryBucket)}
            </CardTitle>
          </div>
          <ShieldCheckIcon className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-2 text-sm">
          <MapPinIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          Kanton {candidate.cantonBucket}
        </div>

        <div className="flex flex-wrap gap-2">
          {candidate.workloadBucket === undefined ? null : (
            <Badge variant="outline">
              <BriefcaseBusinessIcon aria-hidden="true" /> ca. {candidate.workloadBucket}%
            </Badge>
          )}
          {candidate.salaryBucket === undefined ? null : (
            <Badge variant="outline">{salaryLabel(candidate.salaryBucket)}</Badge>
          )}
          {candidate.remotePreference === undefined ? null : (
            <Badge variant="outline">{remoteLabel(candidate.remotePreference)}</Badge>
          )}
          {candidate.languageCodes?.map((language) => (
            <Badge key={language} variant="outline">
              <LanguagesIcon aria-hidden="true" /> {language.toUpperCase()}
            </Badge>
          ))}
          {candidate.skillSlugs?.map((skill) => (
            <Badge key={skill} variant="secondary">{humanize(skill)}</Badge>
          ))}
        </div>

        <p className="text-xs leading-5 text-muted-foreground">
          Angezeigt werden ausschließlich grobe, zur Suche passende Merkmale.
          Identität bleibt anonym bis zur Freigabe.
        </p>
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-3">
        <CandidateReportForm
          opaqueCandidateId={candidate.opaqueId}
          signedSearchSession={signedSearchSession}
        />
        <ContactDialog
          opaqueCandidateId={candidate.opaqueId}
          signedSearchSession={signedSearchSession}
          idempotencyKey={idempotencyKey}
        />
      </CardFooter>
    </Card>
  );
}

function humanize(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function salaryLabel(bucket: string) {
  const amount = Number(bucket.replace(/^CHF_/u, ""));
  return Number.isSafeInteger(amount)
    ? `CHF ${amount.toLocaleString("de-CH")} / Jahr (FTE)`
    : "Jahreslohn-Bucket (FTE)";
}

function remoteLabel(value: NonNullable<AnonymousCandidateDto["remotePreference"]>) {
  const labels = {
    ONSITE: "Vor Ort",
    HYBRID: "Hybrid",
    REMOTE: "Remote",
    ANY: "Flexibel",
  } as const;
  return labels[value];
}
