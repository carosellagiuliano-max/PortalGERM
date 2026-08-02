export type ProviderCatalogEntry = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  owner: string;
  runbookRef: string;
  useCase: string;
}>;

export const PROVIDER_CATALOG = Object.freeze([
  provider("email.transactional", "local_mock", "Communications / Platform"),
  provider("email.transactional", "resend_contract", "Communications / Platform"),
  provider("email.transactional", "resend_sandbox", "Communications / Platform"),
  provider("email.transactional", "resend_live", "Communications / Platform"),
  provider("email.job-alert", "local_mock", "Candidate Product / Platform"),
  provider("email.job-alert", "resend_contract", "Candidate Product / Platform"),
  provider("email.job-alert", "resend_sandbox", "Candidate Product / Platform"),
  provider("email.job-alert", "resend_live", "Candidate Product / Platform"),
  provider("email.delivery-events", "resend_contract", "Communications / Platform"),
  provider("email.delivery-events", "resend_sandbox", "Communications / Platform"),
  provider("email.delivery-events", "resend_live", "Communications / Platform"),
  provider("documents.object-store", "filesystem_sandbox", "Security / Documents"),
  provider("documents.object-store", "s3_contract", "Security / Documents"),
  provider("documents.object-store", "s3_live", "Security / Documents"),
  provider("documents.malware-scan", "deterministic_sandbox", "Security / Documents"),
  provider("documents.malware-scan", "clamav_contract", "Security / Documents"),
  provider("documents.malware-scan", "clamav_live", "Security / Documents"),
  provider("privacy.export-store", "filesystem_sandbox", "Privacy / Platform"),
  provider("privacy.export-store", "s3_contract", "Privacy / Platform"),
  provider("privacy.export-store", "s3_live", "Privacy / Platform"),
  provider(
    "payments.hosted-checkout",
    "stripe_contract",
    "Billing / Finance / Security / Platform",
  ),
  provider(
    "payments.hosted-checkout",
    "stripe_sandbox",
    "Billing / Finance / Security / Platform",
  ),
  provider(
    "payments.hosted-checkout",
    "stripe_live",
    "Billing / Finance / Security / Platform",
  ),
] as const satisfies readonly ProviderCatalogEntry[]);

export function getProviderDefinition(
  useCase: string,
  adapterKey: string,
  adapterVersion: string,
): ProviderCatalogEntry | null {
  return (
    PROVIDER_CATALOG.find(
      (entry) =>
        entry.useCase === useCase &&
        entry.adapterKey === adapterKey &&
        entry.adapterVersion === adapterVersion,
    ) ?? null
  );
}

function provider(
  useCase: string,
  adapterKey: string,
  owner: string,
): ProviderCatalogEntry {
  return Object.freeze({
    useCase,
    adapterKey,
    adapterVersion: "v1",
    owner,
    runbookRef: "codex-plan/runbooks/provider-activation.md",
  });
}
