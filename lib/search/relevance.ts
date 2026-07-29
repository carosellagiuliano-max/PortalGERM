import {
  normalizeSearchValue,
  resolveSearchTermGroupsV2,
} from "@/lib/search/concepts-v2";

export type RelevanceDocument = Readonly<{
  title: string;
  companyName: string;
  body: string;
}>;

export function normalizedSearchTerms(query: string): readonly string[] {
  return [
    ...new Set(
      normalizeSearchValue(query)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    ),
  ];
}

export function calculateRelevanceProxy(
  query: string,
  document: RelevanceDocument,
): Readonly<{ score: number; tier: number }> {
  const groups = resolveSearchTermGroupsV2(query);
  if (groups.length === 0) return Object.freeze({ score: 0, tier: 0 });
  const fields = [
    { text: normalizeSearchValue(document.title), weight: 3 },
    { text: normalizeSearchValue(document.companyName), weight: 2 },
    { text: normalizeSearchValue(document.body), weight: 1 },
  ] as const;
  let score = 0;
  let tier = 0;
  for (const field of fields) {
    let matched = false;
    for (const group of groups) {
      if (group.terms.some((term) => field.text.includes(term))) {
        score += field.weight;
        matched = true;
      }
    }
    if (matched) tier += 1;
  }
  return Object.freeze({ score, tier });
}
