import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { assertVitestOutputHasNoInfrastructureFailures } from "@/lib/release/phase33-test-output-policy";
import {
  terminateRecoveryChild,
  type RecoveryChild,
} from "@/scripts/ops/process-tools";
import { createMigratedTestDatabase } from "@/tests/fixtures/isolated-postgres";

const maxOutputBytes = 16 * 1024 * 1024;
const vitestEntrypoint = resolve(
  process.cwd(),
  "node_modules",
  "vitest",
  "vitest.mjs",
);

const interruptController = new AbortController();
const interrupt = () => {
  if (!interruptController.signal.aborted) {
    interruptController.abort(
      new Error("INTEGRATION_TEST_SUITE_INTERRUPTED"),
    );
  }
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  await runIntegrationSuite(interruptController.signal);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "INTEGRATION_TEST_SUITE_FAILED"}\n`,
  );
  process.exitCode = 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}

async function runIntegrationSuite(signal: AbortSignal) {
  if (!existsSync(vitestEntrypoint)) {
    throw new Error("VITEST_ENTRYPOINT_MISSING");
  }
  let template:
    | Awaited<ReturnType<typeof createMigratedTestDatabase>>
    | undefined;
  try {
    template = await createMigratedTestDatabase("integration-suite-template", {
      asTemplate: true,
      signal,
      useTemplate: false,
    });
    assertNotInterrupted(signal);
    await template.sealForCloning(signal);
    assertNotInterrupted(signal);
    await runVitest(template.databaseName, process.argv.slice(2), signal);
  } finally {
    await template?.dispose();
  }
}

function runVitest(
  templateDatabaseName: string,
  arguments_: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        vitestEntrypoint,
        "run",
        "--config",
        "vitest.integration.config.ts",
        ...arguments_,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEST_DATABASE_TEMPLATE_NAME: templateDatabaseName,
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let interrupted = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const terminate = (error: Error) => {
      if (settled || interrupted) return;
      interrupted = true;
      void terminateRecoveryChild(child as unknown as RecoveryChild).then(
        () => finish(() => rejectRun(error)),
        (terminationError: unknown) =>
          finish(() => rejectRun(terminationError)),
      );
    };
    const abort = () => terminate(interruptionError(signal));
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
    const collect = (chunk: Buffer, stream: NodeJS.WriteStream) => {
      if (settled || interrupted) return;
      stream.write(chunk);
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminate(new Error("VITEST_OUTPUT_LIMIT_EXCEEDED"));
        return;
      }
      output.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, process.stderr));
    child.once("error", (error) => {
      if (!interrupted) finish(() => rejectRun(error));
    });
    child.once("close", (code) => {
      if (settled || interrupted) return;
      if (code !== 0) {
        finish(() =>
          rejectRun(
            new Error(
              `INTEGRATION_TEST_SUITE_FAILED:EXIT_${String(code ?? 1)}`,
            ),
          ),
        );
        return;
      }
      try {
        assertVitestOutputHasNoInfrastructureFailures(
          Buffer.concat(output, outputBytes).toString("utf8"),
        );
        finish(resolveRun);
      } catch (error) {
        finish(() => rejectRun(error));
      }
    });
  });
}

function assertNotInterrupted(signal: AbortSignal) {
  if (signal.aborted) throw interruptionError(signal);
}

function interruptionError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("INTEGRATION_TEST_SUITE_INTERRUPTED");
}
