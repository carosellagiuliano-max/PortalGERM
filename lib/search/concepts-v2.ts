import { createHash } from "node:crypto";

export const SEARCH_POLICY_RELEASE_V2 = Object.freeze({
  searchPolicyVersion: "search-policy-v2",
  taxonomyVersion: "taxonomy-de-ch-v1",
  rankingVersion: "ranking-v2",
  locale: "de-CH",
} as const);

export type SearchConceptType =
  | "OCCUPATION"
  | "LOCATION"
  | "QUALIFICATION"
  | "CERTIFICATE"
  | "SKILL"
  | "INDUSTRY";

export type SearchConceptV2 = Readonly<{
  key: string;
  type: SearchConceptType;
  canonicalLabel: string;
  aliases: readonly string[];
}>;

/**
 * Technical de-CH starter vocabulary. It is deliberately small and may be
 * used for deterministic shadow/runtime semantics, but it is not evidence of
 * occupational expert approval. Phase 31A must review the frozen corpus
 * digest before a cluster can be selected.
 */
export const SEARCH_CONCEPTS_DE_CH_V1 = Object.freeze([
  concept("occupation:pflegefachperson", "OCCUPATION", "Pflegefachperson", [
    "Pflegefachkraft",
    "Pflegefachfrau",
    "Pflegefachmann",
    "dipl Pflegefachperson HF",
    "dipl Pflegefachfrau HF",
    "dipl Pflegefachmann HF",
    "pflegefachperon",
  ]),
  concept(
    "occupation:fachperson-gesundheit",
    "OCCUPATION",
    "Fachperson Gesundheit",
    ["Fachfrau Gesundheit", "Fachmann Gesundheit", "FaGe"],
  ),
  concept(
    "occupation:software-engineering",
    "OCCUPATION",
    "Software Engineer",
    ["Softwareentwickler", "Softwareentwicklerin", "Software Developer"],
  ),
  concept("location:ch-zh", "LOCATION", "Zürich", [
    "Zuerich",
    "Züri",
    "Kanton Zürich",
  ]),
  concept("qualification:hf", "QUALIFICATION", "Höhere Fachschule", [
    "HF",
    "Diplom HF",
    "dipl HF",
  ]),
  concept(
    "qualification:efz",
    "QUALIFICATION",
    "Eidgenössisches Fähigkeitszeugnis",
    ["EFZ", "Fähigkeitszeugnis"],
  ),
  concept("certificate:srk", "CERTIFICATE", "SRK-Anerkennung", [
    "SRK Anerkennung",
    "Anerkennung Schweizerisches Rotes Kreuz",
  ]),
  concept("skill:react", "SKILL", "React", ["React.js", "ReactJS"]),
  concept("skill:pflegeplanung", "SKILL", "Pflegeplanung", ["Pflegeprozess"]),
  concept("industry:healthcare", "INDUSTRY", "Gesundheitswesen", [
    "Gesundheitsbranche",
    "Healthcare",
  ]),
] as const satisfies readonly SearchConceptV2[]);

export const SEARCH_CONCEPT_CORPUS_DIGEST_V1 = createHash("sha256")
  .update(
    JSON.stringify(
      SEARCH_CONCEPTS_DE_CH_V1.map((entry) => ({
        ...entry,
        aliases: [...entry.aliases],
      })),
    ),
    "utf8",
  )
  .digest("hex");

export type SearchTermGroupV2 = Readonly<{
  conceptKey: string | null;
  source: string;
  terms: readonly string[];
  type: SearchConceptType | null;
}>;

export type ClusterCorpusContractV1 = Readonly<{
  clusterKey: "pflege" | "engineering";
  selectionStatus: "SELECTED" | "DISCOVERY_ONLY";
  reviewStatus: "NOT_REVIEWED" | "FULL_EXPERT_REVIEW";
  corpusDigest: string;
  mustFind: readonly Readonly<{ query: string; document: string }>[];
  mustNotFind: readonly Readonly<{ query: string; document: string }>[];
}>;

