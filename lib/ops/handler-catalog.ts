export type WorkerHandlerCatalogEntry = Readonly<{
  defaultPriority: number;
  execution:
    | "IMPLEMENTED"
    | "CATALOG_ONLY_REQUIRES_PHASE_25"
    | "CATALOG_ONLY_REQUIRES_OWNING_PHASE";
  handlerKey: string;
  handlerVersion: string;
  owner: string;
  payloadVersion: string;
  providerUseCase: string | null;
  runbookRef: string;
  schedule: string;
  sloRef: string;
}>;

export const WORKER_HANDLER_CATALOG = Object.freeze([
  handler({
    handlerKey: "ops.diagnostic-effect",
    owner: "Platform Engineering",
    schedule: "manual-sandbox-only",
    sloRef: "codex-plan/23-production-operations-workers.md#22",
  }),
  handler({
    handlerKey: "notifications.dispatch",
    owner: "Platform Engineering / Communications",
    // This catalog value records the dispatcher's coarse email dependency.
    // Runtime authority is intentionally narrower: the dispatcher resolves
    // transactional or job-alert activation from each claimed template.
    providerUseCase: "email.transactional",
    schedule: "continuous-when-activated",
    sloRef: "codex-plan/20-identity-email-notifications.md",
  }),
  handler({
    handlerKey: "notifications.retention",
    owner: "Privacy / Platform Engineering",
    schedule: "minute-boundary",
    sloRef: "codex-plan/33-go-live-readiness-e2e-acceptance.md",
  }),
  handler({
    handlerKey: "candidate.job-alert-digest",
    owner: "Candidate Product / Platform",
    providerUseCase: "email.job-alert",
    schedule: "minute-boundary",
    sloRef: "codex-plan/09-candidate-portal.md",
  }),
  handler({
    handlerKey: "jobs.expiry-projection",
    owner: "Jobs Domain / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/10-employer-portal.md",
  }),
  handler({
    handlerKey: "employer.invitation-expiry",
    owner: "Employer Identity / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/10-employer-portal.md",
  }),
  handler({
    handlerKey: "billing.boost-projection",
    owner: "Billing / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/12-monetization-billing.md",
  }),
  handler({
    handlerKey: "billing.credit-expiry",
    owner: "Billing / Finance",
    schedule: "hour-boundary",
    sloRef: "codex-plan/12-monetization-billing.md",
  }),
  handler({
    handlerKey: "billing.subscription-boundary",
    owner: "Billing / Finance",
    schedule: "minute-boundary",
    sloRef: "codex-plan/12-monetization-billing.md",
  }),
  handler({
    handlerKey: "radar.contact-expiry",
    owner: "Talent Radar / Privacy",
    schedule: "minute-boundary",
    sloRef: "codex-plan/14-talent-radar-privacy.md",
  }),
  handler({
    handlerKey: "documents.scan",
    owner: "Security / Documents",
    providerUseCase: "documents.object-store",
    schedule: "continuous-when-activated",
    sloRef: "codex-plan/21-document-cv-vault.md",
  }),
  handler({
    handlerKey: "documents.reconcile",
    owner: "Security / Documents",
    providerUseCase: "documents.object-store",
    schedule: "hour-boundary",
    sloRef: "codex-plan/21-document-cv-vault.md",
  }),
  handler({
    handlerKey: "payments.inbox-project",
    owner: "Billing / Finance / Platform",
    providerUseCase: "payments.hosted-checkout",
    schedule: "event-driven",
    sloRef: "codex-plan/24-real-billing-finance.md#22",
  }),
  handler({
    handlerKey: "privacy.export",
    owner: "Privacy / Platform",
    schedule: "event-driven-after-dual-approval",
    sloRef: "codex-plan/22-privacy-legal-analytics.md",
  }),
  handler({
    handlerKey: "privacy.correction",
    owner: "Privacy / Platform",
    schedule: "event-driven-after-dual-approval",
    sloRef: "codex-plan/22-privacy-legal-analytics.md",
  }),
  handler({
    handlerKey: "privacy.erasure",
    owner: "Privacy / Platform",
    schedule: "event-driven-after-dual-approval",
    sloRef: "codex-plan/22-privacy-legal-analytics.md",
  }),
  handler({
    handlerKey: "payments.reconcile",
    owner: "Finance / Platform",
    providerUseCase: "payments.hosted-checkout",
    schedule: "hour-boundary",
    sloRef: "codex-plan/24-real-billing-finance.md",
  }),
  handler({
    handlerKey: "payments.dunning",
    owner: "Billing / Finance / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/24-real-billing-finance.md",
  }),
  handler({
    handlerKey: "payments.service-recovery",
    owner: "Billing / Finance / Support",
    schedule: "minute-boundary",
    sloRef: "codex-plan/24-real-billing-finance.md",
  }),
  handler({
    handlerKey: "security.expiry-projection",
    owner: "Security / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/25-admin-security.md#22",
  }),
  handler({
    handlerKey: "trust.case-expiry",
    owner: "Trust & Safety / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/25-admin-security.md#22",
  }),
  handler({
    handlerKey: "company-trust.expiry-review",
    owner: "Company Trust / Platform",
    schedule: "minute-boundary",
    sloRef: "codex-plan/26-company-trust-verification.md#22",
  }),
  handler({
    handlerKey: "recruiting.reminder-expiry",
    owner: "Recruiting / Privacy / Platform",
    schedule: "minute-boundary",
    sloRef:
      "codex-plan/28-recruiting-workflows.md#22-performance--und-skalierungsgrenzen",
  }),
  handler({
    handlerKey: "jobs.freshness",
    owner: "Jobs Domain / Trust",
    schedule: "minute-boundary",
    sloRef: "codex-plan/30-search-scale-operations.md",
  }),
  handler({
    handlerKey: "seo.sitemap-capacity",
    owner: "SEO / Platform Operations",
    schedule: "day-boundary",
    sloRef: "codex-plan/30-search-scale-operations.md",
  }),
  handler({
    handlerKey: "search.learning-expiry",
    owner: "Search / Privacy",
    schedule: "day-boundary",
    sloRef: "codex-plan/30-search-scale-operations.md",
  }),
] as const satisfies readonly WorkerHandlerCatalogEntry[]);

export function getWorkerHandlerDefinition(
  handlerKey: string,
  handlerVersion: string,
): WorkerHandlerCatalogEntry | null {
  return (
    WORKER_HANDLER_CATALOG.find(
      (entry) =>
        entry.handlerKey === handlerKey &&
        entry.handlerVersion === handlerVersion,
    ) ?? null
  );
}

function handler(
  input: Readonly<{
    execution?: WorkerHandlerCatalogEntry["execution"];
    handlerKey: string;
    owner: string;
    providerUseCase?: string;
    schedule: string;
    sloRef: string;
  }>,
): WorkerHandlerCatalogEntry {
  return Object.freeze({
    handlerKey: input.handlerKey,
    handlerVersion: "v1",
    payloadVersion: "v1",
    execution: input.execution ?? "IMPLEMENTED",
    owner: input.owner,
    runbookRef: "codex-plan/runbooks/worker-operations.md",
    sloRef: input.sloRef,
    providerUseCase: input.providerUseCase ?? null,
    schedule: input.schedule,
    defaultPriority: input.handlerKey === "ops.diagnostic-effect" ? 10 : 50,
  });
}
