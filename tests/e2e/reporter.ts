import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import {
  PHASE17_CASES,
  PHASE17_FIXTURE_VERSION,
} from "@/tests/e2e/phase17-cases";
import {
  classifyPhase17Result,
  configuredRetryPolicy,
  PHASE17_MANIFEST_SCHEMA_VERSION,
  PHASE17_NETWORK_POLICY,
  type Phase17RecordedResult,
} from "@/tests/e2e/manifest-contract";

export default class Phase17Reporter implements Reporter {
  private startedAt = new Date();
  private rootDir = process.cwd();
  private retryPolicy = 0;
  private results: Phase17RecordedResult[] = [];

  onBegin(config: FullConfig, _suite: Suite) {
    this.startedAt = new Date();
    this.rootDir = config.rootDir;
    this.retryPolicy = configuredRetryPolicy(config.projects);
    this.results = [];
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const file = relativeToRoot(this.rootDir, test.location.file);
    this.results.push(
      Object.freeze({
        id: classifyPhase17Result(test.title, file),
        project: test.parent.project()?.name ?? "unknown",
        title: test.title,
        file,
        status: result.status,
        durationMilliseconds: result.duration,
        retry: result.retry,
        errors: Object.freeze(
          result.errors.map((error) =>
            sanitizeError(error.message ?? error.value ?? "Unknown test error"),
          ),
        ),
      }),
    );
  }

  onEnd(result: FullResult) {
    const outputPath = resolve(
      process.env.PHASE17_MANIFEST_PATH ??
        "test-results/phase17/run-manifest.json",
    );
    const cases = PHASE17_CASES.map((entry) =>
      Object.freeze({
        ...entry,
        results: Object.freeze(
          this.results.filter((candidate) => candidate.id === entry.id),
        ),
      }),
    );
    const quality = Object.freeze(
      this.results.filter((candidate) => candidate.id === "QUALITY"),
    );
    const unclassified = Object.freeze(
      this.results.filter((candidate) => candidate.id === "UNCLASSIFIED"),
    );
    const manifest = Object.freeze({
      schemaVersion: PHASE17_MANIFEST_SCHEMA_VERSION,
      fixtureVersion: PHASE17_FIXTURE_VERSION,
      commit: safeToken(process.env.PHASE17_COMMIT_SHA, "unknown"),
      runtime: Object.freeze({
        node: process.version,
        npm: safeToken(process.env.PHASE17_NPM_VERSION, npmVersion()),
        playwright: safeToken(process.env.PHASE17_PLAYWRIGHT_VERSION, "unknown"),
        projects: Object.freeze([
          ...new Set(this.results.map((entry) => entry.project)),
        ]),
      }),
      database: Object.freeze({
        anonymousRunId: safeToken(
          process.env.PHASE17_DATABASE_RUN_ID,
          "unknown",
        ),
        migrationCount: numericEnvironment("PHASE17_MIGRATION_COUNT"),
        migrationHash: safeToken(
          process.env.PHASE17_MIGRATION_HASH,
          "unknown",
        ),
      }),
      networkPolicy: PHASE17_NETWORK_POLICY,
      retryPolicy: this.retryPolicy,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: result.status,
      counts: Object.freeze(countResults(this.results)),
      cases: Object.freeze(cases),
      quality,
      unclassified,
      artifacts: Object.freeze({
        htmlReport: "playwright-report/phase17",
        testResults: "test-results/phase17/artifacts",
      }),
      phase18Boundary:
        "E2E-08 clean clone, backup and restore are intentionally not claimed by Phase 17.",
    });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

function countResults(results: readonly Phase17RecordedResult[]) {
  return results.reduce(
    (counts, result) => {
      counts[result.status] += 1;
      return counts;
    },
    {
      passed: 0,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
    } satisfies Record<TestResult["status"], number>,
  );
}

function relativeToRoot(root: string, file: string) {
  const normalizedRoot = resolve(root).replaceAll("\\", "/");
  const normalizedFile = resolve(file).replaceAll("\\", "/");
  return normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
}

function sanitizeError(value: string) {
  return value
    .replaceAll(/postgres(?:ql)?:\/\/[^\s"']+/giu, "[REDACTED_DATABASE_URL]")
    .replaceAll(
      /((?:secret|token|password|authorization|cookie)[\w.-]*\s*[:=]\s*)[^\s,;]+/giu,
      "$1[REDACTED]",
    )
    .slice(0, 4_000);
}

function safeToken(value: string | undefined, fallback: string) {
  return value !== undefined && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)
    ? value
    : fallback;
}

function numericEnvironment(name: string) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function npmVersion() {
  const match = /npm\/([0-9.]+)/u.exec(process.env.npm_config_user_agent ?? "");
  return match?.[1] ?? "unknown";
}
