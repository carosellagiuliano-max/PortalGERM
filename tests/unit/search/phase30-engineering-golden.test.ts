import { describe, expect, it } from "vitest";

import { PHASE30_CLUSTER_CORPORA_V1 } from "@/lib/search/concepts-v2";
import { calculateRelevanceProxy } from "@/lib/search/relevance";

const engineering = PHASE30_CLUSTER_CORPORA_V1.find(
  ({ clusterKey }) => clusterKey === "engineering",
);

describe("Phase 30 Engineering discovery corpus", () => {
  it("remains discovery-only and cannot masquerade as selected evidence", () => {
    expect(engineering).toMatchObject({
      clusterKey: "engineering",
      selectionStatus: "DISCOVERY_ONLY",
      reviewStatus: "NOT_REVIEWED",
    });
  });

  it("finds the explicit engineering aliases without generic broadening", () => {
    expect(engineering).toBeDefined();
    for (const sample of engineering?.mustFind ?? []) {
      expect(
        relevance(sample.query, sample.document),
        sample.query,
      ).toBeGreaterThan(0);
    }
    for (const sample of engineering?.mustNotFind ?? []) {
      expect(relevance(sample.query, sample.document), sample.query).toBe(0);
    }
  });
});

function relevance(query: string, title: string): number {
  return calculateRelevanceProxy(query, {
    title,
    companyName: "",
    body: "",
  }).score;
}
