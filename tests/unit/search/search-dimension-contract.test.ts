import { describe, expect, it } from "vitest";

import {
  SEARCH_CONCEPTS_DE_CH_V1,
  SEARCH_CONCEPT_CORPUS_DIGEST_V1,
  SEARCH_POLICY_RELEASE_V2,
  normalizeSearchValue,
} from "@/lib/search/concepts-v2";

describe("Phase 30 search dimension and release contract", () => {
  it("covers all six mandatory search dimensions", () => {
    expect(new Set(SEARCH_CONCEPTS_DE_CH_V1.map(({ type }) => type))).toEqual(
      new Set([
        "OCCUPATION",
        "LOCATION",
        "QUALIFICATION",
        "CERTIFICATE",
        "SKILL",
        "INDUSTRY",
      ]),
    );
  });

  it("binds search, taxonomy and ranking as one explicit release", () => {
    expect(SEARCH_POLICY_RELEASE_V2).toEqual({
      searchPolicyVersion: "search-policy-v2",
      taxonomyVersion: "taxonomy-de-ch-v1",
      rankingVersion: "ranking-v2",
      locale: "de-CH",
    });
    expect(SEARCH_CONCEPT_CORPUS_DIGEST_V1).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("normalizes Swiss spelling deterministically without changing the source corpus", () => {
    expect(normalizeSearchValue("  ZÜRICH / Pflege-Fachperson  ")).toBe(
      "zurich pflege fachperson",
    );
    expect(
      SEARCH_CONCEPTS_DE_CH_V1.every(
        ({ key, canonicalLabel, aliases }) =>
          key.length > 0 && canonicalLabel.length > 0 && aliases.length > 0,
      ),
    ).toBe(true);
  });
});
