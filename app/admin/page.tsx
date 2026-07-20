import type { Metadata } from "next";
import { ShieldCheckIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Admin-Übersicht" };

export default function AdminPage() {
  return (
    <section aria-labelledby="admin-title" className="max-w-3xl">
      <p className="eyebrow">Plattformsteuerung</p>
      <h1 id="admin-title" className="mt-2 text-3xl font-semibold tracking-tight">
        Admin-Übersicht
      </h1>
      <Card className="mt-7">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <ShieldCheckIcon className="size-5 text-primary" aria-hidden="true" />
            Adminzugang bestätigt
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-6 text-muted-foreground">
            Dieser Bereich ist ausschliesslich für aktive Admin-Konten erreichbar. Die
            Moderations- und Betriebswerkzeuge werden in den zuständigen Produktphasen
            ergänzt.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
