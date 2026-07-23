import { z } from "zod";

import {
  PHASE17_CASES,
  PHASE17_FIXTURE_VERSION,
  type Phase17CaseId,
} from "@/tests/e2e/phase17-cases";

export const PHASE17_MANIFEST_SCHEMA_VERSION =
  "phase17-run-manifest-v1" as const;
export const PHASE17_NETWORK_POLICY = "loopback-only" as const;
export const PHASE17_JOURNEY_PROJECT = "chromium-journeys" as const;
export const PHASE17_MOBILE_PROJECT = "chromium-mobile-360" as const;
export const PHASE17_QUALITY_FILE =
  "quality/critical-routes.spec.ts" as const;

export const PHASE17_QUALITY_CONTRACT = Object.freeze([
  Object.freeze({
    project: PHASE17_JOURNEY_PROJECT,
    tag: "@quality-desktop",
    expectedCount: 5,
  }),
  Object.freeze({
    project: PHASE17_MOBILE_PROJECT,
    tag: "@quality-mobile",
    expectedCount: 5,
  }),
] as const);

export type Phase17ResultId =
  | Phase17CaseId
  | "QUALITY"
  | "UNCLASSIFIED";

export type Phase17RecordedResult = Readonly<{
  id: Phase17ResultId;
  project: string;
  title: string;
  file: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  durationMilliseconds: number;
  retry: number;
  errors: readonly string[];
}>;

export type Phase17RunIdentity = Readonly<{
  fixtureVersion: typeof PHASE17_FIXTURE_VERSION;
  commit: string;
  runtime: Readonly<{
    node: string;
    npm: string;
    playwright: string;
  }>;
  database: Readonly<{
    anonymousRunId: string;
    migrationCount: number;
    migrationHash: string;
  }>;
  networkPolicy: typeof PHASE17_NETWORK_POLICY;
}>;

export type Phase17ManifestValidationOptions = Readonly<{
  mode: "full" | "targeted";
  expectedIdentity: Phase17RunIdentity;
}>;

const resultStatusSchema = z.enum([
  "passed",
  "failed",
  "timedOut",
  "skipped",
  "interrupted",
]);

const recordedResultSchema = z.object({
  id: z.string().min(1),
  project: z.string().min(1),
  title: z.string().min(1),
  file: z.string().min(1),
  status: resultStatusSchema,
  durationMilliseconds: z.number().nonnegative(),
  retry: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

const countSchema = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  timedOut: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  interrupted: z.number().int().nonnegative(),
});

const manifestSchema = z.object({
  schemaVersion: z.literal(PHASE17_MANIFEST_SCHEMA_VERSION),
  fixtureVersion: z.string().min(1),
  commit: z.string().min(1),
  status: z.string(),
  retryPolicy: z.number().int().nonnegative(),
  runtime: z.object({
    node: z.string().min(1),
    npm: z.string().min(1),
    playwright: z.string().min(1),
    projects: z.array(z.string().min(1)),
  }),
  database: z.object({
    anonymousRunId: z.string().min(1),
    migrationCount: z.number().int().nonnegative(),
    migrationHash: z.string().min(1),
  }),
  networkPolicy: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  counts: countSchema,
  cases: z.array(
    z.object({
      id: z.string().min(1),
      results: z.array(recordedResultSchema),
    }),
  ),
  quality: z.array(recordedResultSchema),
  unclassified: z.array(recordedResultSchema),
});

type ParsedManifest = z.infer<typeof manifestSchema>;
type ParsedRecordedResult = z.infer<typeof recordedResultSchema>;

export function classifyPhase17Result(
  title: string,
  normalizedRelativeFile: string,
): Phase17ResultId {
  const match = /\[(E2E-0[1-7])\]/u.exec(title);
  if (match?.[1] !== undefined) {
    return match[1] as Phase17CaseId;
  }
  if (
    normalizedRelativeFile === PHASE17_QUALITY_FILE &&
    /(?:^|\s)@quality-(?:desktop|mobile)(?:\s|$)/u.test(title)
  ) {
    return "QUALITY";
  }
  return "UNCLASSIFIED";
}

