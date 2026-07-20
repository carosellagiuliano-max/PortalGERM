import { LockKeyholeIcon, ShieldCheckIcon } from "lucide-react";

export function TalentRadarPreview() {
  return (
    <figure className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div
        role="img"
        aria-label="Gesperrte schematische Vorschau anonymer Talentprofile"
        className="relative overflow-hidden rounded-xl border bg-muted/35 p-4 sm:p-6"
      >
        <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
          {["Anonymes Profil", "Anonymes Profil"].map((label, index) => (
            <div key={`${label}-${index}`} className="rounded-xl border bg-background p-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted" />
                <div>
                  <p className="font-semibold">{label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opt-in · kontrollierte Freigabe
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 opacity-45 blur-[2px]">
                <div className="h-3 w-3/4 rounded bg-muted-foreground/30" />
                <div className="h-3 w-1/2 rounded bg-muted-foreground/30" />
                <div className="h-3 w-2/3 rounded bg-muted-foreground/30" />
              </div>
            </div>
          ))}
        </div>
        <div className="absolute inset-0 grid place-items-center bg-background/72 p-5 text-center backdrop-blur-[1px]">
          <div className="max-w-xs rounded-xl border bg-background p-5 shadow-sm">
            <LockKeyholeIcon className="mx-auto size-7 text-primary" aria-hidden="true" />
            <p className="mt-3 font-semibold">Vorschau gesperrt</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Zugriff entsteht erst nach Firmenprüfung, Berechtigungsprüfung und
              Produktfreigabe.
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-4 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        Illustrative Vorschau – keine realen Kandidatenprofile. Identität wird nicht
        durch einen Credit offengelegt, sondern nur nach Annahme und einer separaten,
        kandidateninitiierten Freigabe.
      </figcaption>
    </figure>
  );
}
