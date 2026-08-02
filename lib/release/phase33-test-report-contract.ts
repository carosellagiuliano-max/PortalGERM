import { z } from "zod";

import {
  PHASE33_RELEASE_POLICY_VERSION,
  PHASE33_TECHNICAL_GATE_IDS,
} from "@/lib/release/phase33-release-verdict";
import { PHASE33_APPLICATION_ARTIFACT_KIND } from "@/lib/release/phase33-artifact";

export const PHASE33_TEST_COMMAND_IDS = Object.freeze([
  "dependency-install",
  "environment",
  "db-generate",
  "db-validate",
  "db-migrate",
  "db-migrate-status",
  "db-seed-first",
  "db-seed-second",
  "seed-verify",
  "db-smoke",
  "phase33-scale",
  "phase33-audit",
  "plan-audit",
  "route-audit",
  "security-release-scan",
  "license-audit",
  "lint",
  "typecheck",
  "unit",
  "integration",
  "build",
  "http",
  "hsts",
  "phase33-e2e",
  "browser",
  "worker-chaos",
  "worker-benchmark",
  "providers",
  "providers-smoke",
  "documents-smoke",
  "recovery",
  "compose-local-config",
  "compose-local-up",
  "compose-local-repeat",
  "compose-contract-config",
  "compose-contract-smoke",
  "compose-contract-repeat",
  "dependency-security",
] as const);

export const PHASE33_COMMAND_LOG_MAX_BYTES = 8 * 1024 * 1024;

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);

const commandSchema = z
  .strictObject({
    id: z.enum(PHASE33_TEST_COMMAND_IDS),
    command: z.string().trim().min(1).max(1_024),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    durationMilliseconds: z.number().int().nonnegative(),
    exitCode: z.literal(0),
    outputDigest: digestSchema,
  })
  .superRefine((command, context) => {
    const observedDuration =
      Date.parse(command.completedAt) - Date.parse(command.startedAt);
    if (
      observedDuration < 0 ||
      observedDuration !== command.durationMilliseconds
    ) {
      context.addIssue({
        code: "custom",
        path: ["durationMilliseconds"],
        message: "must exactly match the ordered command timestamps",
      });
    }
  });

const gateSchema = z.strictObject({
  gateId: z.enum(PHASE33_TECHNICAL_GATE_IDS),
  outcome: z.literal("PASS"),
  evidenceDigest: digestSchema,
});

const runtimeConfigurationSchema = <
  TProfile extends "local-mock" | "production-contract",
>(
  profile: TProfile,
) =>
  z.strictObject({
    profile: z.literal(profile),
    projectName: z.string().regex(/^swisstalenthub-phase33-[a-z0-9-]{1,42}$/u),
    digest: digestSchema,
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(1024 * 1024),
    services: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u))
      .min(1)
      .max(64),
    networks: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/u))
      .min(1)
      .max(64),
  });

