import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeDigestSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u);
const safeReferenceSchema = z.string().min(2).max(255);
const instantSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const deploymentEvidenceSchema = z.strictObject({
  contract: z.literal("phase23-staging-deploy-v1"),
  environment: z.literal("staging"),
  status: z.literal("PASSED"),
  artifactDigest: safeDigestSchema,
  testedArtifactDigest: safeDigestSchema,
  immutableArtifact: z.literal(true),
  scenarios: z
    .array(z.enum(["deploy", "migrate", "canary", "rollback"]))
    .length(4)
    .refine((values) => new Set(values).size === 4),
  migration: z.strictObject({
    emptyDatabasePassed: z.literal(true),
    upgradeDatabasePassed: z.literal(true),
    pendingCount: z.literal(0),
    lockBudgetExceeded: z.literal(false),
  }),
  canary: z.strictObject({
    liveStatus: z.literal(200),
    readyStatus: z.literal(200),
    workerStatus: z.literal("HEALTHY"),
    demoRowCount: z.literal(0),
  }),
  rollback: z.strictObject({
    passed: z.literal(true),
    durationMilliseconds: z.int().nonnegative(),
    approvedBudgetMilliseconds: z.int().positive(),
  }),
  owner: safeReferenceSchema,
  evidenceRef: safeReferenceSchema,
  recordedAt: instantSchema,
});

const incidentScenarioSchema = z.strictObject({
  scenario: z.enum([
    "queue-age",
    "dlq",
    "provider-outage",
    "backup-failure",
    "pii-canary",
  ]),
  alertAt: instantSchema,
  pageAt: instantSchema,
  acknowledgedAt: instantSchema,
  recoveredAt: instantSchema,
  primaryOwner: safeReferenceSchema,
  secondaryOwner: safeReferenceSchema,
  runbookRef: safeReferenceSchema,
});

const incidentEvidenceSchema = z.strictObject({
  contract: z.literal("phase23-incident-drill-v1"),
  environment: z.literal("staging"),
  pagerMode: z.literal("sandbox"),
  status: z.literal("PASSED"),
  scenarios: z
    .array(incidentScenarioSchema)
    .length(5)
    .refine(
      (values) => new Set(values.map(({ scenario }) => scenario)).size === 5,
    ),
  alertIntervalMilliseconds: z.int().positive(),
  approvedAckMilliseconds: z.int().positive(),
  piiCanaryMatches: z.literal(0),
  secretCanaryMatches: z.literal(0),
  owner: safeReferenceSchema,
  evidenceRef: safeReferenceSchema,
  recordedAt: instantSchema,
});

const restoreEvidenceSchema = z.strictObject({
  contract: z.literal("phase23-backup-restore-v1"),
  environment: z.literal("staging"),
  status: z.literal("PASSED"),
  sourceId: safeReferenceSchema,
  restoreId: safeReferenceSchema,
  encrypted: z.literal(true),
  identitySeparated: z.literal(true),
  sourceChecksum: sha256Schema,
  restoredChecksum: sha256Schema,
  sourceSchemaDigest: sha256Schema,
  restoredSchemaDigest: sha256Schema,
  sourceCountDigest: sha256Schema,
  restoredCountDigest: sha256Schema,
  backupCapturedAt: instantSchema,
  restoreStartedAt: instantSchema,
  restoreCompletedAt: instantSchema,
  measuredRpoMilliseconds: z.int().nonnegative(),
  measuredRtoMilliseconds: z.int().nonnegative(),
  approvedRpoMilliseconds: z.int().positive(),
  approvedRtoMilliseconds: z.int().positive(),
  approvalRef: safeReferenceSchema,
  owner: safeReferenceSchema,
  evidenceRef: safeReferenceSchema,
  recordedAt: instantSchema,
});

export async function loadHashedExternalEvidence(input: Readonly<{
  expectedSha256: string | undefined;
  path: string | undefined;
  repositoryRoot: string;
}>): Promise<unknown> {
  if (
    input.path === undefined ||
    input.expectedSha256 === undefined ||
    !sha256Schema.safeParse(input.expectedSha256).success ||
    !isAbsolute(input.path)
  ) {
    throw new Error("EXTERNAL_EVIDENCE_REFERENCE_INVALID");
  }
  const absolutePath = resolve(input.path);
  const repository = resolve(input.repositoryRoot);
  const relativeToRepository = relative(repository, absolutePath);
  if (
    relativeToRepository === "" ||
    (
      !relativeToRepository.startsWith("..") &&
      !isAbsolute(relativeToRepository)
    )
  ) {
    throw new Error("EXTERNAL_EVIDENCE_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const metadata = await stat(absolutePath);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > 1_000_000) {
    throw new Error("EXTERNAL_EVIDENCE_FILE_INVALID");
  }
  const bytes = await readFile(absolutePath);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== input.expectedSha256) {
    throw new Error("EXTERNAL_EVIDENCE_DIGEST_MISMATCH");
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("EXTERNAL_EVIDENCE_JSON_INVALID");
  }
}

