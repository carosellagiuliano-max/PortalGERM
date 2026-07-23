import { describe, expect, it } from "vitest";

import {
  PHASE17_CASES,
  PHASE17_FIXTURE_VERSION,
} from "@/tests/e2e/phase17-cases";
import {
  classifyPhase17Result,
  configuredRetryPolicy,
  PHASE17_JOURNEY_PROJECT,
  PHASE17_MANIFEST_SCHEMA_VERSION,
  PHASE17_MOBILE_PROJECT,
  PHASE17_NETWORK_POLICY,
  PHASE17_QUALITY_CONTRACT,
  PHASE17_QUALITY_FILE,
  type Phase17RunIdentity,
  validatePhase17RunManifest,
} from "@/tests/e2e/manifest-contract";

describe("Phase 17 manifest contract", () => {
  it("accepts the exact retry-free full journey and quality inventory", () => {
    const manifest = validFullManifest();
    expect(() =>
      validatePhase17RunManifest(manifest, validationOptions(manifest)),
    ).not.toThrow();
  });

  it("accepts an incomplete targeted pass without claiming the full suite", () => {
    const manifest = validFullManifest();
    const expectedIdentity = identityFromManifest(manifest);
    const targeted = {
      ...manifest,
      runtime: {
        ...manifest.runtime,
        projects: [PHASE17_JOURNEY_PROJECT],
      },
      counts: resultCounts({ passed: 1 }),
      cases: manifest.cases.map((entry, index) => ({
        ...entry,
        results: index === 0 ? entry.results : [],
      })),
      quality: [],
    };

    expect(() =>
      validatePhase17RunManifest(targeted, {
        mode: "targeted",
        expectedIdentity,
      }),
    ).not.toThrow();
    expect(() =>
      validatePhase17RunManifest(targeted, {
        mode: "full",
        expectedIdentity,
      }),
    ).toThrow(/journey E2E-02 has 0 result/u);
  });

  it("rejects a missing mobile quality case even when Playwright says passed", () => {
    const manifest = validFullManifest();
    const quality = manifest.quality.slice(0, -1);
    const incomplete = {
      ...manifest,
      counts: resultCounts({ passed: 16 }),
      quality,
    };

    expect(() =>
      validatePhase17RunManifest(incomplete, validationOptions(manifest)),
    ).toThrow(/chromium-mobile-360 has 4 quality result/u);
  });

  it("rejects an actually retried result despite a claimed zero policy", () => {
    const manifest = validFullManifest();
    const quality = manifest.quality.map((result, index) =>
      index === 0 ? { ...result, retry: 1 } : result,
    );

    expect(() =>
      validatePhase17RunManifest(
        { ...manifest, retryPolicy: 0, quality },
        validationOptions(manifest),
      ),
    ).toThrow(/ran with retry 1/u);

    expect(() =>
      validatePhase17RunManifest(
        { ...manifest, retryPolicy: 1 },
        validationOptions(manifest),
      ),
    ).toThrow(/configured retry policy is 1, expected 0/u);
  });

  it("rejects skipped, failed and unclassified recorded results", () => {
    const manifest = validFullManifest();
    const skippedQuality = manifest.quality.map((result, index) =>
      index === 0 ? { ...result, status: "skipped" } : result,
    );
    expect(() =>
      validatePhase17RunManifest(
        {
          ...manifest,
          counts: resultCounts({ passed: 16, skipped: 1 }),
          quality: skippedQuality,
        },
        validationOptions(manifest),
      ),
    ).toThrow(/has status skipped/u);

    const unclassified = [
      recordedResult({
        id: "UNCLASSIFIED",
        project: PHASE17_JOURNEY_PROJECT,
        title: "unexpected browser test",
        file: "tests/e2e/unexpected.spec.ts",
      }),
    ];
    expect(() =>
      validatePhase17RunManifest(
        {
          ...manifest,
          counts: resultCounts({ passed: 18 }),
          unclassified,
        },
        validationOptions(manifest),
      ),
    ).toThrow(/1 unclassified test result/u);
  });

  it("rejects dishonest counts and runtime project evidence", () => {
    const manifest = validFullManifest();
    expect(() =>
      validatePhase17RunManifest(
        {
          ...manifest,
          counts: resultCounts({ passed: 16 }),
        },
        validationOptions(manifest),
      ),
    ).toThrow(/count for passed is 16, observed 17/u);

    expect(() =>
      validatePhase17RunManifest(
        {
          ...manifest,
          runtime: {
            ...manifest.runtime,
            projects: [PHASE17_JOURNEY_PROJECT],
          },
        },
        validationOptions(manifest),
      ),
    ).toThrow(/runtime projects are chromium-journeys/u);
  });

  it("rejects duplicate quality identities instead of accepting only a count", () => {
    const manifest = validFullManifest();
    const firstMobileIndex = manifest.quality.findIndex(
      ({ project }) => project === PHASE17_MOBILE_PROJECT,
    );
    const quality = manifest.quality.map((result, index) =>
      index === firstMobileIndex + 1
        ? { ...result, title: manifest.quality[firstMobileIndex]!.title }
        : result,
    );

    expect(() =>
      validatePhase17RunManifest(
        { ...manifest, quality },
        validationOptions(manifest),
      ),
    ).toThrow(/chromium-mobile-360 contains duplicate quality titles/u);
  });

  it("rejects evidence from a different fixture, commit, runtime, database or network policy", () => {
    const manifest = validFullManifest();
    const expectedIdentity = identityFromManifest(manifest);
    const mismatches = [
      {
        candidate: { ...manifest, fixtureVersion: "phase17-foreign" },
        expectedMessage: /fixtureVersion is phase17-foreign/u,
      },
      {
        candidate: { ...manifest, commit: "d".repeat(40) },
        expectedMessage: /commit is d{40}/u,
      },
      {
        candidate: {
          ...manifest,
          runtime: { ...manifest.runtime, playwright: "0.0.0" },
        },
        expectedMessage: /runtime\.playwright is 0\.0\.0/u,
      },
      {
        candidate: {
          ...manifest,
          database: {
            ...manifest.database,
            anonymousRunId: "e".repeat(24),
          },
        },
        expectedMessage: /database\.anonymousRunId is e{24}/u,
      },
      {
        candidate: {
          ...manifest,
          database: {
            ...manifest.database,
            migrationHash: "f".repeat(64),
          },
        },
        expectedMessage: /database\.migrationHash is f{64}/u,
      },
      {
        candidate: { ...manifest, networkPolicy: "external-enabled" },
        expectedMessage: /networkPolicy is external-enabled/u,
      },
    ];

    for (const mismatch of mismatches) {
      expect(() =>
        validatePhase17RunManifest(mismatch.candidate, {
          mode: "full",
          expectedIdentity,
        }),
      ).toThrow(mismatch.expectedMessage);
    }
  });

  it("rejects invalid or reversed run timestamps", () => {
    const manifest = validFullManifest();
    expect(() =>
      validatePhase17RunManifest(
        { ...manifest, startedAt: "not-a-time" },
        validationOptions(manifest),
      ),
    ).toThrow(/run timestamps are not valid/u);
    expect(() =>
      validatePhase17RunManifest(
        {
          ...manifest,
          startedAt: "2026-07-23T20:02:00.000Z",
          finishedAt: "2026-07-23T20:01:00.000Z",
        },
        validationOptions(manifest),
      ),
    ).toThrow(/finishedAt precedes startedAt/u);
  });
});

