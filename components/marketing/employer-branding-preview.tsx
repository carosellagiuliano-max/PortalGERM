import { BriefcaseBusinessIcon, Building2Icon, MapPinIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

export function EmployerBrandingPreview() {
  return (
    <figure className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div className="rounded-xl border bg-background p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"
          >
            <Building2Icon className="size-7" />
          </span>
          <div className="min-w-0">
            <Badge variant="secondary">Schematische Demo</Badge>
            <h2 className="mt-3 text-xl font-semibold">Unternehmensname</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPinIcon className="size-4 shrink-0" aria-hidden="true" />
              Branche · Ort · Kanton
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">Öffentliche Kurzbeschreibung</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ein erweitertes Profil kann modellierte Angaben zu Arbeitsumfeld,
              Benefits und offenen Stellen strukturiert erklären.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Beispiel-Felder</h3>
            <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">
              <li>Arbeitsmodell und Standort</li>
              <li>Weiterbildung und weitere Benefits</li>
              <li className="flex items-center gap-2">
                <BriefcaseBusinessIcon className="size-4" aria-hidden="true" />
                Öffentliche Stellen
              </li>
            </ul>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 text-sm leading-6 text-muted-foreground">
        Rein schematische, modellkonforme Ansicht – keine reale Firma, kein echtes
        Logo, keine Mitarbeitenden-Zitate und kein unbelegtes Antwortsignal.
      </figcaption>
    </figure>
  );
}
