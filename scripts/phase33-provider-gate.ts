import { spawnSync } from "node:child_process";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const commands = Object.freeze([
  [
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "tests/unit/config",
    "tests/unit/ops/phase33-document-provider-binding.test.ts",
    "tests/unit/ops/phase33-provider-health-monitor.test.ts",
    "tests/unit/providers",
    "tests/unit/privacy/phase33-privacy-worker-policy.test.ts",
    "--no-file-parallelism",
  ],
  [
    "vitest",
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
  ],
] as const);

for (const args of commands) {
  const result = spawnSync(npx, [...args], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
