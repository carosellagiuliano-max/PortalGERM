import { describe, expect, it } from "vitest";

import { evaluateCorpusHandoff } from "@/lib/commercial/corpus-handoff";

describe("Phase 31 discovery-corpus handoff", () => {
  it("requires two expert-signed, distinct corpora and exactly one selection", () => {
    expect(
      evaluateCorpusHandoff([
        {
          code: "PFLEGE_GESUNDHEIT",
          corpusDigest: "a".repeat(64),
          expertOwner: "Pflegefachperson",
          expertReviewed: true,
          locale: "de-CH",
          selectionStatus: "SELECTED",
        },
        {
          code: "ENGINEERING_TECHNIK",
          corpusDigest: "b".repeat(64),
          expertOwner: "Engineering-Fachperson",
          expertReviewed: true,
          locale: "de-CH",
          selectionStatus: "DISCOVERY_ONLY",
        },
      ]),
    ).toMatchObject({ allowed: true, missing: [] });
  });

  it("rejects a copied digest and parallel selection", () => {
    const result = evaluateCorpusHandoff([
      {
        code: "PFLEGE_GESUNDHEIT",
        corpusDigest: "a".repeat(64),
        expertOwner: "Pflege",
        expertReviewed: true,
        locale: "de-CH",
        selectionStatus: "SELECTED",
      },
      {
        code: "ENGINEERING_TECHNIK",
        corpusDigest: "a".repeat(64),
        expertOwner: "Engineering",
        expertReviewed: true,
        locale: "de-CH",
        selectionStatus: "SELECTED",
      },
    ]);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "DISTINCT_CORPUS_DIGESTS",
        "EXACTLY_ONE_SELECTED_CORPUS",
      ]),
    );
  });
});
