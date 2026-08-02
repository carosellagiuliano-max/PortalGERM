import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vitestEntrypoint = resolve(
  process.cwd(),
  "node_modules",
  "vitest",
  "vitest.mjs",
);
if (!existsSync(vitestEntrypoint)) {
  throw new Error("VITEST_ENTRYPOINT_MISSING");
}
const providerUnitFiles = Object.freeze(
  [
    ...execFileSync(
      "git",
      ["ls-files", "-z", "--", "tests/unit/config", "tests/unit/providers"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        windowsHide: true,
      },
    )
      .split("\0")
      .filter((path) => /\.test\.tsx?$/u.test(path)),
    "tests/unit/ops/phase33-document-provider-binding.test.ts",
    "tests/unit/ops/phase33-provider-health-monitor.test.ts",
    "tests/unit/privacy/phase33-privacy-worker-policy.test.ts",
  ]
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort(),
);
if (providerUnitFiles.length === 0) {
  throw new Error("PHASE33_PROVIDER_UNIT_FILES_MISSING");
}
const commands: readonly (readonly string[])[] = Object.freeze([
  // A clean process per jsdom file avoids Windows fork-start exhaustion while
  // preserving Vitest isolation and the exact tracked provider test scope.
  ...providerUnitFiles.map((path) =>
    Object.freeze([
      "run",
      "--config",
      "vitest.config.ts",
      path,
      "--no-file-parallelism",
    ]),
  ),
  Object.freeze([
    "run",
    "--config",
    "vitest.integration.config.ts",
    "tests/integration/billing/phase33-subscription-provider-lifecycle-postgres.test.ts",
    "tests/integration/billing/real-payment-lifecycle-postgres.test.ts",
    "tests/integration/billing/reconciliation-postgres.test.ts",
    "tests/integration/candidate/phase33-job-alert-outbox-postgres.test.ts",
    "tests/integration/documents/phase33-provider-authority-postgres.test.ts",
    "tests/integration/ops/phase33-provider-activation-immutability-postgres.test.ts",
    "tests/integration/privacy/phase33-privacy-approval-worker-postgres.test.ts",
    "tests/integration/privacy/phase33-privacy-delete-notification-postgres.test.ts",
    "tests/integration/providers/email/resend-event-inbox-postgres.test.ts",
    "tests/integration/schema/phase33-payment-upgrade-migration-postgres.test.ts",
    "--no-file-parallelism",
  ]),
]);

for (const args of commands) {
  const result = spawnSync(process.execPath, [vitestEntrypoint, ...args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    if (result.error !== undefined) {
      process.stderr.write(
        `PHASE33_PROVIDER_GATE_SPAWN_FAILED:${result.error.message}\n`,
      );
    }
    process.exitCode = result.status ?? 1;
    break;
  }
}
