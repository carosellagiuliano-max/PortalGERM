import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="border-t bg-muted/35">
      <div className="page-shell flex flex-col gap-3 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>SwissTalentHub · technische Foundation</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link className="underline-offset-4 hover:underline" href="/">
            Start
          </Link>
          <Link className="underline-offset-4 hover:underline" href="/health/live">
            Live-Status
          </Link>
        </div>
      </div>
    </footer>
  );
}
