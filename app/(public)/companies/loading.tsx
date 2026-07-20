export default function CompaniesLoading() {
  return <div className="page-shell py-12 sm:py-16" aria-busy="true" aria-label="Unternehmen werden geladen"><div className="h-3 w-28 animate-pulse rounded bg-muted" /><div className="mt-4 h-12 max-w-3xl animate-pulse rounded bg-muted" /><div className="mt-8 h-40 animate-pulse rounded-xl border bg-muted/35" /><div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl border bg-muted/35" />)}</div></div>;
}
