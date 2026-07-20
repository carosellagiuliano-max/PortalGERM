import { FlaskConicalIcon } from "lucide-react";

export function DemoDataBanner() {
  return (
    <aside
      aria-label="Demo-Hinweis"
      className="border-b border-primary/15 bg-secondary text-secondary-foreground"
    >
      <div className="page-shell flex min-h-11 items-center gap-2 py-2 text-sm leading-5">
        <FlaskConicalIcon className="size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">
            Demo-Daten – keine reale Marktaktivität.
          </strong>{" "}
          Inhalte dienen ausschliesslich der lokalen Produktvorschau.
        </p>
      </div>
    </aside>
  );
}
