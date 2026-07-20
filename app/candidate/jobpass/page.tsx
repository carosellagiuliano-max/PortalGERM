import type { Metadata } from "next";
import { FileUserIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "SwissJobPass" };

export default function CandidateJobPassPage() {
  return (
    <section aria-labelledby="jobpass-title" className="max-w-3xl">
      <p className="eyebrow">Onboarding</p>
      <h1 id="jobpass-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Dein SwissJobPass
      </h1>
      <Card className="mt-7">
        <CardHeader>
          <span className="mb-2 grid size-11 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <FileUserIcon className="size-5" aria-hidden="true" />
          </span>
          <CardTitle as="h2">Profilentwurf ist bereit</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 leading-6 text-muted-foreground">
          <p>
            Dein sicherer Konto- und Profilentwurf wurde angelegt. Die vollständige
            Bearbeitung des SwissJobPass wird in Phase 09 freigeschaltet.
          </p>
          <p>
            Wichtig: Es wurde keine Talent-Radar-Sichtbarkeit aktiviert. Dafür ist später
            eine eigene, ausdrückliche Einwilligung erforderlich.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
