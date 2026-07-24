import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLibpqEnvironment,
  parseCiphertextChecksum,
  resolveBackupContract,
  resolveRestoreContract,
} from "@/lib/ops/recovery-contract";

const temporaryPaths: string[] = [];
const repository = process.cwd();
const recipient = `age1${"q".repeat(58)}`;

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("Phase-18 recovery contract", () => {
  it("accepts only an external encrypted backup for an allowlisted release DB", async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, "release.dump.age");
    const result = resolveBackupContract(
      ["--source", "release-test", "--out", output],
      environment(),
      repository,
    );

    expect(result.outputPath).toBe(output);
    expect(result.checksumPath).toBe(`${output}.sha256`);
    expect(result.source.databaseName).toMatch(
      /^swisstalenthub_release_test_[0-9a-f]{12,32}$/u,
    );
    expect(result.recipient).toBe(recipient);
  });

  it("refuses production runtimes, shared DB names and repository artifacts", async () => {
    const directory = await temporaryDirectory();
    const output = join(directory, "release.dump.age");
    expect(() =>
      resolveBackupContract(
        ["--source", "release-test", "--out", output],
        environment({ APP_ENV: "production" }),
        repository,
      ),
    ).toThrow(/local or CI/u);

    expect(() =>
      resolveBackupContract(
        ["--source", "release-test", "--out", output],
        environment({
          DATABASE_URL:
            "postgresql://user:password@127.0.0.1:5432/swisstalenthub?schema=public",
        }),
        repository,
      ),
    ).toThrow(/allowlist/u);

    expect(() =>
      resolveBackupContract(
        [
          "--source",
          "release-test",
          "--out",
          join(repository, "unsafe.dump.age"),
        ],
        environment(),
        repository,
      ),
    ).toThrow(/outside the repository/u);

    expect(() =>
      resolveBackupContract(
        ["--source", "release-test", "--out", output],
        environment({
          DATABASE_URL:
            "postgresql://user:password@database.internal:5432/swisstalenthub_release_test_123456789abc?schema=public",
        }),
        repository,
      ),
    ).toThrow(/loopback/u);

    expect(() =>
      resolveBackupContract(
        [
          "--source",
          "release-test",
          "--out",
          join(directory, "missing", "release.dump.age"),
        ],
        environment(),
        repository,
      ),
    ).toThrow(/parent directory/u);
  });

  it("requires a distinct, empty-by-contract restore target and external identity", async () => {
    const directory = await temporaryDirectory();
    const input = join(directory, "release.dump.age");
    const identity = join(directory, "identity.txt");
    await writeFile(input, "ciphertext", "utf8");
    await writeFile(`${input}.sha256`, `${"a".repeat(64)}\n`, "utf8");
    await writeFile(identity, "not-real-test-identity", {
      encoding: "utf8",
      mode: 0o600,
    });

    const result = resolveRestoreContract(
      ["--in", input, "--target", "restore-test"],
      environment({ BACKUP_AGE_IDENTITY_FILE: identity }),
      repository,
    );

    expect(result.inputPath).toBe(input);
    expect(result.target.databaseName).toMatch(
      /^swisstalenthub_restore_test_[0-9a-f]{12,32}$/u,
    );
    expect(result.target.identity).not.toBe(result.source.identity);
    expect(result.identityFile).toBe(identity);

    if (process.platform !== "win32") {
      await chmod(identity, 0o644);
      expect(() =>
        resolveRestoreContract(
          ["--in", input, "--target", "restore-test"],
          environment({ BACKUP_AGE_IDENTITY_FILE: identity }),
          repository,
        ),
      ).toThrow(/group or other permissions/u);
    }

    expect(() =>
      resolveRestoreContract(
        ["--in", input, "--target", "restore-test"],
        environment({ BACKUP_AGE_IDENTITY_FILE: directory }),
        repository,
      ),
    ).toThrow(/regular file/u);
  });

  it("rejects unknown aliases, malformed checksums and non-absolute artifacts", () => {
    expect(() =>
      resolveBackupContract(
        ["--source", "shared", "--out", "relative.dump.age"],
        environment(),
        repository,
      ),
    ).toThrow(/allowlisted alias/u);
    expect(() => parseCiphertextChecksum("not-a-checksum")).toThrow(
      /SHA-256/u,
    );
    expect(() =>
      parseCiphertextChecksum(`${"a".repeat(64)}\n${"b".repeat(64)}`),
    ).toThrow(/SHA-256/u);
    expect(parseCiphertextChecksum(`${"A".repeat(64)}\n`)).toBe(
      "a".repeat(64),
    );
  });

  it("derives libpq process variables without putting credentials in arguments", () => {
    expect(
      createLibpqEnvironment(
        "postgresql://ops-user:s3cret@127.0.0.1:5544/release_test_123?schema=public&sslmode=require",
      ),
    ).toEqual({
      PGHOST: "127.0.0.1",
      PGPORT: "5544",
      PGUSER: "ops-user",
      PGPASSWORD: "s3cret",
      PGDATABASE: "release_test_123",
      PGCONNECT_TIMEOUT: "10",
      PGSSLMODE: "require",
    });

    expect(
      createLibpqEnvironment(
        "postgresql://ops-user:s3cret@[::1]:5544/release_test_123?schema=public",
      ).PGHOST,
    ).toBe("::1");
  });
});

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: "local",
    NODE_ENV: "development",
    DATABASE_URL:
      "postgresql://ops-user:password@127.0.0.1:5432/swisstalenthub_release_test_123456789abc?schema=public",
    TEST_DATABASE_URL:
      "postgresql://ops-user:password@127.0.0.1:5432/swisstalenthub_restore_test_123456789abc?schema=public",
    BACKUP_AGE_RECIPIENT: recipient,
    ...overrides,
  };
}

async function temporaryDirectory() {
  const directory = join(
    tmpdir(),
    `swisstalenthub-phase18-${crypto.randomUUID()}`,
  );
  await mkdir(directory, { recursive: true });
  temporaryPaths.push(directory);
  return directory;
}
