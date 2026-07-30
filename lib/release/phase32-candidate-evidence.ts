import {
  PHASE32_FINDING_IDS,
  type Phase32FindingRecord,
  type Phase32FindingsLedger,
} from "@/lib/release/phase32-findings-ledger";
import {
  PHASE32_REQUIRED_REPORT_KINDS,
  type Phase32G4Manifest,
} from "@/lib/release/phase32-g4-manifest";

export type Phase32CandidateReportKind =
  (typeof PHASE32_REQUIRED_REPORT_KINDS)[number];

/**
 * Every LC1 finding is bound to the candidate report that directly exercises
 * or proves its scoped contract. A source-document digest is deliberately not
 * a substitute for one of these candidate-bound reports.
 */
export const PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING = Object.freeze({
  "STH-001": "INTEGRATION",
  "STH-002": "PRIVACY",
  "STH-003": "PRIVACY",
  "STH-004": "PROVIDER_WORKER",
  "STH-005": "ENVIRONMENT",
  "STH-006": "PRIVACY",
  "STH-007": "HTTP",
  "STH-008": "ENVIRONMENT",
  "STH-009": "ENVIRONMENT",
  "STH-010": "INTEGRATION",
  "STH-011": "ENVIRONMENT",
  "STH-012": "ENVIRONMENT",
  "STH-013": "ENVIRONMENT",
  "STH-014": "ENVIRONMENT",
  "STH-015": "ENVIRONMENT",
  "STH-016": "ENVIRONMENT",
  "STH-017": "ENVIRONMENT",
  "STH-018": "HTTP",
  "STH-019": "INTEGRATION",
  "STH-020": "INTEGRATION",
  "STH-021": "INTEGRATION",
  "STH-022": "ENVIRONMENT",
  "STH-023": "BROWSER",
  "STH-024": "BROWSER",
  "STH-025": "BROWSER",
  "STH-026": "BROWSER",
  "STH-027": "HTTP",
  "STH-028": "HTTP",
  "STH-029": "PLAN_AUDIT",
  "STH-030": "ENVIRONMENT",
  "STH-031": "INTEGRATION",
  "STH-032": "INTEGRATION",
  "STH-033": "BROWSER",
  "STH-034": "ENVIRONMENT",
  "STH-035": "ENVIRONMENT",
  "STH-036": "ENVIRONMENT",
  "STH-037": "HTTP",
} as const satisfies Readonly<Record<string, Phase32CandidateReportKind>>);

export type Phase32CandidateFindingId =
  keyof typeof PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING;

export type Phase32CandidateReport = Readonly<
  Pick<Phase32G4Manifest["reports"][number], "kind" | "reportSha256" | "status">
>;

export type Phase32CandidateEvidenceBinding = Readonly<{
  findingId: Phase32CandidateFindingId;
  alias: string;
  reportKind: Phase32CandidateReportKind;
  reportSha256: string;
  externalWalkthroughBlocked: boolean;
}>;

export type Phase32CandidateEvidenceOptions = Readonly<{
  externalWalkthroughAvailable?: boolean;
}>;

const EVIDENCE_ALIAS_PATTERN = /^phase32\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Extracts the status-specific evidence aliases without losing the
 * discriminated ledger contract.
 */
export function extractPhase32CandidateEvidenceAliases(
  record: Phase32FindingRecord,
): readonly string[] {
  let aliases: readonly unknown[];
  if (record.status === "CLOSED") {
    aliases = record.candidateEvidenceAliases;
  } else if (record.status === "DISABLED") {
    aliases = [record.disablement.negativeEvidenceAlias];
  } else if (record.status === "EXTERNAL") {
    aliases = [record.externalGate.safeDeactivationEvidenceAlias];
  } else {
    aliases = [record.monitoring.monitoringEvidenceAlias];
  }

  if (aliases.length === 0) {
    fail(`${record.id} has no candidate evidence alias`);
  }

  return Object.freeze(
    aliases.map((alias) => {
      if (typeof alias !== "string" || !EVIDENCE_ALIAS_PATTERN.test(alias)) {
        fail(`${record.id} has an invalid candidate evidence alias`);
      }
      return alias;
    }),
  );
}

/**
 * Resolves every ledger alias to a green report from the same candidate.
 * STH-024 remains explicitly blocked until the external/manual walkthrough is
 * present even though the automated browser report is green.
 */
