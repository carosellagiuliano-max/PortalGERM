export type RelevanceDocument = Readonly<{
  title: string;
  companyName: string;
  body: string;
}>;

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function normalizedSearchTerms(query: string): readonly string[] {
  return [...new Set(normalize(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

export function calculateRelevanceProxy(
  query: string,
  document: RelevanceDocument,
): Readonly<{ score: number; tier: number }> {
  const terms = normalizedSearchTerms(query);
  if (terms.length === 0) return Object.freeze({ score: 0, tier: 0 });
  const fields = [
    { text: normalize(document.title), weight: 3 },
    { text: normalize(document.companyName), weight: 2 },
    { text: normalize(document.body), weight: 1 },
  ] as const;
  let score = 0;
  let tier = 0;
  for (const field of fields) {
    let matched = false;
    for (const term of terms) {
      if (field.text.includes(term)) {
        score += field.weight;
        matched = true;
      }
    }
    if (matched) tier += 1;
  }
  return Object.freeze({ score, tier });
}
