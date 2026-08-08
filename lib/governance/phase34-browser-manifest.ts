export const PHASE34_BROWSER_PROJECTS = Object.freeze([
  "chromium-phase34",
  "chromium-phase34-trust",
  "firefox-phase34",
  "webkit-phase34",
]);

export const PHASE34_EXPECTED_TEST_RESULTS = Object.freeze([
  expectedResult("flows/phase34-alert-truth.spec.ts", ["F34-NOT-004"]),
  expectedResult("flows/phase34-cross-tenant-assignment.spec.ts", [
    "E2E-34-14",
  ]),
  expectedResult("flows/phase34-document-scan-worker.spec.ts", [
    "F34-DOC-001",
    "F34-OPS-012",
  ]),
  expectedResult("flows/phase34-http-rate-limit.spec.ts", ["E2E-34-17"]),
  expectedResult("flows/phase34-invitation-delivery.spec.ts", [
    "E2E-34-16",
    "F34-NOT-005",
  ]),
  expectedResult("flows/phase34-invitation-identity.spec.ts", ["E2E-34-04"]),
  expectedResult("flows/phase34-password-recovery.spec.ts", [
    "E2E-34-05",
    "F34-NOT-005",
    "F34-SEC-001",
    "F34-SEC-002",
  ]),
  expectedResult("flows/phase34-public-eligibility.spec.ts", [
    "F34-SEARCH-001",
    "F34-SEARCH-010",
    "F34-SEO-001",
  ]),
  expectedResult("flows/phase34-public-intake-privacy.spec.ts", [
    "F34-LEG-007",
  ]),
  expectedResult("flows/phase34-radar-legal.spec.ts", ["F34-LEG-002"]),
  expectedResult("flows/phase34-redacted-error.spec.ts", [
    "F34-SEARCH-009",
    "F34-SEC-005",
  ]),
  expectedResult("flows/phase34-runtime-boundaries.spec.ts", [
    "F34-PAY-002",
    "F34-SEC-003",
  ]),
  expectedResult("flows/phase34-runtime-boundaries.spec.ts", ["F34-DATA-001"]),
  expectedResult("flows/phase34-runtime-boundaries.spec.ts", [
    "F34-COMPANY-001",
  ]),
  expectedResult("flows/phase34-worker-alert.spec.ts", [
    "E2E-34-12",
    "F34-NOT-004",
  ]),
]);

export const PHASE34_CHROMIUM_ONLY_EXPECTED_TEST_RESULTS = Object.freeze([
  expectedResult("flows/phase17-journeys.spec.ts", ["E2E-34-01"]),
  expectedResult("flows/phase17-billing.spec.ts", ["E2E-34-08", "F34-PAY-009"]),
  expectedResult("flows/phase17-talent-radar.spec.ts", [
    "E2E-34-11",
    "F34-LEG-002",
  ]),
  expectedResult("flows/phase21-document-vault.spec.ts", ["E2E-34-13"]),
  expectedResult("flows/phase24-paid-checkout.spec.ts", ["E2E-34-09"]),
]);

export const PHASE34_TRUST_EXPECTED_TEST_RESULTS = Object.freeze([
  expectedResult("flows/phase17-employer-publish.spec.ts", [
    "E2E-34-02",
    "E2E-34-03",
  ]),
]);

export function phase34ExpectedResultsForProject(project: string) {
  if (project === "chromium-phase34") {
    return Object.freeze([
      ...PHASE34_EXPECTED_TEST_RESULTS,
      ...PHASE34_CHROMIUM_ONLY_EXPECTED_TEST_RESULTS,
    ]);
  }
  return project === "chromium-phase34-trust"
    ? PHASE34_TRUST_EXPECTED_TEST_RESULTS
    : PHASE34_EXPECTED_TEST_RESULTS;
}

export function validatePhase34BrowserManifest(
  manifestValue: unknown,
  expectedDigest: string,
) {
  const manifest = record(manifestValue);
  const results = manifest === null ? undefined : manifest.results;
  if (
    manifest === null ||
    manifest.schemaVersion !== "phase34-browser-manifest-v2" ||
    manifest.candidateDigest !== expectedDigest ||
    manifest.status !== "passed" ||
    !Array.isArray(results) ||
    results.length === 0
  ) {
    throw new Error("PHASE34_BROWSER_MANIFEST_INVALID");
  }

  if (
    !Array.isArray(manifest.projects) ||
    manifest.projects.some((project) => typeof project !== "string") ||
    manifest.projects.join("\0") !== PHASE34_BROWSER_PROJECTS.join("\0")
  ) {
    throw new Error("PHASE34_BROWSER_PROJECT_MATRIX_INCOMPLETE");
  }

  const normalizedResults = results.map((value) => {
    const result = record(value);
    if (
      result === null ||
      result.status !== "passed" ||
      result.retry !== 0 ||
      typeof result.project !== "string" ||
      typeof result.file !== "string" ||
      !isNonEmptyStringArray(result.ids)
    ) {
      throw new Error("PHASE34_BROWSER_RESULT_INVALID");
    }
    return Object.freeze({
      file: result.file,
      ids: result.ids,
      project: result.project,
    });
  });

  for (const project of PHASE34_BROWSER_PROJECTS) {
    const expectedProjectResults = phase34ExpectedResultsForProject(project)
      .map(({ file, ids }) => resultIdentity(file, ids))
      .sort();
    const observedProjectResults = normalizedResults
      .filter((result) => result.project === project)
      .map((result) => resultIdentity(result.file, result.ids))
      .sort();
    if (
      JSON.stringify(observedProjectResults) !==
      JSON.stringify(expectedProjectResults)
    ) {
      throw new Error(`PHASE34_BROWSER_RESULT_MATRIX_INCOMPLETE:${project}`);
    }
  }

  const counts = record(manifest.counts);
  const expectedTotal = PHASE34_BROWSER_PROJECTS.reduce(
    (total, project) =>
      total + phase34ExpectedResultsForProject(project).length,
    0,
  );
  if (
    results.length !== expectedTotal ||
    counts === null ||
    counts.passed !== expectedTotal
  ) {
    throw new Error("PHASE34_BROWSER_RESULT_COUNT_INCOMPLETE");
  }
  for (const status of ["failed", "timedOut", "skipped", "interrupted"]) {
    if (counts[status] !== 0) {
      throw new Error(`PHASE34_BROWSER_${status.toUpperCase()}_RESULTS`);
    }
  }
}

export function assertPhase34CandidateDigest(
  expectedDigest: string,
  observedDigest: string,
) {
  if (observedDigest !== expectedDigest) {
    throw new Error("PHASE34_SOURCE_CHANGED_DURING_GATE");
  }
}

function expectedResult(file: string, ids: readonly string[]) {
  return Object.freeze({ file, ids: Object.freeze([...ids]) });
}

function resultIdentity(file: string, ids: readonly string[]) {
  return `${file.replaceAll("\\", "/")}\0${[...ids].sort().join(",")}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string")
  );
}
