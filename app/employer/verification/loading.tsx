export default function EmployerVerificationLoading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Firmenprüfung wird geladen">
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
