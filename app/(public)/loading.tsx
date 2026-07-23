export default function Loading() {
  return (
    <div className="page-shell py-16" role="status" aria-live="polite">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-5 h-10 max-w-xl animate-pulse rounded bg-muted" />
      <div className="mt-4 h-5 max-w-2xl animate-pulse rounded bg-muted" />
      <span className="sr-only">Inhalt wird geladen.</span>
    </div>
  );
}