export function resolvePhase32CandidateEvidence(
  ledger: Phase32FindingsLedger,
  reports: readonly Phase32CandidateReport[],
  options: Phase32CandidateEvidenceOptions = {},
): readonly Phase32CandidateEvidenceBinding[] {
  assertCompleteFindingInventory(
    Object.keys(PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING),
    "candidate report mapping",
  );
  assertCompleteFindingInventory(
    ledger.records.map((record) => record.id),
    "findings ledger",
  );

  const reportsByKind = new Map<
    Phase32CandidateReportKind,
    Phase32CandidateReport
  >();
  for (const report of reports) {
    if (reportsByKind.has(report.kind)) {
      fail(`candidate report kind ${report.kind} is duplicated`);
    }
    if (report.status !== "PASSED") {
      fail(`candidate report ${report.kind} is not PASSED`);
    }
    if (!SHA256_PATTERN.test(report.reportSha256)) {
      fail(`candidate report ${report.kind} has an invalid digest`);
    }
    reportsByKind.set(report.kind, report);
  }

  const aliases = new Set<string>();
  const bindings: Phase32CandidateEvidenceBinding[] = [];
  for (const record of ledger.records) {
    const findingId = record.id as Phase32CandidateFindingId;
    const reportKind = PHASE32_CANDIDATE_REPORT_KIND_BY_FINDING[findingId];
    if (reportKind === undefined) {
      fail(`${record.id} has no candidate report mapping`);
    }
    const report = reportsByKind.get(reportKind);
    if (report === undefined) {
      fail(`${record.id} requires missing candidate report ${reportKind}`);
    }

    for (const alias of extractPhase32CandidateEvidenceAliases(record)) {
      if (aliases.has(alias)) {
        fail(`candidate evidence alias ${alias} is duplicated`);
      }
      aliases.add(alias);
      bindings.push(
        Object.freeze({
          findingId,
          alias,
          reportKind,
          reportSha256: report.reportSha256,
          externalWalkthroughBlocked:
            findingId === "STH-024" &&
            options.externalWalkthroughAvailable !== true,
        }),
      );
    }
  }

  return Object.freeze(bindings);
}

type ExpectedServerGate = Readonly<{
  expectedValue: string;
  findingIds: readonly string[];
}>;

/**
 * Returns a fresh environment with every DISABLED LC1 gate forced to its
 * ledger value. Ambient values can never override the ledger.
 */
export function applyPhase32DisabledServerGates(
  ledger: Phase32FindingsLedger,
  ambientEnvironment: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const expectedGates = collectDisabledServerGates(ledger);
  const nodeEnvironment =
    ambientEnvironment.NODE_ENV === "production" ||
    ambientEnvironment.NODE_ENV === "development" ||
    ambientEnvironment.NODE_ENV === "test"
      ? ambientEnvironment.NODE_ENV
      : "test";
  const environment: NodeJS.ProcessEnv = {
    ...ambientEnvironment,
    NODE_ENV: nodeEnvironment,
  };
  for (const [key, gate] of expectedGates) {
    environment[key] = gate.expectedValue;
  }
  assertPhase32DisabledServerGates(ledger, environment);
  return environment;
}

/**
 * Fail-closed validation used both after applying gates and before running a
 * candidate command.
 */
export function assertPhase32DisabledServerGates(
  ledger: Phase32FindingsLedger,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  for (const [key, gate] of collectDisabledServerGates(ledger)) {
    if (environment[key] !== gate.expectedValue) {
      fail(
        `${key} must equal ${JSON.stringify(gate.expectedValue)} for ${gate.findingIds.join(", ")}`,
      );
    }
  }
}

function collectDisabledServerGates(
  ledger: Phase32FindingsLedger,
): ReadonlyMap<string, ExpectedServerGate> {
  assertCompleteFindingInventory(
    ledger.records.map((record) => record.id),
    "findings ledger",
  );

  const gates = new Map<
    string,
    { expectedValue: string; findingIds: string[] }
  >();
  for (const record of ledger.records) {
    if (record.status !== "DISABLED") continue;
    for (const gate of record.disablement.serverGates) {
      const existing = gates.get(gate.key);
      if (
        existing !== undefined &&
        existing.expectedValue !== gate.expectedValue
      ) {
        fail(
          `conflicting values for ${gate.key}: ${JSON.stringify(existing.expectedValue)} from ${existing.findingIds.join(", ")} and ${JSON.stringify(gate.expectedValue)} from ${record.id}`,
        );
      }
      if (existing === undefined) {
        gates.set(gate.key, {
          expectedValue: gate.expectedValue,
          findingIds: [record.id],
        });
      } else if (!existing.findingIds.includes(record.id)) {
        existing.findingIds.push(record.id);
      }
    }
  }
  return gates;
}

function assertCompleteFindingInventory(
  ids: readonly string[],
  label: string,
): void {
  const uniqueIds = new Set(ids);
  if (
    ids.length !== PHASE32_FINDING_IDS.length ||
    uniqueIds.size !== PHASE32_FINDING_IDS.length ||
    !PHASE32_FINDING_IDS.every((id) => uniqueIds.has(id))
  ) {
    fail(`${label} must contain STH-001 through STH-037 exactly once`);
  }
}

function fail(message: string): never {
  throw new Error(`Phase 32 candidate evidence invalid: ${message}.`);
}
