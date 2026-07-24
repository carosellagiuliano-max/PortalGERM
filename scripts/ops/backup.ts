import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
} from "node:fs";
import {
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import {
  resolveBackupContract,
  type BackupContract,
} from "@/lib/ops/recovery-contract";
import { loadLocalEnvironment } from "@/scripts/load-local-environment";
import {
  captureDiagnostics,
  redact,
  runRecoveryOperations,
  spawnAge,
  spawnPostgresTool,
  waitForChild,
} from "@/scripts/ops/process-tools";

await main();

async function main() {
  try {
    loadLocalEnvironment();
    const contract = resolveBackupContract(process.argv.slice(2), process.env);
    await createEncryptedBackup(contract);
  } catch (error) {
    console.error(
      redact(error instanceof Error ? error.message : "Backup failed."),
    );
    process.exitCode = 1;
  }
}

async function createEncryptedBackup(contract: BackupContract) {
  const temporaryCiphertext = `${contract.outputPath}.partial-${randomUUID()}`;
  const temporaryChecksum = `${contract.checksumPath}.partial-${randomUUID()}`;
  let ownsFinalCiphertext = false;
  let ownsFinalChecksum = false;
  try {
    const ciphertext = createWriteStream(temporaryCiphertext, {
      flags: "wx",
      mode: 0o600,
    });
    const dump = spawnPostgresTool(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl"],
      contract.source.url,
      "ignore",
    );
    const encrypt = spawnAge(["--recipient", contract.recipient], "pipe");
    const dumpDiagnostics = captureDiagnostics(dump);
    const ageDiagnostics = captureDiagnostics(encrypt);

    const operations = [
      pipeline(dump.stdout, encrypt.stdin),
      pipeline(encrypt.stdout, ciphertext),
      waitForChild(dump, "pg_dump", dumpDiagnostics),
      waitForChild(encrypt, "age encryption", ageDiagnostics),
    ];
    await runRecoveryOperations(
      "encrypted backup pipeline",
      [dump, encrypt],
      operations,
    );

    const checksum = await sha256(temporaryCiphertext);
    await rename(temporaryCiphertext, contract.outputPath);
    ownsFinalCiphertext = true;
    await writeFile(temporaryChecksum, `${checksum}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryChecksum, contract.checksumPath);
    ownsFinalChecksum = true;
    console.info(
      `Encrypted backup completed for ${contract.source.databaseName}; SHA-256 ${checksum}. No plaintext dump was written.`,
    );
  } catch (error) {
    const cleanup = await Promise.allSettled([
      rm(temporaryCiphertext, { force: true }),
      rm(temporaryChecksum, { force: true }),
      ...(ownsFinalCiphertext
        ? [rm(contract.outputPath, { force: true })]
        : []),
      ...(ownsFinalChecksum
        ? [rm(contract.checksumPath, { force: true })]
        : []),
    ]);
    const cleanupFailures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        "Backup failed and one or more owned artifacts could not be removed.",
      );
    }
    throw error;
  }
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}