export function validateStagingDeploymentEvidence(
  raw: unknown,
  input: Readonly<{
    artifactDigest: string;
    scenarios: readonly string[];
  }>,
) {
  const evidence = deploymentEvidenceSchema.parse(raw);
  if (
    evidence.artifactDigest !== input.artifactDigest ||
    evidence.testedArtifactDigest !== input.artifactDigest ||
    evidence.rollback.durationMilliseconds >
      evidence.rollback.approvedBudgetMilliseconds ||
    input.scenarios.join("\0") !== evidence.scenarios.join("\0")
  ) {
    throw new Error("STAGING_DEPLOYMENT_EVIDENCE_MISMATCH");
  }
  return Object.freeze({
    contract: evidence.contract,
    environment: evidence.environment,
    artifactDigest: evidence.artifactDigest,
    status: evidence.status,
    owner: evidence.owner,
    evidenceRef: evidence.evidenceRef,
    rollbackMilliseconds: evidence.rollback.durationMilliseconds,
  });
}

export function validateIncidentDrillEvidence(
  raw: unknown,
  requestedScenarios: readonly string[],
) {
  const evidence = incidentEvidenceSchema.parse(raw);
  if (
    requestedScenarios.join("\0") !==
    evidence.scenarios.map(({ scenario }) => scenario).join("\0")
  ) {
    throw new Error("INCIDENT_SCENARIO_EVIDENCE_MISMATCH");
  }
  for (const scenario of evidence.scenarios) {
    const alertToPage =
      scenario.pageAt.getTime() - scenario.alertAt.getTime();
    const pageToAck =
      scenario.acknowledgedAt.getTime() - scenario.pageAt.getTime();
    if (
      alertToPage < 0 ||
      alertToPage > evidence.alertIntervalMilliseconds * 2 ||
      pageToAck < 0 ||
      pageToAck > evidence.approvedAckMilliseconds ||
      scenario.recoveredAt.getTime() < scenario.acknowledgedAt.getTime() ||
      scenario.primaryOwner === scenario.secondaryOwner
    ) {
      throw new Error("INCIDENT_TIMELINE_EVIDENCE_INVALID");
    }
  }
  return Object.freeze({
    contract: evidence.contract,
    environment: evidence.environment,
    pagerMode: evidence.pagerMode,
    status: evidence.status,
    scenarioCount: evidence.scenarios.length,
    owner: evidence.owner,
    evidenceRef: evidence.evidenceRef,
  });
}

export function validateBackupRestoreEvidence(
  raw: unknown,
  input: Readonly<{ restoreId: string; sourceId: string }>,
) {
  const evidence = restoreEvidenceSchema.parse(raw);
  if (
    evidence.sourceId !== input.sourceId ||
    evidence.restoreId !== input.restoreId ||
    evidence.sourceId === evidence.restoreId ||
    evidence.sourceChecksum !== evidence.restoredChecksum ||
    evidence.sourceSchemaDigest !== evidence.restoredSchemaDigest ||
    evidence.sourceCountDigest !== evidence.restoredCountDigest ||
    evidence.restoreCompletedAt.getTime() <
      evidence.restoreStartedAt.getTime() ||
    evidence.measuredRpoMilliseconds > evidence.approvedRpoMilliseconds ||
    evidence.measuredRtoMilliseconds > evidence.approvedRtoMilliseconds
  ) {
    throw new Error("BACKUP_RESTORE_EVIDENCE_INVALID");
  }
  return Object.freeze({
    contract: evidence.contract,
    environment: evidence.environment,
    sourceId: evidence.sourceId,
    restoreId: evidence.restoreId,
    measuredRpoMilliseconds: evidence.measuredRpoMilliseconds,
    measuredRtoMilliseconds: evidence.measuredRtoMilliseconds,
    approvalRef: evidence.approvalRef,
    owner: evidence.owner,
    evidenceRef: evidence.evidenceRef,
    status: evidence.status,
  });
}
