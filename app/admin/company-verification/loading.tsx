export default function AdminCompanyVerificationLoading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Firmenprüfungen werden geladen">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
