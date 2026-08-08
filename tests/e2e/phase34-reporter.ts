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

const PHASE34_EVIDENCE_ID =
  /\[((?:E2E-34-(?:0[1-9]|1\d|20)|F34-[A-Z]+-[0-9]{3}(?:-[A-Z]+)?))\]/gu;

type RecordedResult = Readonly<{
  ids: readonly string[];
  project: string;
  title: string;
  file: string;
  status: TestResult["status"];
  durationMilliseconds: number;
  retry: number;
  errors: readonly string[];
}>;

export default class Phase34Reporter implements Reporter {
  private startedAt = new Date();
  private rootDir = process.cwd();
  private results: RecordedResult[] = [];

  onBegin(config: FullConfig, _suite: Suite) {
    this.startedAt = new Date();
    this.rootDir = config.rootDir;
    this.results = [];
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const ids = [...test.title.matchAll(PHASE34_EVIDENCE_ID)].map(
      (match) => match[1]!,
    );
    this.results.push(
      Object.freeze({
        ids: Object.freeze([...new Set(ids)]),
        project: test.parent.project()?.name ?? "unknown",
        title: test.title,
        file: relativeToRoot(this.rootDir, test.location.file),
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
      process.env.PHASE34_MANIFEST_PATH ??
        "test-results/phase34/run-manifest.pending.json",
    );
    const manifest = Object.freeze({
      schemaVersion: "phase34-browser-manifest-v2",
      candidateDigest: safeToken(
        process.env.PHASE34_CANDIDATE_DIGEST,
        "unknown",
      ),
      commit: safeToken(process.env.PHASE34_COMMIT_SHA, "unknown"),
      databaseRunId: safeToken(process.env.PHASE34_DATABASE_RUN_ID, "unknown"),
      environmentMatrix: Object.freeze([
        "local",
        "local-trust-sandbox",
        "preview",
      ]),
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: result.status,
      projects: Object.freeze([
        ...new Set(this.results.map((entry) => entry.project)),
      ]),
      counts: Object.freeze(countResults(this.results)),
      results: Object.freeze(this.results),
    });
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

function countResults(results: readonly RecordedResult[]) {
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
