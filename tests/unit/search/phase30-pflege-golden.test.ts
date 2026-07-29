import { describe, expect, it } from "vitest";

import {
  PHASE30_CLUSTER_CORPORA_V1,
  resolveSearchConceptKeysV2,
  resolveSearchTermGroupsV2,
} from "@/lib/search/concepts-v2";
import { calculateRelevanceProxy } from "@/lib/search/relevance";

const pflege = PHASE30_CLUSTER_CORPORA_V1.find(
  ({ clusterKey }) => clusterKey === "pflege",
);

describe("Phase 30 Pflege golden corpus", () => {
  it("keeps the selected technical corpus visibly pending expert review", () => {
    expect(pflege).toMatchObject({
      clusterKey: "pflege",
      selectionStatus: "SELECTED",
      reviewStatus: "NOT_REVIEWED",
    });
    expect(pflege?.corpusDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("finds every must-find pair through the shared de-CH concept resolver", () => {
    expect(pflege).toBeDefined();
    for (const sample of pflege?.mustFind ?? []) {
      expect(
        relevance(sample.query, sample.document),
        sample.query,
      ).toBeGreaterThan(0);
    }
  });

  it("does not broaden the occupation concepts into unrelated healthcare text", () => {
    expect(pflege).toBeDefined();
    for (const sample of pflege?.mustNotFind ?? []) {
      expect(relevance(sample.query, sample.document), sample.query).toBe(0);
    }
  });

  it("maps Swiss spelling variants and abbreviations to one stable concept", () => {
    expect(resolveSearchConceptKeysV2("Pflegefachkraft")).toEqual([
      "occupation:pflegefachperson",
    ]);
    expect(resolveSearchConceptKeysV2("dipl. Pflegefachfrau HF")).toEqual([
      "occupation:pflegefachperson",
    ]);
    expect(resolveSearchConceptKeysV2("FaGe EFZ Zürich")).toEqual([
      "occupation:fachperson-gesundheit",
      "qualification:efz",
      "location:ch-zh",
    ]);
    expect(
      resolveSearchTermGroupsV2("Pflegefachperson Pflegefachkraft"),
    ).toHaveLength(1);
  });
});

function relevance(query: string, title: string): number {
  return calculateRelevanceProxy(query, {
    title,
    companyName: "",
    body: "",
  }).score;
}