export const PHASE30_CLUSTER_CORPORA_V1 = Object.freeze([
  corpus({
    clusterKey: "pflege",
    selectionStatus: "SELECTED",
    reviewStatus: "NOT_REVIEWED",
    mustFind: [
      { query: "Pflegefachkraft", document: "Dipl. Pflegefachperson HF" },
      { query: "FaGe", document: "Fachfrau Gesundheit EFZ" },
      { query: "Zuerich", document: "Pflegefachmann in Zürich" },
      { query: "SRK Anerkennung", document: "SRK-Anerkennung erforderlich" },
    ],
    mustNotFind: [
      { query: "Pflegefachperson", document: "Reinigungskraft im Spital" },
      { query: "FaGe", document: "Marketing Manager Healthcare" },
    ],
  }),
  corpus({
    clusterKey: "engineering",
    selectionStatus: "DISCOVERY_ONLY",
    reviewStatus: "NOT_REVIEWED",
    mustFind: [
      { query: "Softwareentwicklerin", document: "Software Engineer React" },
      { query: "ReactJS", document: "React Entwickler" },
    ],
    mustNotFind: [
      { query: "Software Engineer", document: "Marketing Engineer" },
      { query: "React", document: "Reaktionsschnelle Pflegehilfe" },
    ],
  }),
] as const satisfies readonly ClusterCorpusContractV1[]);

export function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function resolveSearchTermGroupsV2(
  query: string,
): readonly SearchTermGroupV2[] {
  const tokens = normalizeSearchValue(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return Object.freeze([]);
  const candidates = SEARCH_CONCEPTS_DE_CH_V1.flatMap((entry) =>
    [entry.canonicalLabel, ...entry.aliases].map((label) => ({
      entry,
      label: normalizeSearchValue(label),
      tokens: normalizeSearchValue(label).split(" ").filter(Boolean),
    })),
  ).sort(
    (left, right) =>
      right.tokens.length - left.tokens.length ||
      right.label.length - left.label.length ||
      left.entry.key.localeCompare(right.entry.key),
  );

  const consumed = new Set<number>();
  const matches: Array<{ index: number; entry: SearchConceptV2 }> = [];
  for (const candidate of candidates) {
    for (
      let index = 0;
      index <= tokens.length - candidate.tokens.length;
      index += 1
    ) {
      if (
        candidate.tokens.every(
          (token, offset) =>
            tokens[index + offset] === token && !consumed.has(index + offset),
        )
      ) {
        for (let offset = 0; offset < candidate.tokens.length; offset += 1) {
          consumed.add(index + offset);
        }
        if (!matches.some(({ entry }) => entry.key === candidate.entry.key)) {
          matches.push({ index, entry: candidate.entry });
        }
        break;
      }
    }
  }

  const groups: Array<{ index: number; group: SearchTermGroupV2 }> =
    matches.map(({ index, entry }) => ({
      index,
      group: Object.freeze({
        conceptKey: entry.key,
        source: tokens[index] ?? normalizeSearchValue(entry.canonicalLabel),
        terms: Object.freeze([
          ...new Set(
            [entry.canonicalLabel, ...entry.aliases].map(normalizeSearchValue),
          ),
        ]),
        type: entry.type,
      }),
    }));
  tokens.forEach((token, index) => {
    if (consumed.has(index)) return;
    groups.push({
      index,
      group: Object.freeze({
        conceptKey: null,
        source: token,
        terms: Object.freeze([token]),
        type: null,
      }),
    });
  });
  return Object.freeze(
    groups
      .sort((left, right) => left.index - right.index)
      .map(({ group }) => group),
  );
}

export function resolveSearchConceptKeysV2(query: string): readonly string[] {
  return Object.freeze(
    resolveSearchTermGroupsV2(query).flatMap(({ conceptKey }) =>
      conceptKey === null ? [] : [conceptKey],
    ),
  );
}

export function haveSearchConceptOverlapV2(
  left: string | readonly string[],
  right: string | readonly string[],
): boolean {
  const leftKeys = new Set(
    resolveSearchConceptKeysV2(searchConceptInputText(left)),
  );
  return resolveSearchConceptKeysV2(searchConceptInputText(right)).some((key) =>
    leftKeys.has(key),
  );
}

function searchConceptInputText(value: string | readonly string[]): string {
  return typeof value === "string" ? value : value.join(" ");
}

function concept(
  key: string,
  type: SearchConceptType,
  canonicalLabel: string,
  aliases: readonly string[],
): SearchConceptV2 {
  return Object.freeze({
    key,
    type,
    canonicalLabel,
    aliases: Object.freeze([...aliases]),
  });
}

function corpus(
  input: Omit<ClusterCorpusContractV1, "corpusDigest">,
): ClusterCorpusContractV1 {
  const canonical = JSON.stringify({
    clusterKey: input.clusterKey,
    mustFind: input.mustFind,
    mustNotFind: input.mustNotFind,
  });
  return Object.freeze({
    ...input,
    mustFind: Object.freeze([...input.mustFind]),
    mustNotFind: Object.freeze([...input.mustNotFind]),
    corpusDigest: createHash("sha256").update(canonical, "utf8").digest("hex"),
  });
}