export function configuredRetryPolicy(
  projects: readonly Readonly<{ retries: number }>[],
): number {
  if (projects.length === 0) {
    throw new Error("Phase 17 requires at least one configured Playwright project.");
  }
  const retries = projects.map(({ retries: value }) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Phase 17 received an invalid Playwright retry policy.");
    }
    return value;
  });
  return Math.max(...retries);
}

export function validatePhase17RunManifest(
  raw: unknown,
  options: Phase17ManifestValidationOptions,
): ParsedManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    contractFailure(
      `schema is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  const manifest = parsed.data;
  assertRunIdentity(manifest, options.expectedIdentity);
  assertRunWindow(manifest.startedAt, manifest.finishedAt);
  if (manifest.status !== "passed") {
    contractFailure(`Playwright status is ${manifest.status}, not passed`);
  }
  if (manifest.retryPolicy !== 0) {
    contractFailure(
      `configured retry policy is ${manifest.retryPolicy}, expected 0`,
    );
  }

  assertExactCaseInventory(manifest.cases);
  const results = recordedResults(manifest);
  if (results.length === 0) {
    contractFailure("no test result was recorded");
  }
  assertResultCounts(manifest.counts, results);
  assertObservedProjects(manifest.runtime.projects, results);
  assertRetryFreePasses(results);

  if (manifest.unclassified.length !== 0) {
    contractFailure(
      `${manifest.unclassified.length} unclassified test result(s) were recorded`,
    );
  }
  if (options.mode === "targeted") return manifest;

  assertCompleteJourneyResults(manifest.cases);
  assertCompleteQualityResults(manifest.quality);
  const expectedTotal =
    PHASE17_CASES.length +
    PHASE17_QUALITY_CONTRACT.reduce(
      (total, contract) => total + contract.expectedCount,
      0,
    );
  if (results.length !== expectedTotal) {
    contractFailure(
      `${results.length} total result(s) were recorded, expected exactly ${expectedTotal}`,
    );
  }
  return manifest;
}

function assertRunIdentity(
  manifest: ParsedManifest,
  expected: Phase17RunIdentity,
) {
  const comparisons: readonly Readonly<{
    label: string;
    observed: string | number;
    expected: string | number;
  }>[] = [
    {
      label: "fixtureVersion",
      observed: manifest.fixtureVersion,
      expected: expected.fixtureVersion,
    },
    {
      label: "commit",
      observed: manifest.commit,
      expected: expected.commit,
    },
    {
      label: "runtime.node",
      observed: manifest.runtime.node,
      expected: expected.runtime.node,
    },
    {
      label: "runtime.npm",
      observed: manifest.runtime.npm,
      expected: expected.runtime.npm,
    },
    {
      label: "runtime.playwright",
      observed: manifest.runtime.playwright,
      expected: expected.runtime.playwright,
    },
    {
      label: "database.anonymousRunId",
      observed: manifest.database.anonymousRunId,
      expected: expected.database.anonymousRunId,
    },
    {
      label: "database.migrationCount",
      observed: manifest.database.migrationCount,
      expected: expected.database.migrationCount,
    },
    {
      label: "database.migrationHash",
      observed: manifest.database.migrationHash,
      expected: expected.database.migrationHash,
    },
    {
      label: "networkPolicy",
      observed: manifest.networkPolicy,
      expected: expected.networkPolicy,
    },
  ];
  for (const comparison of comparisons) {
    if (comparison.observed !== comparison.expected) {
      contractFailure(
        `${comparison.label} is ${String(comparison.observed)}, expected ${String(comparison.expected)}`,
      );
    }
  }
}

function assertRunWindow(startedAt: string, finishedAt: string) {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    contractFailure("run timestamps are not valid ISO-compatible instants");
  }
  if (finished < started) {
    contractFailure("finishedAt precedes startedAt");
  }
}

function assertExactCaseInventory(manifestCases: ParsedManifest["cases"]) {
  const expectedIds = PHASE17_CASES.map(({ id }) => id);
  const observedIds = manifestCases.map(({ id }) => id);
  if (
    observedIds.length !== expectedIds.length ||
    new Set(observedIds).size !== observedIds.length ||
    !sameStringSet(observedIds, expectedIds)
  ) {
    contractFailure(
      `journey inventory is ${observedIds.join(", ") || "<empty>"}, expected ${expectedIds.join(", ")}`,
    );
  }
  for (const entry of manifestCases) {
    if (entry.results.some((result) => result.id !== entry.id)) {
      contractFailure(`journey ${entry.id} contains a mismatched result id`);
    }
  }
}

function assertCompleteJourneyResults(manifestCases: ParsedManifest["cases"]) {
  for (const expected of PHASE17_CASES) {
    const entry = manifestCases.find(({ id }) => id === expected.id);
    if (entry?.results.length !== 1) {
      contractFailure(
        `journey ${expected.id} has ${entry?.results.length ?? 0} result(s), expected exactly 1`,
      );
    }
    const result = entry.results[0]!;
    if (result.project !== PHASE17_JOURNEY_PROJECT) {
      contractFailure(
        `journey ${expected.id} ran in ${result.project}, expected ${PHASE17_JOURNEY_PROJECT}`,
      );
    }
  }
}

function assertCompleteQualityResults(
  quality: readonly ParsedRecordedResult[],
) {
  if (quality.some(({ id }) => id !== "QUALITY")) {
    contractFailure("quality inventory contains a non-QUALITY result id");
  }
  for (const contract of PHASE17_QUALITY_CONTRACT) {
    const results = quality.filter(
      ({ project }) => project === contract.project,
    );
    if (results.length !== contract.expectedCount) {
      contractFailure(
        `${contract.project} has ${results.length} quality result(s), expected exactly ${contract.expectedCount}`,
      );
    }
    if (
      results.some(
        ({ title, file }) =>
          !title.includes(contract.tag) || file !== PHASE17_QUALITY_FILE,
      )
    ) {
      contractFailure(
        `${contract.project} contains a quality result with the wrong tag or file`,
      );
    }
    if (new Set(results.map(({ title }) => title)).size !== results.length) {
      contractFailure(`${contract.project} contains duplicate quality titles`);
    }
  }
  const expectedCount = PHASE17_QUALITY_CONTRACT.reduce(
    (total, contract) => total + contract.expectedCount,
    0,
  );
  if (quality.length !== expectedCount) {
    contractFailure(
      `${quality.length} quality result(s) were recorded, expected exactly ${expectedCount}`,
    );
  }
}

function assertRetryFreePasses(results: readonly ParsedRecordedResult[]) {
  for (const result of results) {
    if (result.status !== "passed") {
      contractFailure(
        `${result.project} / ${result.title} has status ${result.status}`,
      );
    }
    if (result.retry !== 0) {
      contractFailure(
        `${result.project} / ${result.title} ran with retry ${result.retry}`,
      );
    }
  }
}

function assertResultCounts(
  counts: ParsedManifest["counts"],
  results: readonly ParsedRecordedResult[],
) {
  const observed = {
    passed: 0,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    interrupted: 0,
  };
  for (const result of results) observed[result.status] += 1;
  for (const status of resultStatusSchema.options) {
    if (counts[status] !== observed[status]) {
      contractFailure(
        `count for ${status} is ${counts[status]}, observed ${observed[status]}`,
      );
    }
  }
}

function assertObservedProjects(
  projects: readonly string[],
  results: readonly ParsedRecordedResult[],
) {
  const observed = [...new Set(results.map(({ project }) => project))];
  if (
    new Set(projects).size !== projects.length ||
    !sameStringSet(projects, observed)
  ) {
    contractFailure(
      `runtime projects are ${projects.join(", ") || "<empty>"}, observed ${observed.join(", ") || "<empty>"}`,
    );
  }
}

function recordedResults(manifest: ParsedManifest) {
  return [
    ...manifest.cases.flatMap(({ results }) => results),
    ...manifest.quality,
    ...manifest.unclassified,
  ];
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function contractFailure(message: string): never {
  throw new Error(`Phase 17 manifest contract failed: ${message}.`);
}
