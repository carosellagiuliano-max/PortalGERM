import { EyeIcon, EyeOffIcon, ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AnonymousCandidateDto } from "@/lib/privacy/anonymize-candidate";

export function AnonymousPreview({
  preview,
  consentGranted,
}: Readonly<{
  preview: AnonymousCandidateDto | null;
  consentGranted: boolean;
}>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Sichere Arbeitgeberansicht</p>
            <CardTitle as="h2" className="mt-2 flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
              Anonyme Talent-Radar-Vorschau
            </CardTitle>
          </div>
          <Badge variant={consentGranted ? "secondary" : "outline"}>
            {consentGranted ? (
              <EyeIcon aria-hidden="true" />
            ) : (
              <EyeOffIcon aria-hidden="true" />
            )}
            {consentGranted ? "Einwilligung erteilt" : "Sichtbarkeit aus"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        {preview === null ? (
          <div className="rounded-xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">
            Ergänze mindestens Kanton und Wunschberuf oder Kategorie, damit die
            sichere Vorschau aufgebaut werden kann.
          </div>
        ) : (
          <div className="grid gap-4 rounded-xl border bg-muted/20 p-5">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Anonymes Profil
              </p>
              <p className="mt-1 text-xl font-semibold">{preview.displayLabel}</p>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <PreviewValue label="Kanton" value={preview.cantonBucket} />
              <PreviewValue
                label="Pensum-Bucket"
                value={preview.workloadBucket === undefined ? null : `${preview.workloadBucket} %`}
              />
              <PreviewValue
                label="Remote"
                value={preview.remotePreference === undefined ? null : remoteLabel(preview.remotePreference)}
              />
              <PreviewValue
                label="Verfügbarkeit"
                value={preview.availabilityBucket === undefined ? null : availabilityLabel(preview.availabilityBucket)}
              />
            </dl>
            <div>
              <p className="text-sm font-medium">Kompetenzen</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {preview.skillSlugs?.length ? (
                  preview.skillSlugs.map((skill) => (
                    <Badge key={skill} variant="outline">{humanize(skill)}</Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">Noch keine sichtbaren Kompetenzen</span>
                )}
              </div>
            </div>
            {preview.languageCodes?.length ? (
              <p className="text-sm text-muted-foreground">
                Sprachen: {preview.languageCodes.map((code) => code.toUpperCase()).join(", ")}
              </p>
            ) : null}
          </div>
        )}
        <div className="grid gap-1 rounded-lg bg-secondary/60 p-4 text-sm leading-6">
          <p className="font-semibold">Datenschutzfreundlich vorbereitet</p>
          <p className="text-muted-foreground">
            Name, E-Mail, Telefon, exakter Ort und CV sind in dieser Projektion
            technisch nicht enthalten. Du kannst die Sichtbarkeit jederzeit
            deaktivieren.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewValue({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value ?? "Nicht angegeben"}</dd>
    </div>
  );
}

function humanize(value: string) {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function remoteLabel(value: NonNullable<AnonymousCandidateDto["remotePreference"]>) {
  return {
    ONSITE: "Vor Ort",
    HYBRID: "Hybrid",
    REMOTE: "Remote",
    ANY: "Flexibel",
  }[value];
}

function availabilityLabel(value: string) {
  return {
    NOW: "Sofort",
    WITHIN_30_DAYS: "Innerhalb 30 Tagen",
    WITHIN_90_DAYS: "Innerhalb 90 Tagen",
    LATER: "Später",
    UNKNOWN: "Offen",
  }[value] ?? "Offen";
}