describe("Phase 17 reporter evidence helpers", () => {
  it("classifies only named journeys and the allowlisted quality file", () => {
    expect(
      classifyPhase17Result(
        "[E2E-07] @journey deterministic search",
        "tests/e2e/flows/search.spec.ts",
      ),
    ).toBe("E2E-07");
    expect(
      classifyPhase17Result(
        "@quality-mobile public routes",
        "quality/critical-routes.spec.ts",
      ),
    ).toBe("QUALITY");
    expect(
      classifyPhase17Result(
        "@quality-mobile misleading extra test",
        "tests/e2e/flows/unexpected.spec.ts",
      ),
    ).toBe("UNCLASSIFIED");
  });

  it("derives retry policy from Playwright projects instead of hardcoding it", () => {
    expect(
      configuredRetryPolicy([{ retries: 0 }, { retries: 0 }]),
    ).toBe(0);
    expect(
      configuredRetryPolicy([{ retries: 0 }, { retries: 2 }]),
    ).toBe(2);
    expect(() => configuredRetryPolicy([])).toThrow(
      /requires at least one configured Playwright project/u,
    );
  });
});

function validFullManifest() {
  const cases = PHASE17_CASES.map((entry) => ({
    ...entry,
    results: [
      recordedResult({
        id: entry.id,
        project: PHASE17_JOURNEY_PROJECT,
        title: `[${entry.id}] @journey ${entry.summary}`,
        file: `tests/e2e/flows/${entry.id.toLowerCase()}.spec.ts`,
      }),
    ],
  }));
  const quality = PHASE17_QUALITY_CONTRACT.flatMap((contract) =>
    Array.from({ length: contract.expectedCount }, (_, index) =>
      recordedResult({
        id: "QUALITY",
        project: contract.project,
        title: `${contract.tag} quality case ${index + 1}`,
        file: PHASE17_QUALITY_FILE,
      }),
    ),
  );
  return {
    schemaVersion: PHASE17_MANIFEST_SCHEMA_VERSION,
    fixtureVersion: PHASE17_FIXTURE_VERSION,
    commit: "a".repeat(40),
    status: "passed",
    retryPolicy: 0,
    runtime: {
      node: "v24.18.0",
      npm: "11.16.0",
      playwright: "1.61.1",
      projects: [PHASE17_JOURNEY_PROJECT, PHASE17_MOBILE_PROJECT],
    },
    database: {
      anonymousRunId: "b".repeat(24),
      migrationCount: 17,
      migrationHash: "c".repeat(64),
    },
    networkPolicy: PHASE17_NETWORK_POLICY,
    startedAt: "2026-07-23T20:00:00.000Z",
    finishedAt: "2026-07-23T20:01:00.000Z",
    counts: resultCounts({ passed: 17 }),
    cases,
    quality,
    unclassified: [],
  };
}

function identityFromManifest(
  manifest: ReturnType<typeof validFullManifest>,
): Phase17RunIdentity {
  return {
    fixtureVersion: manifest.fixtureVersion,
    commit: manifest.commit,
    runtime: {
      node: manifest.runtime.node,
      npm: manifest.runtime.npm,
      playwright: manifest.runtime.playwright,
    },
    database: { ...manifest.database },
    networkPolicy: manifest.networkPolicy,
  };
}

function validationOptions(
  manifest: ReturnType<typeof validFullManifest>,
) {
  return {
    mode: "full",
    expectedIdentity: identityFromManifest(manifest),
  } as const;
}

function recordedResult(input: Readonly<{
  id: string;
  project: string;
  title: string;
  file: string;
}>) {
  return {
    ...input,
    status: "passed",
    durationMilliseconds: 100,
    retry: 0,
    errors: [],
  };
}

function resultCounts(
  overrides: Partial<
    Readonly<
      Record<
        "passed" | "failed" | "timedOut" | "skipped" | "interrupted",
        number
      >
    >
  >,
) {
  return {
    passed: 0,
    failed: 0,
    timedOut: 0,
    skipped: 0,
    interrupted: 0,
    ...overrides,
  };
}
