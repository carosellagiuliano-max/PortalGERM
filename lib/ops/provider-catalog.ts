export type ProviderCatalogEntry = Readonly<{
  adapterKey: string;
  adapterVersion: string;
  owner: string;
  runbookRef: string;
  useCase: string;
}>;

export const PROVIDER_CATALOG = Object.freeze([
  provider("email.transactional", "local_mock", "Communications / Platform"),
  provider("email.transactional", "resend_sandbox", "Communications / Platform"),
  provider("email.job-alert", "local_mock", "Candidate Product / Platform"),
  provider("documents.object-store", "filesystem_sandbox", "Security / Documents"),
  provider("documents.malware-scan", "deterministic_sandbox", "Security / Documents"),
  provider("privacy.export-store", "filesystem_sandbox", "Privacy / Platform"),
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
