export function PrivateAreaLoading({
  area,
}: Readonly<{ area: string }>) {
  return (
    <div
      className="grid gap-6"
      role="status"
      aria-live="polite"
      aria-label={`${area} wird geladen`}
    >
      <div className="h-4 w-36 animate-pulse rounded bg-muted" />
      <div className="h-10 max-w-xl animate-pulse rounded bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="h-32 animate-pulse rounded-xl border bg-muted/35"
            key={index}
          />
        ))}
      </div>
      <span className="sr-only">Inhalt wird sicher geladen.</span>
    </div>
  );
}