export const phase33TestReportSchema = z
  .strictObject({
    schemaVersion: z.literal("phase33-test-report-v1"),
    policyVersion: z.literal(PHASE33_RELEASE_POLICY_VERSION),
    candidateCommitSha: commitSchema,
    coveredTechnicalTargets: z.tuple([z.literal("LC4"), z.literal("LC5")]),
    isolatedCleanClone: z.literal(true),
    generatedAt: z.string().datetime({ offset: true }),
    tools: z.strictObject({
      node: z.string().trim().min(1).max(160),
      npm: z.string().trim().min(1).max(160),
      docker: z.string().trim().min(1).max(512),
      compose: z.string().trim().min(1).max(512),
      postgresql: z.string().trim().min(1).max(160),
      playwright: z.string().trim().min(1).max(160),
    }),
    artifacts: z.strictObject({
      recovery: z.strictObject({
        schemaVersion: z.literal("phase18-release-gate-v2"),
        digest: digestSchema,
        sizeBytes: z.number().int().positive(),
        fileName: z.literal("recovery-manifest.json"),
        runId: z.string().regex(/^[a-f0-9]{16}$/u),
        sourceDatabase: z
          .string()
          .regex(/^swisstalenthub_release_test_[a-f0-9]{16}$/u),
        restoreDatabase: z
          .string()
          .regex(/^swisstalenthub_restore_test_[a-f0-9]{16}$/u),
        localSnapshotToBackupLatencySeconds: z.number().int().nonnegative(),
        localRestoreDurationSeconds: z.number().int().nonnegative(),
      }),
      standalone: z.strictObject({
        kind: z.literal(PHASE33_APPLICATION_ARTIFACT_KIND),
        digest: digestSchema,
        fileCount: z.number().int().positive(),
        sizeBytes: z.number().int().positive(),
      }),
      ociImage: z.strictObject({
        imageId: digestSchema,
        sizeBytes: z.number().int().positive(),
        service: z.literal("app-contract"),
        revision: commitSchema,
        projectName: z
          .string()
          .regex(/^swisstalenthub-phase33-[a-z0-9-]{1,42}$/u),
        reference: z.string().trim().min(2).max(255),
      }),
      runtimeConfiguration: z.strictObject({
        localMock: runtimeConfigurationSchema("local-mock"),
        productionContract: runtimeConfigurationSchema("production-contract"),
      }),
    }),
    summary: z.strictObject({
      candidateTreeChecks: z.literal(4),
      commands: z.literal(PHASE33_TEST_COMMAND_IDS.length),
      failedCommands: z.literal(0),
      unexplainedSkips: z.literal(0),
    }),
    commands: z.array(commandSchema).length(PHASE33_TEST_COMMAND_IDS.length),
    gates: z.array(gateSchema).length(PHASE33_TECHNICAL_GATE_IDS.length),
  })
  .superRefine((report, context) => {
    if (report.artifacts.ociImage.revision !== report.candidateCommitSha) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", "ociImage", "revision"],
        message: "must match candidateCommitSha",
      });
    }
    if (
      report.artifacts.runtimeConfiguration.localMock.projectName ===
      report.artifacts.runtimeConfiguration.productionContract.projectName
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", "runtimeConfiguration"],
        message: "profiles must use distinct Compose projects",
      });
    }
    if (
      report.artifacts.runtimeConfiguration.localMock.digest ===
      report.artifacts.runtimeConfiguration.productionContract.digest
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts", "runtimeConfiguration"],
        message: "profiles must bind distinct rendered models",
      });
    }
    exactIdentitySet(
      report.commands.map(({ id }) => id),
      PHASE33_TEST_COMMAND_IDS,
      context,
      "commands",
    );
    exactIdentitySet(
      report.gates.map(({ gateId }) => gateId),
      PHASE33_TECHNICAL_GATE_IDS,
      context,
      "gates",
    );
  });

export type Phase33TestReport = z.infer<typeof phase33TestReportSchema>;

export function assertPhase33CommandLogSet(
  entries: readonly Readonly<{ name: string; regularFile: boolean }>[],
  commandIds: readonly string[],
) {
  const observed = entries.map(({ name }) => name).sort();
  const expected = commandIds.map((id) => `${id}.log`).sort();
  if (
    entries.some(({ regularFile }) => !regularFile) ||
    observed.length !== expected.length ||
    observed.some((name, index) => name !== expected[index])
  ) {
    throw new Error("PHASE33_CI_COMMAND_LOG_SET_INVALID");
  }
}

function exactIdentitySet(
  observed: readonly string[],
  required: readonly string[],
  context: z.RefinementCtx,
  path: string,
) {
  const unique = new Set(observed);
  const missing = required.filter((identity) => !unique.has(identity));
  if (unique.size !== observed.length || missing.length > 0) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: `must contain every fixed identity exactly once; missing=${missing.join(",")}`,
    });
  }
}
