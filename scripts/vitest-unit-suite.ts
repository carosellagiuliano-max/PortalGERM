import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  assertVitestOutputHasNoInfrastructureFailures,
  unitTestInvocations,
} from "@/lib/release/phase33-test-output-policy";

const maxOutputBytes = 8 * 1024 * 1024;
const vitestEntrypoint = resolve(
  process.cwd(),
  "node_modules",
  "vitest",
  "vitest.mjs",
);

try {
  if (!existsSync(vitestEntrypoint)) {
    throw new Error("VITEST_ENTRYPOINT_MISSING");
  }
  const forwardedArguments = process.argv.slice(2);
  const discoveredUnitTestFiles =
    forwardedArguments.length === 0 ? await discoverUnitTestFiles() : [];
  const invocations = unitTestInvocations(
    forwardedArguments,
    discoveredUnitTestFiles,
  );
  for (const invocation of invocations) {
    await runVitest(invocation);
  }
  if (forwardedArguments.length === 0) {
    process.stdout.write(
      `${JSON.stringify({
        command: "vitest-unit-suite",
        status: "PASS",
        files: discoveredUnitTestFiles.length,
        invocations: invocations.length,
      })}\n`,
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "UNIT_TEST_SUITE_FAILED"}\n`,
  );
  process.exitCode = 1;
}

async function discoverUnitTestFiles(): Promise<readonly string[]> {
  const root = resolve(process.cwd(), "tests", "unit");
  const discovered: string[] = [];
  await visit(root);
  return Object.freeze(
    discovered.sort((left, right) => left.localeCompare(right, "en")),
  );

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && /\.test\.tsx?$/u.test(entry.name)) {
        discovered.push(
          relative(process.cwd(), absolutePath).split(sep).join("/"),
        );
      }
    }
  }
}

function runVitest(arguments_: readonly string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [vitestEntrypoint, ...arguments_], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const collect = (chunk: Buffer, stream: NodeJS.WriteStream) => {
      stream.write(chunk);
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish(() => rejectRun(new Error("VITEST_OUTPUT_LIMIT_EXCEEDED")));
        return;
      }
      output.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, process.stderr));
    child.once("error", (error) => finish(() => rejectRun(error)));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(() =>
          rejectRun(
            new Error(`UNIT_TEST_SHARD_FAILED:EXIT_${String(code ?? 1)}`),
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
