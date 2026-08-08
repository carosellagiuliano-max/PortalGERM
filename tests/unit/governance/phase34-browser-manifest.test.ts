import { describe, expect, it } from "vitest";

import {
  assertPhase34CandidateDigest,
  PHASE34_BROWSER_PROJECTS,
  phase34ExpectedResultsForProject,
  validatePhase34BrowserManifest,
} from "@/lib/governance/phase34-browser-manifest";

const DIGEST = "a".repeat(64);

describe("Phase 34 browser manifest", () => {
  it("accepts only the complete exact matrix", () => {
    expect(() =>
      validatePhase34BrowserManifest(validManifest(), DIGEST),
    ).not.toThrow();
  });

  it.each([
    ["missing test", (manifest: Manifest) => manifest.results.pop()],
    [
      "extra test",
      (manifest: Manifest) =>
        manifest.results.push({
          ...manifest.results[0]!,
          file: "flows/unexpected.spec.ts",
        }),
    ],
    [
      "duplicate test",
      (manifest: Manifest) => manifest.results.push(manifest.results[0]!),
    ],
    [
      "wrong evidence ids",
      (manifest: Manifest) => {
        manifest.results[0]!.ids = ["F34-QA-004"];
      },
    ],
    [
      "missing project",
      (manifest: Manifest) => {
        manifest.projects = manifest.projects.slice(0, 2);
      },
    ],
    [
      "wrong count",
      (manifest: Manifest) => {
        manifest.counts.passed -= 1;
      },
    ],
    [
      "retry",
      (manifest: Manifest) => {
        manifest.results[0]!.retry = 1;
      },
    ],
  ])("rejects a manifest with a %s", (_label, mutate) => {
    const manifest = validManifest();
    mutate(manifest);
    expect(() => validatePhase34BrowserManifest(manifest, DIGEST)).toThrow(
      /PHASE34_BROWSER_/u,
    );
  });

  it("rejects evidence for a different source candidate", () => {
    expect(() => assertPhase34CandidateDigest(DIGEST, "b".repeat(64))).toThrow(
      "PHASE34_SOURCE_CHANGED_DURING_GATE",
    );
    expect(() => assertPhase34CandidateDigest(DIGEST, DIGEST)).not.toThrow();
  });
});

type Manifest = ReturnType<typeof validManifest>;

function validManifest() {
  const results = PHASE34_BROWSER_PROJECTS.flatMap((project) =>
    phase34ExpectedResultsForProject(project).map((expected) => ({
      file: expected.file,
      ids: [...expected.ids],
      project,
      retry: 0,
      status: "passed",
    })),
  );
  return {
    schemaVersion: "phase34-browser-manifest-v2",
    candidateDigest: DIGEST,
    status: "passed",
    projects: [...PHASE34_BROWSER_PROJECTS],
    counts: {
      passed: results.length,
      failed: 0,
      timedOut: 0,
      skipped: 0,
      interrupted: 0,
    },
    results,
  };
}
