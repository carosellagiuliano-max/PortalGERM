import {
  gateDecision,
  isSha256,
  type GateDecision,
} from "@/lib/commercial/contracts";

export type DiscoveryCorpus = Readonly<{
  code: "PFLEGE_GESUNDHEIT" | "ENGINEERING_TECHNIK";
  corpusDigest: string;
  expertOwner: string | null;
  expertReviewed: boolean;
  locale: "de-CH";
  selectionStatus: "DISCOVERY_ONLY" | "SELECTED";
}>;

export function evaluateCorpusHandoff(
  corpora: readonly DiscoveryCorpus[],
): GateDecision {
  const missing: string[] = [];
  const expected = new Set(["PFLEGE_GESUNDHEIT", "ENGINEERING_TECHNIK"]);
  if (
    corpora.length !== 2 ||
    corpora.some((corpus) => !expected.has(corpus.code))
  ) {
    missing.push("TWO_DISTINCT_DISCOVERY_CORPORA");
  }
  if (new Set(corpora.map((corpus) => corpus.corpusDigest)).size !== 2) {
    missing.push("DISTINCT_CORPUS_DIGESTS");
  }
  if (corpora.filter((corpus) => corpus.selectionStatus === "SELECTED").length !== 1) {
    missing.push("EXACTLY_ONE_SELECTED_CORPUS");
  }
  if (
    corpora.some(
      (corpus) =>
        !isSha256(corpus.corpusDigest) ||
        corpus.locale !== "de-CH" ||
        !corpus.expertReviewed ||
        corpus.expertOwner === null ||
        corpus.expertOwner.trim().length < 3,
    )
  ) {
    missing.push("EXPERT_SIGNED_CORPORA");
  }
  return gateDecision(missing);
}
