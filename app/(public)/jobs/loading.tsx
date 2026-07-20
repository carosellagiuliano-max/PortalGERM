export default function JobsLoading() {
  return (
    <div className="page-shell py-12 sm:py-16" aria-busy="true" aria-label="Stellen werden geladen">
      <div className="h-3 w-28 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-12 max-w-2xl animate-pulse rounded bg-muted" />
      <div className="mt-8 h-52 animate-pulse rounded-xl border bg-muted/35" />
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-72 animate-pulse rounded-xl border bg-muted/35" />)}
      </div>
    </div>
  );
}
