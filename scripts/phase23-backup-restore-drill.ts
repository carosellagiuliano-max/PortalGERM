import {
  loadHashedExternalEvidence,
  validateBackupRestoreEvidence,
} from "@/lib/ops/external-operations-evidence";

try {
  const command = parseArguments(process.argv.slice(2));
  if (
    command.environment !== "staging" ||
    process.env.APP_ENV !== "staging" ||
    process.env.PHASE23_SOURCE_DB_ID !== command.sourceId ||
    process.env.PHASE23_RESTORE_DB_ID !== command.restoreId
  ) {
    throw new Error("BACKUP_RESTORE_CONTEXT_MISMATCH");
  }
  const raw = await loadHashedExternalEvidence({
    path: process.env.PHASE23_RESTORE_EVIDENCE_PATH,
    expectedSha256: process.env.PHASE23_RESTORE_EVIDENCE_SHA256,
    repositoryRoot: process.cwd(),
  });
  const result = validateBackupRestoreEvidence(raw, {
    sourceId: command.sourceId,
    restoreId: command.restoreId,
  });
  process.stdout.write(
    `${JSON.stringify({ command: "phase23-backup-restore-drill", ...result })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      command: "phase23-backup-restore-drill",
      status: "BLOCKED",
      error: errorCode(error),
    })}\n`,
  );
  process.exitCode = 1;
}

function parseArguments(values: readonly string[]) {
  let environment: string | undefined;
  let sourceId: string | undefined;
  let restoreId: string | undefined;
  for (const value of values) {
    if (value === "--environment=staging") {
      environment = "staging";
      continue;
    }
    const source = /^--source=([A-Za-z0-9][A-Za-z0-9._:-]{1,127})$/u.exec(
      value,
    );
    if (source !== null) {
      sourceId = source[1];
      continue;
    }
    const restore = /^--restore=([A-Za-z0-9][A-Za-z0-9._:-]{1,127})$/u.exec(
      value,
    );
    if (restore !== null) {
      restoreId = restore[1];
      continue;
    }
    throw new Error("BACKUP_RESTORE_ARGUMENT_INVALID");
  }
  if (
    environment === undefined ||
    sourceId === undefined ||
    restoreId === undefined
  ) {
    throw new Error("BACKUP_RESTORE_ARGUMENT_INCOMPLETE");
  }
  return Object.freeze({ environment, sourceId, restoreId });
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "EXTERNAL_EVIDENCE_FAILED";
  return error.message
    .toUpperCase()
    .replaceAll(/[^A-Z0-9_:-]/gu, "_")
    .slice(0, 64);
}
