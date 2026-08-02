import { createHash } from "node:crypto";

import { z } from "zod";

const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const databaseSchema = z
  .string()
  .regex(/^swisstalenthub_(?:release|restore|guard)_test_[a-f0-9]{16}$/u);
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PHASE33_REQUIRED_RECOVERY_COMMANDS = Object.freeze([
  ["git clean clone", "SUCCESS"],
  ["git detached release checkout", "SUCCESS"],
  ["ephemeral Age identity generation", "SUCCESS"],
  ["npm ci", "SUCCESS"],
  ["env:init CI no-write validation", "SUCCESS"],
  ["Prisma generate", "SUCCESS"],
  ["release DB migration", "SUCCESS"],
  ["deterministic seed first run", "SUCCESS"],
  ["deterministic seed second run", "SUCCESS"],
  ["read-only seed verification", "SUCCESS"],
  ["guard DB migration", "SUCCESS"],
  ["Production demo-seed guard", "EXPECTED_REFUSAL"],
  ["production build", "SUCCESS"],
  ["encrypted release backup", "SUCCESS"],
  ["isolated encrypted restore", "SUCCESS"],
  ["post-restore four-role public production smoke", "SUCCESS"],
  ["post-restore password reset browser journey", "SUCCESS"],
  ["route inventory audit", "SUCCESS"],
  ["plan evidence/link audit", "SUCCESS"],
  ["release secret scan", "SUCCESS"],
  ["license policy scan", "SUCCESS"],
] as const);

export const phase33RecoveryManifestSchema = z.strictObject({
  schemaVersion: z.literal("phase18-release-gate-v2"),
  status: z.literal("passed"),
  runId: z.string().regex(/^[a-f0-9]{16}$/u),
  release: z.strictObject({
    branch: z.string().max(255),
    commit: commitSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
  }),
  runtime: z.strictObject({
    node: z.string().min(1).max(160),
    npm: z.string().min(1).max(160),
    git: z.string().min(1).max(160),
    docker: z.string().min(1).max(512),
    compose: z.string().min(1).max(512),
    pgDump: z.string().min(1).max(512),
    pgRestore: z.string().min(1).max(512),
    age: z.string().min(1).max(512),
    os: z.string().min(1).max(160),
  }),
  database: z.strictObject({
    source: databaseSchema,
    restore: databaseSchema,
    productionGuard: databaseSchema,
    seedManifestSha256: sha256HexSchema,
  }),
  recovery: z.strictObject({
    ciphertextSha256: sha256HexSchema,
    encryptedBytes: z.number().int().positive(),
    location: z.string().min(1).max(512),
    retentionClass: z.string().min(1).max(256),
    retentionTarget: z.string().min(1).max(512),
    localSnapshotToBackupLatencySeconds: z.number().int().nonnegative(),
    localRestoreDurationSeconds: z.number().int().nonnegative(),
    unapprovedRpoHypothesisSeconds: z.number().int().positive(),
    unapprovedRtoHypothesisSeconds: z.number().int().positive(),
  }),
  commands: z
    .array(
      z
        .strictObject({
          command: z.string().min(1).max(512),
          durationMs: z.number().int().nonnegative(),
          exitCode: z.number().int().min(0).max(255),
          expectedOutcome: z.enum(["SUCCESS", "EXPECTED_REFUSAL"]),
        })
        .superRefine((command, context) => {
          const valid =
            (command.expectedOutcome === "SUCCESS" && command.exitCode === 0) ||
            (command.expectedOutcome === "EXPECTED_REFUSAL" &&
              command.exitCode !== 0);
          if (!valid) {
            context.addIssue({
              code: "custom",
              path: ["exitCode"],
              message: "must match the declared expected outcome",
            });
          }
        }),
    )
    .length(PHASE33_REQUIRED_RECOVERY_COMMANDS.length),
  cleanup: z.strictObject({
    backupRemoved: z.literal(true),
    cloneRemoved: z.literal(true),
    databasesRemoved: z.literal(true),
    identityRemoved: z.literal(true),
  }),
  knownLimitations: z.array(z.string().min(1).max(1_024)).min(1),
});

export function parsePhase33RecoveryEvidence(
  serialized: string,
  candidateCommitSha: string,
  outerCommandWindow?: Readonly<{
    startedAt: string;
    completedAt: string;
  }>,
) {
  const parsed = phase33RecoveryManifestSchema.parse(
    JSON.parse(serialized) as unknown,
  );
  if (parsed.release.commit !== candidateCommitSha) {
    throw new Error("PHASE33_RECOVERY_CANDIDATE_MISMATCH");
  }
  const expectedDatabases = {
    source: `swisstalenthub_release_test_${parsed.runId}`,
    restore: `swisstalenthub_restore_test_${parsed.runId}`,
    productionGuard: `swisstalenthub_guard_test_${parsed.runId}`,
  } as const;
  if (
    parsed.database.source !== expectedDatabases.source ||
    parsed.database.restore !== expectedDatabases.restore ||
    parsed.database.productionGuard !== expectedDatabases.productionGuard
  ) {
    throw new Error("PHASE33_RECOVERY_DATABASE_RUN_ID_MISMATCH");
  }
  if (
    Date.parse(parsed.release.completedAt) <
    Date.parse(parsed.release.startedAt)
  ) {
    throw new Error("PHASE33_RECOVERY_TIMESTAMP_ORDER_INVALID");
  }
  if (
    outerCommandWindow !== undefined &&
    (Date.parse(parsed.release.startedAt) <
      Date.parse(outerCommandWindow.startedAt) ||
      Date.parse(parsed.release.completedAt) >
        Date.parse(outerCommandWindow.completedAt))
  ) {
    throw new Error("PHASE33_RECOVERY_COMMAND_WINDOW_MISMATCH");
  }
  const commandsByName = new Map(
    parsed.commands.map((command) => [command.command, command] as const),
  );
  if (
    commandsByName.size !== parsed.commands.length ||
    commandsByName.size !== PHASE33_REQUIRED_RECOVERY_COMMANDS.length
  ) {
    throw new Error("PHASE33_RECOVERY_COMMAND_SET_INVALID");
  }
  for (const [
    commandName,
    expectedOutcome,
  ] of PHASE33_REQUIRED_RECOVERY_COMMANDS) {
    const command = commandsByName.get(commandName);
    if (command === undefined || command.expectedOutcome !== expectedOutcome) {
      throw new Error("PHASE33_RECOVERY_COMMAND_SET_INVALID");
    }
  }
  const productionGuards = parsed.commands.filter(
    ({ command }) => command === "Production demo-seed guard",
  );
  if (
    productionGuards.length !== 1 ||
    productionGuards[0]?.expectedOutcome !== "EXPECTED_REFUSAL" ||
    productionGuards[0].exitCode === 0
  ) {
    throw new Error("PHASE33_RECOVERY_PRODUCTION_GUARD_UNPROVEN");
  }
  return Object.freeze({
    serialized,
    artifact: Object.freeze({
      schemaVersion: parsed.schemaVersion,
      digest: `sha256:${createHash("sha256")
        .update(serialized, "utf8")
        .digest("hex")}` as const,
      sizeBytes: Buffer.byteLength(serialized, "utf8"),
      fileName: "recovery-manifest.json" as const,
      runId: parsed.runId,
      sourceDatabase: parsed.database.source,
      restoreDatabase: parsed.database.restore,
      localSnapshotToBackupLatencySeconds:
        parsed.recovery.localSnapshotToBackupLatencySeconds,
      localRestoreDurationSeconds: parsed.recovery.localRestoreDurationSeconds,
    }),
  });
}
